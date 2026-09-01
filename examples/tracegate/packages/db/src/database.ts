import { createClient, type Client } from "@libsql/client";
import { createHash } from "node:crypto";
import {
  BrowserAssertionEvidenceV1Schema,
  BrowserSessionSummarySchema,
  CancelRunInputSchema,
  CancelRunResultSchema,
  DiscoveredInterfaceSchema,
  EvaluationSchema,
  EvaluationSnapshotSchema,
  EvaluationSubmissionInputSchema,
  EvaluationSubmissionResultSchema,
  FinalizeRunInputSchema,
  GradeResultSchema,
  IntermediateRunTransitionInputSchema,
  IntermediateRunTransitionResultSchema,
  ProviderCreateAttemptRecordSchema,
  RuntimeCapabilitySchema,
  EventAppendInputSchema,
  EventCursorSchema,
  EventEnvelopeSchema,
  RunIdSchema,
  RunSchema,
  RunStepSchema,
  redactJson,
  validateRunTransition,
  type BrowserAssertionEvidenceV1,
  type BrowserSessionSummary,
  type CancelRunInput,
  type CancelRunResult,
  type DiscoveredInterface,
  type Evaluation,
  type EvaluationId,
  type EvaluationSnapshot,
  type EventAppendInput,
  type EventCursor,
  type EventEnvelope,
  type EvaluationSubmissionInput,
  type EvaluationSubmissionResult,
  type FinalizeRunInput,
  type FinalizeRunResult,
  type GradeResult,
  type IntermediateRunTransitionInput,
  type IntermediateRunTransitionResult,
  type ProviderCreateAttemptRecord,
  type ProviderCreateAttemptStatus,
  type CreateAttemptCorrelationId,
  type RedactionOptions,
  type RuntimeCapability,
  type Run,
  type RunId,
  type RunStatus,
  type RunStep,
  type RunStatusPatch,
  type EvaluationStatus,
  type EvaluationStatusPatch,
  type RunTransitionContext,
  type UtcDateTime,
} from "@tracegate/shared";
import { and, asc, desc, eq, gt, inArray, notInArray } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { migrateTracegateDatabase } from "./migrate.ts";
import {
  assertionEvidence,
  browserSessions,
  capabilityChecks,
  discoveredInterfaces,
  evaluations,
  events,
  gradeResults,
  providerCreateAttempts,
  runs,
  runSteps,
  tracegateSchema,
} from "./schema.ts";

type Database = LibSQLDatabase<typeof tracegateSchema>;

export interface OpenTracegateDatabaseOptions {
  readonly url: string;
  readonly authToken?: string;
  readonly knownSecrets?: readonly string[];
  readonly now?: () => Date;
}

export interface CreateEvaluationGraphInput {
  readonly evaluation: Evaluation;
  readonly runs: readonly Run[];
  readonly events: readonly EventAppendInput[];
}

export interface PersistRunMilestoneInput {
  readonly expectedStatus: RunStatus;
  readonly run: Run;
  readonly transition: RunTransitionContext;
  readonly step: RunStep;
  readonly event: EventAppendInput;
}

export interface PersistedRunMilestone {
  readonly run: Run;
  readonly step: RunStep;
  readonly event: EventEnvelope;
}

export interface PersistRunEventStepInput {
  readonly step: RunStep;
  readonly event: EventAppendInput;
}

export interface PersistedRunEventStep {
  readonly step: RunStep;
  readonly event: EventEnvelope;
}

export interface PersistedCleanupState {
  readonly evaluationId: EvaluationId;
  readonly browserSessions: readonly BrowserSessionSummary[];
  readonly providerCreateAttempts: readonly ProviderCreateAttemptRecord[];
  readonly potentialLeakRunIds: readonly RunId[];
}

export interface PersistedEvaluationReport {
  readonly snapshot: EvaluationSnapshot;
  readonly specificationHash: string;
  readonly steps: readonly RunStep[];
  readonly events: readonly EventEnvelope[];
  readonly interfaces: readonly (DiscoveredInterface & { readonly runId: RunId })[];
  readonly evidence: readonly (BrowserAssertionEvidenceV1 & { readonly runId: RunId })[];
  readonly browserSessions: readonly BrowserSessionSummary[];
  readonly grades: readonly (GradeResult & { readonly runId: RunId })[];
  readonly cleanup: PersistedCleanupState;
}

class SerializedWriter {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

const throwIfAborted = (signal: AbortSignal): void => signal.throwIfAborted();

const parseJson = (value: string): unknown => JSON.parse(value) as unknown;

export class TracegateDatabase {
  private readonly writer = new SerializedWriter();
  private readonly redaction: RedactionOptions;
  private readonly client: Client;
  private readonly db: Database;
  private readonly now: () => Date;

  private constructor(
    client: Client,
    db: Database,
    knownSecrets: readonly string[],
    now: () => Date,
  ) {
    this.client = client;
    this.db = db;
    this.now = now;
    this.redaction = {
      knownSecrets,
      maxStringLength: 4_000,
      maxDepth: 8,
      maxArrayLength: 100,
      maxObjectKeys: 100,
    };
  }

  static async open(options: OpenTracegateDatabaseOptions): Promise<TracegateDatabase> {
    const client = createClient(options.authToken === undefined
      ? { url: options.url }
      : { url: options.url, authToken: options.authToken });
    await migrateTracegateDatabase(client);
    return new TracegateDatabase(
      client,
      drizzle(client, { schema: tracegateSchema }),
      options.knownSecrets ?? [],
      options.now ?? (() => new Date()),
    );
  }

  async createEvaluationGraph(input: CreateEvaluationGraphInput, signal: AbortSignal): Promise<readonly EventEnvelope[]> {
    throwIfAborted(signal);
    const evaluation = this.sanitizeEvaluation(input.evaluation);
    const runRows = input.runs.map((run) => this.sanitizeRun(run));
    const eventRows = input.events.map((event) => this.sanitizeEvent(event));

    if (runRows.some((run) => run.evaluationId !== evaluation.id)) {
      throw new Error("All runs must belong to the created evaluation");
    }
    if (eventRows.some((event) => event.evaluationId !== evaluation.id)) {
      throw new Error("All events must belong to the created evaluation");
    }
    const runIds = new Set(runRows.map((run) => run.id));
    if (eventRows.some((event) => event.runId !== null && !runIds.has(event.runId))) {
      throw new Error("Run-scoped creation events must reference a created run");
    }

    return this.writer.enqueue(async () => {
      throwIfAborted(signal);
      const recordedAt = this.nowIso();
      const inserted = await this.db.transaction(async (tx) => {
        await tx.insert(evaluations).values(this.evaluationValues(evaluation));
        if (runRows.length > 0) {
          await tx.insert(runs).values(runRows.map((run) => this.runValues(run)));
        }
        if (eventRows.length === 0) return [];
        throwIfAborted(signal);
        return tx.insert(events).values(eventRows.map((event) => ({
          eventId: event.eventId,
          evaluationId: event.evaluationId,
          runId: event.runId,
          runSequence: event.runSequence,
          type: event.type,
          occurredAt: event.occurredAt,
          recordedAt,
          payloadJson: JSON.stringify(event.payload),
        }))).returning();
      });
      return inserted.map((row) => this.eventEnvelopeFromRow(row));
    });
  }

  async transactionallyCreateSubmission(inputValue: EvaluationSubmissionInput, signal: AbortSignal): Promise<EvaluationSubmissionResult> {
    throwIfAborted(signal);
    const input = EvaluationSubmissionInputSchema.parse(inputValue);
    const evaluation = this.sanitizeEvaluation(input.evaluation);
    const runRows = input.runs.map((run) => this.sanitizeRun(run));
    const eventRows = input.queuedEvents.map((event) => this.sanitizeEvent(event));
    return this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [existingEvaluationRow] = await tx.select({ entityJson: evaluations.entityJson }).from(evaluations)
        .where(eq(evaluations.id, evaluation.id)).limit(1);
      if (existingEvaluationRow !== undefined) {
        const existingEvaluation = EvaluationSchema.parse(parseJson(existingEvaluationRow.entityJson));
        const existingRunRows = await tx.select({ entityJson: runs.entityJson }).from(runs)
          .where(eq(runs.evaluationId, evaluation.id)).orderBy(asc(runs.runIndex));
        const existingRuns = existingRunRows.map((row) => RunSchema.parse(parseJson(row.entityJson)));
        const existingEventRows = await tx.select().from(events)
          .where(inArray(events.eventId, eventRows.map((event) => event.eventId)));
        const existingEvents = existingEventRows.map((row) => this.eventEnvelopeFromRow(row));
        const orderedExistingEvents = eventRows.flatMap((expected) => {
          const match = existingEvents.find((existing) => existing.eventId === expected.eventId);
          return match === undefined ? [] : [match];
        });
        const same = JSON.stringify(existingEvaluation) === JSON.stringify(evaluation)
          && JSON.stringify(existingRuns) === JSON.stringify(runRows)
          && eventRows.every((event) => orderedExistingEvents.some((existing) => {
            const canonical = EventAppendInputSchema.parse(existing);
            return JSON.stringify(canonical) === JSON.stringify(event);
          }));
        if (!same || orderedExistingEvents.length !== eventRows.length) {
          throw new Error(`Evaluation submission ${evaluation.id} conflicts with existing durable content`);
        }
        return EvaluationSubmissionResultSchema.parse({
          created: false,
          evaluation: existingEvaluation,
          runs: existingRuns,
          queuedEvents: orderedExistingEvents,
        });
      }

      await tx.insert(evaluations).values(this.evaluationValues(evaluation));
      await tx.insert(runs).values(runRows.map((run) => this.runValues(run)));
      const recordedAt = this.nowIso();
      const inserted = await tx.insert(events).values(eventRows.map((event) => this.eventValues(event, recordedAt))).returning();
      return EvaluationSubmissionResultSchema.parse({
        created: true,
        evaluation,
        runs: runRows,
        queuedEvents: inserted.map((row) => this.eventEnvelopeFromRow(row)),
      });
    }));
  }

  async transactionallyApplyRunTransition(
    inputValue: IntermediateRunTransitionInput,
    signal: AbortSignal,
  ): Promise<IntermediateRunTransitionResult> {
    throwIfAborted(signal);
    const input = IntermediateRunTransitionInputSchema.parse(inputValue);
    const event = this.sanitizeEvent(input.event);
    return this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [row] = await tx.select({ entityJson: runs.entityJson }).from(runs)
        .where(and(eq(runs.id, input.runId), eq(runs.status, input.expectedStatus))).limit(1);
      if (row === undefined) return IntermediateRunTransitionResultSchema.parse({ applied: false, run: null, event: null });
      const current = RunSchema.parse(parseJson(row.entityJson));
      if (event.evaluationId !== current.evaluationId) throw new Error("Transition event must belong to the run evaluation");
      const run = this.sanitizeRun(RunSchema.parse({
        ...current,
        status: input.nextStatus,
        startedAt: input.patch.startedAt === undefined ? current.startedAt : input.patch.startedAt,
        failure: input.patch.failure === undefined ? current.failure : input.patch.failure,
        releaseStatus: input.patch.releaseStatus ?? current.releaseStatus,
        potentialSessionLeak: input.patch.potentialSessionLeak ?? current.potentialSessionLeak,
      }));
      const changed = await tx.update(runs).set(this.runValues(run))
        .where(and(eq(runs.id, input.runId), eq(runs.status, input.expectedStatus))).returning({ id: runs.id });
      if (changed.length !== 1) return IntermediateRunTransitionResultSchema.parse({ applied: false, run: null, event: null });
      const [inserted] = await tx.insert(events).values(this.eventValues(event, this.nowIso())).returning();
      if (inserted === undefined) throw new Error("Transition event insert returned no row");
      return IntermediateRunTransitionResultSchema.parse({ applied: true, run, event: this.eventEnvelopeFromRow(inserted) });
    }));
  }

  async persistRunMilestone(input: PersistRunMilestoneInput, signal: AbortSignal): Promise<PersistedRunMilestone> {
    throwIfAborted(signal);
    const run = this.sanitizeRun(input.run);
    const step = this.sanitizeStep(input.step);
    const event = this.sanitizeEvent(input.event);

    if (run.id !== step.runId || run.id !== event.runId || step.sequence !== event.runSequence) {
      throw new Error("Run milestone step and event scope must match the run and sequence");
    }
    if (event.evaluationId !== run.evaluationId) {
      throw new Error("Run milestone event must belong to the run evaluation");
    }
    const transition = validateRunTransition(input.expectedStatus, run.status, input.transition);
    if (!transition.ok) throw new Error(transition.error.message);
    if (event.type !== "run.status_changed"
      || event.payload.previous !== input.expectedStatus
      || event.payload.next !== run.status
      || event.payload.mode !== input.transition.mode) {
      throw new Error("Run milestone event must describe the persisted status transition");
    }

    return this.writer.enqueue(async () => {
      throwIfAborted(signal);
      const recordedAt = this.nowIso();
      const insertedEvent = await this.db.transaction(async (tx) => {
        const updated = await tx.update(runs)
          .set(this.runValues(run))
          .where(and(eq(runs.id, run.id), eq(runs.status, input.expectedStatus)))
          .returning({ id: runs.id });
        if (updated.length !== 1) throw new Error(`Run ${run.id} was not in expected status ${input.expectedStatus}`);

        await tx.insert(runSteps).values({
          runId: step.runId,
          sequence: step.sequence,
          kind: step.kind,
          payloadJson: JSON.stringify(step.payload),
          interactionMode: step.interactionMode,
          observationRevision: step.observationRevision,
          durationMs: step.durationMs,
          occurredAt: step.occurredAt,
        });
        throwIfAborted(signal);
        const [row] = await tx.insert(events).values({
          eventId: event.eventId,
          evaluationId: event.evaluationId,
          runId: event.runId,
          runSequence: event.runSequence,
          type: event.type,
          occurredAt: event.occurredAt,
          recordedAt,
          payloadJson: JSON.stringify(event.payload),
        }).returning();
        if (row === undefined) throw new Error("Milestone event insert returned no row");
        return row;
      });
      return { run, step, event: this.eventEnvelopeFromRow(insertedEvent) };
    });
  }

  async appendRunEventStep(input: PersistRunEventStepInput, signal: AbortSignal): Promise<PersistedRunEventStep> {
    throwIfAborted(signal);
    const step = this.sanitizeStep(input.step);
    const event = this.sanitizeEvent(input.event);
    if (event.runId === null || event.runSequence === null || event.runId !== step.runId || event.runSequence !== step.sequence) {
      throw new Error("Run step and event must share the same run scope and sequence");
    }
    return this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [owner] = await tx.select({ evaluationId: runs.evaluationId }).from(runs)
        .where(eq(runs.id, step.runId)).limit(1);
      if (owner === undefined || owner.evaluationId !== event.evaluationId) {
        throw new Error("Run step event must belong to the referenced run evaluation");
      }
      await tx.insert(runSteps).values({
        runId: step.runId,
        sequence: step.sequence,
        kind: step.kind,
        payloadJson: JSON.stringify(step.payload),
        interactionMode: step.interactionMode,
        observationRevision: step.observationRevision,
        durationMs: step.durationMs,
        occurredAt: step.occurredAt,
      });
      const [inserted] = await tx.insert(events).values(this.eventValues(event, this.nowIso())).returning();
      if (inserted === undefined) throw new Error("Run step event insert returned no row");
      return { step, event: this.eventEnvelopeFromRow(inserted) };
    }));
  }

  async createEvaluation(evaluationInput: Evaluation, signal: AbortSignal): Promise<Evaluation> {
    throwIfAborted(signal);
    const evaluation = this.sanitizeEvaluation(evaluationInput);
    await this.writer.enqueue(async () => {
      throwIfAborted(signal);
      await this.db.insert(evaluations).values(this.evaluationValues(evaluation));
    });
    return evaluation;
  }

  async getEvaluation(evaluationId: EvaluationId, signal: AbortSignal): Promise<Evaluation | null> {
    throwIfAborted(signal);
    const [row] = await this.db.select({ entityJson: evaluations.entityJson }).from(evaluations)
      .where(eq(evaluations.id, evaluationId)).limit(1);
    throwIfAborted(signal);
    return row === undefined ? null : EvaluationSchema.parse(parseJson(row.entityJson));
  }

  async compareAndSetEvaluationStatus(
    evaluationId: EvaluationId,
    expected: EvaluationStatus,
    next: EvaluationStatus,
    patch: EvaluationStatusPatch,
    signal: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal);
    return this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [row] = await tx.select({ entityJson: evaluations.entityJson }).from(evaluations)
        .where(and(eq(evaluations.id, evaluationId), eq(evaluations.status, expected))).limit(1);
      if (row === undefined) return false;
      const current = EvaluationSchema.parse(parseJson(row.entityJson));
      const updated = this.sanitizeEvaluation(EvaluationSchema.parse({
        ...current,
        status: next,
        startedAt: "startedAt" in patch ? patch.startedAt : current.startedAt,
        finishedAt: "finishedAt" in patch ? patch.finishedAt : current.finishedAt,
        failure: "failure" in patch ? patch.failure : current.failure,
      }));
      const changed = await tx.update(evaluations).set(this.evaluationValues(updated))
        .where(and(eq(evaluations.id, evaluationId), eq(evaluations.status, expected)))
        .returning({ id: evaluations.id });
      return changed.length === 1;
    }));
  }

  async listRecoverableEvaluations(signal: AbortSignal): Promise<readonly Evaluation[]> {
    throwIfAborted(signal);
    const rows = await this.db.select({ entityJson: evaluations.entityJson }).from(evaluations)
      .where(inArray(evaluations.status, ["queued", "running", "cancelling"])).orderBy(asc(evaluations.createdAt));
    throwIfAborted(signal);
    return rows.map((row) => EvaluationSchema.parse(parseJson(row.entityJson)));
  }

  async createRun(runInput: Run, signal: AbortSignal): Promise<Run> {
    throwIfAborted(signal);
    const run = this.sanitizeRun(runInput);
    await this.writer.enqueue(async () => {
      throwIfAborted(signal);
      await this.db.insert(runs).values(this.runValues(run));
    });
    return run;
  }

  async getRun(runId: RunId, signal: AbortSignal): Promise<Run | null> {
    throwIfAborted(signal);
    const [row] = await this.db.select({ entityJson: runs.entityJson }).from(runs).where(eq(runs.id, runId)).limit(1);
    throwIfAborted(signal);
    return row === undefined ? null : RunSchema.parse(parseJson(row.entityJson));
  }

  async compareAndSetRunStatus(
    runId: RunId,
    expected: RunStatus,
    next: RunStatus,
    patch: RunStatusPatch,
    signal: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal);
    return this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [row] = await tx.select({ entityJson: runs.entityJson }).from(runs)
        .where(and(eq(runs.id, runId), eq(runs.status, expected))).limit(1);
      if (row === undefined) return false;
      const current = RunSchema.parse(parseJson(row.entityJson));
      const finishedAt = patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt;
      const updated = this.sanitizeRun(RunSchema.parse({
        ...current,
        status: next,
        startedAt: "startedAt" in patch ? patch.startedAt : current.startedAt,
        finishedAt,
        durationMs: finishedAt === null ? current.durationMs : Math.max(0, Date.parse(finishedAt) - Date.parse(current.startedAt ?? current.createdAt)),
        failure: "failure" in patch ? patch.failure : current.failure,
        releaseStatus: "releaseStatus" in patch ? patch.releaseStatus : current.releaseStatus,
        potentialSessionLeak: "potentialSessionLeak" in patch ? patch.potentialSessionLeak : current.potentialSessionLeak,
      }));
      const changed = await tx.update(runs).set(this.runValues(updated))
        .where(and(eq(runs.id, runId), eq(runs.status, expected))).returning({ id: runs.id });
      return changed.length === 1;
    }));
  }

  async listRecoverableRuns(signal: AbortSignal): Promise<readonly Run[]> {
    throwIfAborted(signal);
    const rows = await this.db.select({ entityJson: runs.entityJson }).from(runs)
      .where(notInArray(runs.status, ["completed", "cancelled"])).orderBy(asc(runs.createdAt), asc(runs.runIndex));
    throwIfAborted(signal);
    return rows.map((row) => RunSchema.parse(parseJson(row.entityJson)));
  }

  async transactionallyFinalize(inputValue: FinalizeRunInput, signal: AbortSignal): Promise<FinalizeRunResult> {
    throwIfAborted(signal);
    const input = FinalizeRunInputSchema.parse(inputValue);
    const event = this.sanitizeEvent(input.event);
    return this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [row] = await tx.select({ entityJson: runs.entityJson }).from(runs)
        .where(and(eq(runs.id, input.runId), eq(runs.status, input.expectedStatus))).limit(1);
      if (row === undefined) return { applied: false, run: null, event: null };
      const current = RunSchema.parse(parseJson(row.entityJson));
      if (event.evaluationId !== current.evaluationId) {
        throw new Error("Terminal event must belong to the finalized run evaluation");
      }
      const run = this.sanitizeRun(RunSchema.parse({
        ...current,
        ...(input.resultPatch ?? {}),
        status: "completed",
        outcome: input.outcome,
        grade: input.grade,
        failure: input.failure,
        warnings: input.warnings,
        finishedAt: input.finishedAt,
        durationMs: Math.max(0, Date.parse(input.finishedAt) - Date.parse(current.startedAt ?? current.createdAt)),
      }));
      const [evidenceRow] = await tx.select({ evidenceHash: assertionEvidence.evidenceHash }).from(assertionEvidence)
        .where(eq(assertionEvidence.runId, input.runId)).limit(1);
      const isNoEvidenceInconclusive = run.outcome === "inconclusive"
        && run.failure !== null
        && run.grade?.evidenceHash === "0".repeat(64);
      if (!isNoEvidenceInconclusive && (evidenceRow === undefined || evidenceRow.evidenceHash !== run.grade?.evidenceHash)) {
        throw new Error("A gradeable run may be finalized only from its committed canonical assertion evidence");
      }
      const changed = await tx.update(runs).set(this.runValues(run))
        .where(and(eq(runs.id, input.runId), eq(runs.status, input.expectedStatus))).returning({ id: runs.id });
      if (changed.length !== 1) return { applied: false, run: null, event: null };
      await tx.insert(gradeResults).values(this.gradeValues(input.runId, run.grade!)).onConflictDoUpdate({
        target: gradeResults.runId,
        set: this.gradeValues(input.runId, run.grade!),
      });
      throwIfAborted(signal);
      const [inserted] = await tx.insert(events).values(this.eventValues(event, this.nowIso())).returning();
      if (inserted === undefined) throw new Error("Terminal event insert returned no row");
      return { applied: true, run, event: this.eventEnvelopeFromRow(inserted) };
    }));
  }

  async transactionallyCancel(inputValue: CancelRunInput, signal: AbortSignal): Promise<CancelRunResult> {
    throwIfAborted(signal);
    const input = CancelRunInputSchema.parse(inputValue);
    const event = this.sanitizeEvent(input.event);
    return this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [row] = await tx.select({ entityJson: runs.entityJson }).from(runs)
        .where(and(eq(runs.id, input.runId), eq(runs.status, input.expectedStatus))).limit(1);
      if (row === undefined) return CancelRunResultSchema.parse({ applied: false, run: null, event: null });
      const current = RunSchema.parse(parseJson(row.entityJson));
      if (event.evaluationId !== current.evaluationId) throw new Error("Cancellation event must belong to the run evaluation");
      const run = this.sanitizeRun(RunSchema.parse({
        ...current,
        status: "cancelled",
        outcome: null,
        grade: null,
        failure: null,
        warnings: input.warnings,
        finishedAt: input.finishedAt,
        durationMs: Math.max(0, Date.parse(input.finishedAt) - Date.parse(current.startedAt ?? current.createdAt)),
        releaseStatus: input.releaseStatus,
        potentialSessionLeak: input.potentialSessionLeak,
      }));
      const changed = await tx.update(runs).set(this.runValues(run))
        .where(and(eq(runs.id, input.runId), eq(runs.status, input.expectedStatus))).returning({ id: runs.id });
      if (changed.length !== 1) return CancelRunResultSchema.parse({ applied: false, run: null, event: null });
      const [inserted] = await tx.insert(events).values(this.eventValues(event, this.nowIso())).returning();
      if (inserted === undefined) throw new Error("Cancellation event insert returned no row");
      return CancelRunResultSchema.parse({ applied: true, run, event: this.eventEnvelopeFromRow(inserted) });
    }));
  }

  async appendEvent(input: EventAppendInput, signal: AbortSignal): Promise<EventEnvelope> {
    throwIfAborted(signal);
    const event = this.sanitizeEvent(input);
    return this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [existing] = await tx.select().from(events).where(eq(events.eventId, event.eventId)).limit(1);
      if (existing !== undefined) {
        const existingInput = EventAppendInputSchema.parse(this.eventEnvelopeFromRow(existing));
        if (JSON.stringify(existingInput) !== JSON.stringify(event)) {
          throw new Error(`Event ID ${event.eventId} already belongs to a different canonical event`);
        }
        return this.eventEnvelopeFromRow(existing);
      }
      if (event.runId !== null) {
        const [owner] = await tx.select({ evaluationId: runs.evaluationId }).from(runs)
          .where(eq(runs.id, event.runId)).limit(1);
        if (owner === undefined || owner.evaluationId !== event.evaluationId) {
          throw new Error("Run-scoped event must belong to the referenced run evaluation");
        }
      }
      const [inserted] = await tx.insert(events).values(this.eventValues(event, this.nowIso())).returning();
      if (inserted === undefined) throw new Error("Event insert returned no row");
      return this.eventEnvelopeFromRow(inserted);
    }));
  }

  async earliestEventCursor(evaluationId: EvaluationId, signal: AbortSignal): Promise<EventCursor | null> {
    throwIfAborted(signal);
    const [row] = await this.db.select({ cursor: events.cursor }).from(events)
      .where(eq(events.evaluationId, evaluationId)).orderBy(asc(events.cursor)).limit(1);
    throwIfAborted(signal);
    return row === undefined ? null : EventCursorSchema.parse(String(row.cursor));
  }

  async latestEventCursor(evaluationId: EvaluationId, signal: AbortSignal): Promise<EventCursor | null> {
    throwIfAborted(signal);
    const [row] = await this.db.select({ cursor: events.cursor }).from(events)
      .where(eq(events.evaluationId, evaluationId)).orderBy(desc(events.cursor)).limit(1);
    throwIfAborted(signal);
    return row === undefined ? null : EventCursorSchema.parse(String(row.cursor));
  }

  async upsertAssertionEvidence(
    runId: RunId,
    evidenceInput: BrowserAssertionEvidenceV1,
    signal: AbortSignal,
  ): Promise<BrowserAssertionEvidenceV1> {
    throwIfAborted(signal);
    const parsedEvidence = BrowserAssertionEvidenceV1Schema.parse(evidenceInput);
    const evidence = BrowserAssertionEvidenceV1Schema.parse(this.redactClosedRecord(parsedEvidence));
    if (JSON.stringify(evidence) !== JSON.stringify(parsedEvidence)) {
      throw new Error("Canonical assertion evidence must be redacted before its evidence hash is computed");
    }
    await this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      const [owner] = await tx.select({ evaluationId: runs.evaluationId, status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
      if (owner === undefined) throw new Error(`Cannot persist assertion evidence for unknown run ${runId}`);
      const [evaluationRow] = await tx.select({ entityJson: evaluations.entityJson }).from(evaluations)
        .where(eq(evaluations.id, owner.evaluationId)).limit(1);
      if (evaluationRow === undefined) throw new Error("Assertion evidence owner evaluation is missing");
      const evaluation = EvaluationSchema.parse(parseJson(evaluationRow.entityJson));
      const configuredIds = evaluation.config.assertions.map((assertion) => assertion.id);
      const evidenceIds = evidence.assertions.map((assertion) => assertion.assertionId);
      if (JSON.stringify(configuredIds) !== JSON.stringify(evidenceIds)) {
        throw new Error("Canonical assertion evidence must exactly match configured assertion IDs and order");
      }
      const [existingEvidenceRow] = await tx.select({ evidenceJson: assertionEvidence.evidenceJson }).from(assertionEvidence)
        .where(eq(assertionEvidence.runId, runId)).limit(1);
      if (existingEvidenceRow !== undefined) {
        const existingEvidence = BrowserAssertionEvidenceV1Schema.parse(parseJson(existingEvidenceRow.evidenceJson));
        if (JSON.stringify(existingEvidence) === JSON.stringify(evidence)) return;
        const [gradeRow] = await tx.select({ runId: gradeResults.runId }).from(gradeResults)
          .where(eq(gradeResults.runId, runId)).limit(1);
        if (gradeRow !== undefined || owner.status === "completed" || owner.status === "cancelled") {
          throw new Error("Committed grading evidence is immutable after grading or terminalization");
        }
      }
      const values = this.assertionEvidenceValues(runId, evidence);
      await tx.insert(assertionEvidence).values(values).onConflictDoUpdate({ target: assertionEvidence.runId, set: values });
    }));
    return evidence;
  }

  async getAssertionEvidence(runId: RunId, signal: AbortSignal): Promise<BrowserAssertionEvidenceV1 | null> {
    throwIfAborted(signal);
    const [row] = await this.db.select({ evidenceJson: assertionEvidence.evidenceJson }).from(assertionEvidence)
      .where(eq(assertionEvidence.runId, runId)).limit(1);
    throwIfAborted(signal);
    return row === undefined ? null : BrowserAssertionEvidenceV1Schema.parse(parseJson(row.evidenceJson));
  }

  async getGradeResult(runId: RunId, signal: AbortSignal): Promise<GradeResult | null> {
    throwIfAborted(signal);
    const [row] = await this.db.select({ resultJson: gradeResults.resultJson }).from(gradeResults)
      .where(eq(gradeResults.runId, runId)).limit(1);
    throwIfAborted(signal);
    return row === undefined ? null : GradeResultSchema.parse(parseJson(row.resultJson));
  }

  async upsertBrowserSession(sessionInput: BrowserSessionSummary, signal: AbortSignal): Promise<BrowserSessionSummary> {
    throwIfAborted(signal);
    const session = BrowserSessionSummarySchema.parse(this.redactClosedRecord(BrowserSessionSummarySchema.parse(sessionInput)));
    const values = this.browserSessionValues(session);
    await this.writer.enqueue(async () => {
      throwIfAborted(signal);
      await this.db.insert(browserSessions).values(values).onConflictDoUpdate({ target: browserSessions.runId, set: values });
    });
    return session;
  }

  async getBrowserSession(runId: RunId, signal: AbortSignal): Promise<BrowserSessionSummary | null> {
    throwIfAborted(signal);
    const [row] = await this.db.select().from(browserSessions).where(eq(browserSessions.runId, runId)).limit(1);
    throwIfAborted(signal);
    return row === undefined ? null : this.browserSessionFromRow(row);
  }

  async listPotentiallyLeakedBrowserSessions(signal: AbortSignal): Promise<readonly BrowserSessionSummary[]> {
    throwIfAborted(signal);
    const rows = await this.db.select().from(browserSessions)
      .where(notInArray(browserSessions.releaseStatus, ["released"])).orderBy(asc(browserSessions.acquiredAt));
    throwIfAborted(signal);
    return rows.map((row) => this.browserSessionFromRow(row));
  }

  async recordProviderCreateAttempt(
    recordValue: ProviderCreateAttemptRecord,
    signal: AbortSignal,
  ): Promise<ProviderCreateAttemptRecord> {
    throwIfAborted(signal);
    const record = ProviderCreateAttemptRecordSchema.parse(recordValue);
    if (record.status !== "started") throw new Error("Initial provider create-attempt record must use started status");
    await this.writer.enqueue(async () => {
      throwIfAborted(signal);
      await this.db.insert(providerCreateAttempts).values(this.providerCreateAttemptValues(record));
    });
    return record;
  }

  async transitionProviderCreateAttempt(
    runId: RunId,
    attemptCorrelationId: CreateAttemptCorrelationId,
    expected: ProviderCreateAttemptStatus,
    nextValue: ProviderCreateAttemptRecord,
    signal: AbortSignal,
  ): Promise<boolean> {
    throwIfAborted(signal);
    const next = ProviderCreateAttemptRecordSchema.parse(nextValue);
    if (next.runId !== runId || next.attemptCorrelationId !== attemptCorrelationId) {
      throw new Error("Provider create-attempt transition identity cannot change");
    }
    return this.writer.enqueue(async () => {
      const changed = await this.db.update(providerCreateAttempts).set(this.providerCreateAttemptValues(next))
        .where(and(
          eq(providerCreateAttempts.runId, runId),
          eq(providerCreateAttempts.attemptCorrelationId, attemptCorrelationId),
          eq(providerCreateAttempts.status, expected),
        )).returning({ runId: providerCreateAttempts.runId });
      return changed.length === 1;
    });
  }

  async getProviderCreateAttempt(
    runId: RunId,
    attemptCorrelationId: CreateAttemptCorrelationId,
    signal: AbortSignal,
  ): Promise<ProviderCreateAttemptRecord | null> {
    throwIfAborted(signal);
    const [row] = await this.db.select({ recordJson: providerCreateAttempts.recordJson }).from(providerCreateAttempts)
      .where(and(eq(providerCreateAttempts.runId, runId), eq(providerCreateAttempts.attemptCorrelationId, attemptCorrelationId))).limit(1);
    throwIfAborted(signal);
    return row === undefined ? null : ProviderCreateAttemptRecordSchema.parse(parseJson(row.recordJson));
  }

  async listUnresolvedProviderCreateAttempts(signal: AbortSignal): Promise<readonly ProviderCreateAttemptRecord[]> {
    throwIfAborted(signal);
    const rows = await this.db.select({ recordJson: providerCreateAttempts.recordJson }).from(providerCreateAttempts)
      .where(inArray(providerCreateAttempts.status, ["started", "session_found", "unresolved", "release_failed"]))
      .orderBy(asc(providerCreateAttempts.updatedAt));
    throwIfAborted(signal);
    return rows.map((row) => ProviderCreateAttemptRecordSchema.parse(parseJson(row.recordJson)));
  }

  async upsertCapability(capabilityInput: RuntimeCapability, signal: AbortSignal): Promise<RuntimeCapability> {
    throwIfAborted(signal);
    const parsed = RuntimeCapabilitySchema.parse(capabilityInput);
    const capability = RuntimeCapabilitySchema.parse({
      ...parsed,
      details: redactJson(parsed.details, this.redaction),
      error: parsed.error === null ? null : this.redactClosedRecord(parsed.error),
    });
    const values = {
      kind: capability.kind,
      subject: capability.subject,
      status: capability.status,
      detailsJson: JSON.stringify(capability.details),
      checkedAt: capability.checkedAt,
      errorJson: capability.error === null ? null : JSON.stringify(capability.error),
    };
    await this.writer.enqueue(async () => {
      throwIfAborted(signal);
      await this.db.insert(capabilityChecks).values(values).onConflictDoUpdate({
        target: [capabilityChecks.kind, capabilityChecks.subject],
        set: values,
      });
    });
    return capability;
  }

  async listCapabilities(signal: AbortSignal): Promise<readonly RuntimeCapability[]> {
    throwIfAborted(signal);
    const rows = await this.db.select().from(capabilityChecks).orderBy(asc(capabilityChecks.kind), asc(capabilityChecks.subject));
    throwIfAborted(signal);
    return rows.map((row) => RuntimeCapabilitySchema.parse({
      schemaVersion: 1,
      kind: row.kind,
      subject: row.subject,
      status: row.status,
      details: parseJson(row.detailsJson),
      checkedAt: row.checkedAt,
      error: row.errorJson === null ? null : parseJson(row.errorJson),
    }));
  }

  async replaceDiscoveredInterfaces(runId: RunId, inputs: readonly DiscoveredInterface[], signal: AbortSignal): Promise<readonly DiscoveredInterface[]> {
    throwIfAborted(signal);
    const interfaces = inputs.map((input) => DiscoveredInterfaceSchema.parse(
      this.redactClosedRecord(DiscoveredInterfaceSchema.parse(input)),
    ));
    await this.writer.enqueue(async () => this.db.transaction(async (tx) => {
      throwIfAborted(signal);
      await tx.delete(discoveredInterfaces).where(eq(discoveredInterfaces.runId, runId));
      if (interfaces.length > 0) await tx.insert(discoveredInterfaces).values(interfaces.map((item) => ({
        runId,
        kind: item.kind,
        name: item.name,
        metadataJson: JSON.stringify(item.metadata),
        discoveredAt: item.discoveredAt,
      })));
    }));
    return interfaces;
  }

  async getEvaluationCleanup(evaluationId: EvaluationId, signal: AbortSignal): Promise<PersistedCleanupState | null> {
    throwIfAborted(signal);
    const [evaluationRow] = await this.db.select({ id: evaluations.id }).from(evaluations)
      .where(eq(evaluations.id, evaluationId)).limit(1);
    if (evaluationRow === undefined) return null;
    const runRows = await this.db.select({ id: runs.id, entityJson: runs.entityJson }).from(runs)
      .where(eq(runs.evaluationId, evaluationId)).orderBy(asc(runs.runIndex));
    const runIds = runRows.map((row) => RunIdSchema.parse(row.id));
    if (runIds.length === 0) return { evaluationId, browserSessions: [], providerCreateAttempts: [], potentialLeakRunIds: [] };
    const [sessionRows, attemptRows] = await Promise.all([
      this.db.select().from(browserSessions).where(inArray(browserSessions.runId, runIds)),
      this.db.select({ recordJson: providerCreateAttempts.recordJson }).from(providerCreateAttempts)
        .where(inArray(providerCreateAttempts.runId, runIds)),
    ]);
    throwIfAborted(signal);
    const sessions = sessionRows.map((row) => this.browserSessionFromRow(row));
    const attempts = attemptRows.map((row) => ProviderCreateAttemptRecordSchema.parse(parseJson(row.recordJson)));
    const leaked = new Set<RunId>();
    for (const row of runRows) if (RunSchema.parse(parseJson(row.entityJson)).potentialSessionLeak) leaked.add(RunIdSchema.parse(row.id));
    for (const session of sessions) if (!session.releaseConfirmed) leaked.add(session.runId);
    for (const attempt of attempts) if (attempt.potentialSessionLeak) leaked.add(attempt.runId);
    return { evaluationId, browserSessions: sessions, providerCreateAttempts: attempts, potentialLeakRunIds: [...leaked] };
  }

  async getEvaluationReport(evaluationId: EvaluationId, signal: AbortSignal): Promise<PersistedEvaluationReport | null> {
    return this.writer.enqueue(async () => {
      const snapshot = await this.getEvaluationSnapshot(evaluationId, signal);
    if (snapshot === null) return null;
    const [evaluationRow] = await this.db.select({ specificationHash: evaluations.specificationHash }).from(evaluations)
      .where(eq(evaluations.id, evaluationId)).limit(1);
    if (evaluationRow === undefined) return null;
    const cleanup = await this.getEvaluationCleanup(evaluationId, signal);
    if (cleanup === null) return null;
    const runIds = snapshot.runs.map((run) => run.id);
    const steps = (await Promise.all(runIds.map((runId) => this.listRunSteps(runId, signal)))).flat();
    const eventRows = await this.listEventsThrough(evaluationId, snapshot.latestCursor, signal);
    if (runIds.length === 0) return {
      snapshot,
      specificationHash: evaluationRow.specificationHash,
      steps,
      events: eventRows,
      interfaces: [],
      evidence: [],
      browserSessions: [],
      grades: [],
      cleanup,
    };
    const [interfaceRows, evidenceRows, gradeRows] = await Promise.all([
      this.db.select().from(discoveredInterfaces).where(inArray(discoveredInterfaces.runId, runIds)),
      this.db.select().from(assertionEvidence).where(inArray(assertionEvidence.runId, runIds)),
      this.db.select().from(gradeResults).where(inArray(gradeResults.runId, runIds)),
    ]);
    throwIfAborted(signal);
    return {
      snapshot,
      specificationHash: evaluationRow.specificationHash,
      steps,
      events: eventRows,
      interfaces: interfaceRows.map((row) => ({
        runId: RunIdSchema.parse(row.runId),
        ...DiscoveredInterfaceSchema.parse({
          schemaVersion: 1,
          kind: row.kind,
          name: row.name,
          metadata: parseJson(row.metadataJson),
          discoveredAt: row.discoveredAt,
        }),
      })),
      evidence: evidenceRows.map((row) => ({
        runId: RunIdSchema.parse(row.runId),
        ...BrowserAssertionEvidenceV1Schema.parse(parseJson(row.evidenceJson)),
      })),
      browserSessions: cleanup.browserSessions,
      grades: gradeRows.map((row) => ({ runId: RunIdSchema.parse(row.runId), ...GradeResultSchema.parse(parseJson(row.resultJson)) })),
      cleanup,
    };
    });
  }

  async ping(signal: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    await this.client.execute("SELECT 1");
    throwIfAborted(signal);
    return true;
  }

  async getEvaluationSnapshot(evaluationId: EvaluationId, signal: AbortSignal): Promise<EvaluationSnapshot | null> {
    throwIfAborted(signal);
    const snapshotRows = await this.db.transaction(async (tx) => {
      const [evaluationRow] = await tx.select().from(evaluations).where(eq(evaluations.id, evaluationId)).limit(1);
      if (evaluationRow === undefined) return null;
      const runRows = await tx.select().from(runs).where(eq(runs.evaluationId, evaluationId)).orderBy(asc(runs.runIndex));
      const [latest] = await tx.select({ cursor: events.cursor }).from(events)
        .where(eq(events.evaluationId, evaluationId)).orderBy(desc(events.cursor)).limit(1);
      throwIfAborted(signal);
      return { evaluationRow, runRows, latest };
    });
    if (snapshotRows === null) return null;
    const { evaluationRow, runRows, latest } = snapshotRows;
    const evaluation = EvaluationSchema.parse(parseJson(evaluationRow.entityJson));
    const parsedRuns = runRows.map((row) => RunSchema.parse(parseJson(row.entityJson)));

    const passed = parsedRuns.filter((run) => run.outcome === "passed").length;
    const failed = parsedRuns.filter((run) => run.outcome === "failed").length;
    const inconclusive = parsedRuns.filter((run) => run.outcome === "inconclusive").length;
    const cancelled = parsedRuns.filter((run) => run.status === "cancelled").length;
    const requested = parsedRuns.length;
    const terminal = passed + failed + inconclusive + cancelled;
    const started = parsedRuns.filter((run) => run.startedAt !== null || run.status !== "queued").length;
    const potentialLeaks = parsedRuns.filter((run) => run.potentialSessionLeak).length;
    return EvaluationSnapshotSchema.parse({
      schemaVersion: 2,
      evaluationId: evaluation.id,
      status: evaluation.status,
      config: evaluation.config,
      createdAt: evaluation.createdAt,
      startedAt: evaluation.startedAt,
      finishedAt: evaluation.finishedAt,
      aggregate: {
        requested,
        started,
        passed,
        failed,
        inconclusive,
        cancelled,
        nonterminal: requested - terminal,
        potentialLeaks,
        endToEndPassRate: { numerator: passed, denominator: requested, value: requested === 0 ? null : passed / requested },
        gradeableObservableStateSuccess: {
          numerator: passed,
          denominator: passed + failed,
          value: passed + failed === 0 ? null : passed / (passed + failed),
        },
      },
      runs: parsedRuns.map((run) => ({
        id: run.id,
        runIndex: run.runIndex,
        modelId: run.modelId,
        status: run.status,
        outcome: run.outcome,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        iterations: run.iterations,
        toolCalls: run.toolCalls,
        browserActions: run.browserActions,
        interfaceUsage: run.interfaceUsage,
        usage: run.usage,
        failure: run.failure,
        grade: run.grade,
        warnings: run.warnings,
        releaseStatus: run.releaseStatus,
        replayStatus: run.replayStatus,
        potentialSessionLeak: run.potentialSessionLeak,
      })),
      latestCursor: latest === undefined ? null : EventCursorSchema.parse(String(latest.cursor)),
    });
  }

  async listRunSteps(runId: Run["id"], signal: AbortSignal): Promise<readonly RunStep[]> {
    throwIfAborted(signal);
    const rows = await this.db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.sequence));
    throwIfAborted(signal);
    return rows.map((row) => RunStepSchema.parse({
      schemaVersion: 2,
      runId: row.runId,
      sequence: row.sequence,
      kind: row.kind,
      payload: parseJson(row.payloadJson),
      interactionMode: row.interactionMode,
      observationRevision: row.observationRevision,
      durationMs: row.durationMs,
      occurredAt: row.occurredAt,
    }));
  }

  async listEventsAfter(evaluationId: EvaluationId, cursor: EventCursor | null, limit: number, signal: AbortSignal): Promise<readonly EventEnvelope[]> {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Event list limit must be between 1 and 100");
    const condition = cursor === null
      ? eq(events.evaluationId, evaluationId)
      : and(eq(events.evaluationId, evaluationId), gt(events.cursor, this.cursorNumber(cursor)));
    const rows = await this.db.select().from(events).where(condition).orderBy(asc(events.cursor)).limit(limit);
    throwIfAborted(signal);
    return rows.map((row) => this.eventEnvelopeFromRow(row));
  }

  private async listEventsThrough(
    evaluationId: EvaluationId,
    latestCursor: EventCursor | null,
    signal: AbortSignal,
  ): Promise<readonly EventEnvelope[]> {
    if (latestCursor === null) return [];
    const result: EventEnvelope[] = [];
    let cursor: EventCursor | null = null;
    while (cursor === null || BigInt(cursor) < BigInt(latestCursor)) {
      const page = await this.listEventsAfter(evaluationId, cursor, 100, signal);
      const anchored = page.filter((event) => BigInt(event.cursor) <= BigInt(latestCursor));
      result.push(...anchored);
      if (result.length > 10_000) throw new Error("Evaluation report exceeds the 10,000 event safety bound");
      const nextCursor = anchored.at(-1)?.cursor;
      if (nextCursor === undefined) throw new Error("Evaluation report event history is incomplete at its snapshot cursor");
      cursor = nextCursor;
    }
    return result;
  }

  async close(): Promise<void> {
    await this.writer.enqueue(async () => {
      await this.client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
      this.client.close();
    });
  }

  private eventValues(event: EventAppendInput, recordedAt: UtcDateTime): typeof events.$inferInsert {
    return {
      eventId: event.eventId,
      evaluationId: event.evaluationId,
      runId: event.runId,
      runSequence: event.runSequence,
      type: event.type,
      occurredAt: event.occurredAt,
      recordedAt,
      payloadJson: JSON.stringify(event.payload),
    };
  }

  private assertionEvidenceValues(
    runId: RunId,
    evidence: BrowserAssertionEvidenceV1,
  ): typeof assertionEvidence.$inferInsert {
    return {
      runId,
      evidenceHash: evidence.evidenceHash,
      capturedAt: evidence.capturedAt,
      redactedDisplayUrl: evidence.redactedDisplayUrl,
      documentIdHash: evidence.documentIdHash,
      loaderIdHash: evidence.loaderIdHash,
      unverifiableCount: evidence.assertions.filter((assertion) => assertion.status === "unverifiable").length,
      evidenceJson: JSON.stringify(evidence),
    };
  }

  private gradeValues(runId: RunId, grade: GradeResult): typeof gradeResults.$inferInsert {
    return {
      runId,
      evidenceHash: grade.evidenceHash,
      outcome: grade.outcome,
      assertionResultsJson: JSON.stringify(grade.assertions),
      gradedAt: grade.gradedAt,
      resultJson: JSON.stringify(grade),
    };
  }

  private browserSessionValues(session: BrowserSessionSummary): typeof browserSessions.$inferInsert {
    return {
      runId: session.runId,
      providerSessionId: session.providerSessionId,
      region: session.region,
      acquiredAt: session.acquiredAt,
      releasedAt: session.releasedAt,
      releaseStatus: session.releaseStatus,
      releaseConfirmed: session.releaseConfirmed,
      replayStatus: session.replayStatus,
      recordingRequested: session.recordingRequested,
    };
  }

  private browserSessionFromRow(row: typeof browserSessions.$inferSelect): BrowserSessionSummary {
    return BrowserSessionSummarySchema.parse({
      schemaVersion: 2,
      runId: row.runId,
      providerSessionId: row.providerSessionId,
      region: row.region,
      acquiredAt: row.acquiredAt,
      releasedAt: row.releasedAt,
      releaseStatus: row.releaseStatus,
      releaseConfirmed: row.releaseConfirmed,
      replayStatus: row.replayStatus,
      recordingRequested: row.recordingRequested,
    });
  }

  private providerCreateAttemptValues(record: ProviderCreateAttemptRecord): typeof providerCreateAttempts.$inferInsert {
    return {
      runId: record.runId,
      attemptCorrelationId: record.attemptCorrelationId,
      status: record.status,
      ...(record.providerSessionId === null ? {} : { providerSessionId: record.providerSessionId }),
      potentialSessionLeak: record.potentialSessionLeak,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      recordJson: JSON.stringify(record),
    };
  }

  private evaluationValues(evaluation: Evaluation): typeof evaluations.$inferInsert {
    const configJson = JSON.stringify(evaluation.config);
    return {
      id: evaluation.id,
      schemaVersion: evaluation.schemaVersion,
      status: evaluation.status,
      createdAt: evaluation.createdAt,
      startedAt: evaluation.startedAt,
      finishedAt: evaluation.finishedAt,
      specificationHash: createHash("sha256").update(configJson).digest("hex"),
      targetStartUrl: evaluation.config.target.startUrl,
      allowedNavigationOriginsJson: JSON.stringify(evaluation.config.target.allowedNavigationOrigins),
      prompt: evaluation.config.prompt,
      assertionsJson: JSON.stringify(evaluation.config.assertions),
      configJson,
      entityJson: JSON.stringify(evaluation),
    };
  }

  private runValues(run: Run): typeof runs.$inferInsert {
    return {
      id: run.id,
      evaluationId: run.evaluationId,
      schemaVersion: run.schemaVersion,
      runIndex: run.runIndex,
      modelId: run.modelId,
      status: run.status,
      outcome: run.outcome,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      evidenceHash: run.grade?.evidenceHash ?? null,
      releaseStatus: run.releaseStatus,
      potentialSessionLeak: run.potentialSessionLeak,
      entityJson: JSON.stringify(run),
    };
  }

  private sanitizeEvaluation(value: Evaluation): Evaluation {
    return EvaluationSchema.parse(this.redactClosedRecord(EvaluationSchema.parse(value)));
  }

  private sanitizeRun(value: Run): Run {
    return RunSchema.parse(this.redactClosedRecord(RunSchema.parse(value)));
  }

  private sanitizeStep(value: RunStep): RunStep {
    const parsed = RunStepSchema.parse(value);
    return RunStepSchema.parse({ ...parsed, payload: redactJson(parsed.payload, this.redaction) });
  }

  private sanitizeEvent(value: EventAppendInput): EventAppendInput {
    const parsed = EventAppendInputSchema.parse(value);
    if (parsed.type === "run.usage.updated") return parsed;
    return EventAppendInputSchema.parse({ ...parsed, payload: redactJson(parsed.payload, this.redaction) });
  }

  private redactClosedRecord<T>(value: T): unknown {
    const redacted = redactJson(JSON.stringify(value), { ...this.redaction, maxStringLength: 262_144 });
    if (typeof redacted !== "string") throw new Error("Closed record redaction returned a non-string value");
    return parseJson(redacted);
  }

  private eventEnvelopeFromRow(row: typeof events.$inferSelect): EventEnvelope {
    return EventEnvelopeSchema.parse({
      schemaVersion: 1,
      eventId: row.eventId,
      cursor: String(row.cursor),
      evaluationId: row.evaluationId,
      runId: row.runId,
      runSequence: row.runSequence,
      type: row.type,
      occurredAt: row.occurredAt,
      recordedAt: row.recordedAt,
      payload: parseJson(row.payloadJson),
    });
  }

  private cursorNumber(cursor: EventCursor): number {
    const parsed = Number(cursor);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Cursor exceeds the local SQLite safe integer range");
    return parsed;
  }

  private nowIso(): UtcDateTime {
    return this.now().toISOString() as UtcDateTime;
  }
}
