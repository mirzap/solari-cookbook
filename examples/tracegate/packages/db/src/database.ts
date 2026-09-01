import { createClient, type Client } from "@libsql/client";
import {
  EvaluationSchema,
  EvaluationSnapshotSchema,
  EventAppendInputSchema,
  EventCursorSchema,
  EventEnvelopeSchema,
  RunSchema,
  RunStepSchema,
  redactJson,
  validateRunTransition,
  type Evaluation,
  type EvaluationId,
  type EvaluationSnapshot,
  type EventAppendInput,
  type EventCursor,
  type EventEnvelope,
  type RedactionOptions,
  type Run,
  type RunStatus,
  type RunStep,
  type RunTransitionContext,
  type UtcDateTime,
} from "@tracegate/shared";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { migrateTracegateDatabase } from "./migrate.ts";
import { evaluations, events, runs, runSteps, tracegateSchema } from "./schema.ts";

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

  private constructor(
    private readonly client: Client,
    private readonly db: Database,
    knownSecrets: readonly string[],
    private readonly now: () => Date,
  ) {
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
        await tx.insert(evaluations).values({
          id: evaluation.id,
          status: evaluation.status,
          createdAt: evaluation.createdAt,
          entityJson: JSON.stringify(evaluation),
        });
        if (runRows.length > 0) {
          await tx.insert(runs).values(runRows.map((run) => ({
            id: run.id,
            evaluationId: run.evaluationId,
            runIndex: run.runIndex,
            status: run.status,
            outcome: run.outcome,
            createdAt: run.createdAt,
            entityJson: JSON.stringify(run),
          })));
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
          .set({ status: run.status, outcome: run.outcome, entityJson: JSON.stringify(run) })
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
    return EvaluationSnapshotSchema.parse({
      schemaVersion: 1,
      evaluationId: evaluation.id,
      status: evaluation.status,
      config: evaluation.config,
      createdAt: evaluation.createdAt,
      startedAt: evaluation.startedAt,
      finishedAt: evaluation.finishedAt,
      aggregate: {
        requested,
        completed: parsedRuns.filter((run) => run.status === "completed").length,
        passed,
        failed,
        inconclusive,
        cancelled,
        passRate: { numerator: passed, denominator: requested, value: requested === 0 ? null : passed / requested },
      },
      runs: parsedRuns.map((run) => ({
        id: run.id,
        runIndex: run.runIndex,
        modelId: run.modelId,
        status: run.status,
        outcome: run.outcome,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        iterations: run.iterations,
        toolCalls: run.toolCalls,
        browserActions: run.browserActions,
        failure: run.failure,
        warnings: run.warnings,
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
      schemaVersion: 1,
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

  async close(): Promise<void> {
    await this.writer.enqueue(async () => {
      await this.client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
      this.client.close();
    });
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
