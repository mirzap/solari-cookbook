import { EventCursorSchema, type CreateAttemptCorrelationId, type EventCursor, type EvaluationId, type RunId } from "../ids.ts";
import type { Evaluation, Run } from "../entities.ts";
import { EventAppendInputSchema, EventEnvelopeSchema, type EventAppendInput, type EventEnvelope } from "../events.ts";
import type {
  Clock,
  CancelRunInput,
  CancelRunResult,
  EvaluationRepository,
  EvaluationStatusPatch,
  EvaluationSubmissionRepository,
  EvaluationSubmissionResult,
  EventRepository,
  FinalizeRunInput,
  FinalizeRunResult,
  IntermediateRunTransitionInput,
  IntermediateRunTransitionResult,
  ProviderCreateAttemptRecord,
  ProviderCreateAttemptRepository,
  ProviderCreateAttemptStatus,
  RunRepository,
  RunStatusPatch,
  RunTransitionRepository,
} from "../ports.ts";
import {
  EvaluationSubmissionInputSchema,
  EvaluationSubmissionResultSchema,
  CancelRunInputSchema,
  CancelRunResultSchema,
  FinalizeRunInputSchema,
  IntermediateRunTransitionInputSchema,
  IntermediateRunTransitionResultSchema,
  ProviderCreateAttemptRecordSchema,
} from "../ports.ts";
import { EvaluationSchema, RunSchema } from "../entities.ts";
import type { EvaluationStatus, RunStatus } from "../states.ts";

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
};
const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryEventRepository implements EventRepository {
  #events: EventEnvelope[] = [];
  #byId = new Map<string, EventEnvelope>();
  #clock: Clock;

  constructor(clock: Clock) { this.#clock = clock; }

  async append(input: EventAppendInput, signal: AbortSignal): Promise<EventEnvelope> {
    throwIfAborted(signal);
    const duplicate = this.#byId.get(input.eventId);
    if (duplicate) {
      const original = EventAppendInputSchema.parse(duplicate);
      if (JSON.stringify(original) !== JSON.stringify(input)) throw new Error("eventId already exists with different event content");
      return clone(duplicate);
    }
    const envelope = EventEnvelopeSchema.parse({
      ...input,
      cursor: String(this.#events.length + 1),
      recordedAt: this.#clock.nowIso(),
    });
    this.#events.push(envelope);
    this.#byId.set(envelope.eventId, envelope);
    return clone(envelope);
  }

  async listAfter(evaluationId: EvaluationId, cursor: EventCursor | null, limit: number, signal: AbortSignal): Promise<readonly EventEnvelope[]> {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("limit must be 1...1000");
    const after = cursor === null ? 0n : BigInt(cursor);
    return this.#events.filter((event) => event.evaluationId === evaluationId && BigInt(event.cursor) > after).slice(0, limit).map(clone);
  }

  async earliestCursor(evaluationId: EvaluationId, signal: AbortSignal): Promise<EventCursor | null> {
    throwIfAborted(signal);
    const event = this.#events.find((candidate) => candidate.evaluationId === evaluationId);
    return event ? EventCursorSchema.parse(event.cursor) : null;
  }

  async latestCursor(evaluationId: EvaluationId, signal: AbortSignal): Promise<EventCursor | null> {
    throwIfAborted(signal);
    const event = this.#events.findLast((candidate) => candidate.evaluationId === evaluationId);
    return event ? EventCursorSchema.parse(event.cursor) : null;
  }
}

export class InMemoryEvaluationRepository implements EvaluationRepository {
  #records = new Map<string, Evaluation>();

  async create(evaluation: Evaluation, signal: AbortSignal): Promise<Evaluation> {
    throwIfAborted(signal);
    if (this.#records.has(evaluation.id)) throw new Error("evaluation already exists");
    const parsed = EvaluationSchema.parse(evaluation);
    this.#records.set(parsed.id, parsed);
    return clone(parsed);
  }

  async get(id: EvaluationId, signal: AbortSignal): Promise<Evaluation | null> {
    throwIfAborted(signal);
    const value = this.#records.get(id);
    return value ? clone(value) : null;
  }

  async compareAndSetStatus(id: EvaluationId, expected: EvaluationStatus, next: EvaluationStatus, patch: EvaluationStatusPatch, signal: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    const current = this.#records.get(id);
    if (!current || current.status !== expected) return false;
    this.#records.set(id, EvaluationSchema.parse({ ...current, ...patch, status: next }));
    return true;
  }

  async listRecoverable(signal: AbortSignal): Promise<readonly Evaluation[]> {
    throwIfAborted(signal);
    return [...this.#records.values()].filter((value) => !["completed", "cancelled", "failed"].includes(value.status)).map(clone);
  }
}

export class InMemoryRunRepository implements RunRepository, RunTransitionRepository {
  #records = new Map<string, Run>();
  #events: EventRepository;
  #transactionTail: Promise<void> = Promise.resolve();

  constructor(events: EventRepository) { this.#events = events; }

  async create(run: Run, signal: AbortSignal): Promise<Run> {
    throwIfAborted(signal);
    if (this.#records.has(run.id)) throw new Error("run already exists");
    const parsed = RunSchema.parse(run);
    this.#records.set(parsed.id, parsed);
    return clone(parsed);
  }

  async get(id: RunId, signal: AbortSignal): Promise<Run | null> {
    throwIfAborted(signal);
    const value = this.#records.get(id);
    return value ? clone(value) : null;
  }

  async compareAndSetStatus(id: RunId, expected: RunStatus, next: RunStatus, patch: RunStatusPatch, signal: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    const current = this.#records.get(id);
    if (!current || current.status !== expected) return false;
    this.#records.set(id, RunSchema.parse({ ...current, ...patch, status: next }));
    return true;
  }

  async listRecoverable(signal: AbortSignal): Promise<readonly Run[]> {
    throwIfAborted(signal);
    return [...this.#records.values()].filter((value) => value.status !== "completed" && value.status !== "cancelled").map(clone);
  }

  async transactionallyApply(input: IntermediateRunTransitionInput, signal: AbortSignal): Promise<IntermediateRunTransitionResult> {
    const validated = IntermediateRunTransitionInputSchema.parse(input);
    let unlock!: () => void;
    const prior = this.#transactionTail;
    this.#transactionTail = new Promise<void>((resolve) => { unlock = resolve; });
    await prior;
    try {
      throwIfAborted(signal);
      const current = this.#records.get(validated.runId);
      if (!current || current.status !== validated.expectedStatus) {
        return IntermediateRunTransitionResultSchema.parse({ applied: false, run: current ?? null, event: null });
      }
      const run = RunSchema.parse({ ...current, ...validated.patch, status: validated.nextStatus });
      const event = await this.#events.append(validated.event, signal);
      this.#records.set(run.id, run);
      return IntermediateRunTransitionResultSchema.parse({ applied: true, run, event });
    } finally {
      unlock();
    }
  }

  async transactionallyFinalize(input: FinalizeRunInput, signal: AbortSignal): Promise<FinalizeRunResult> {
    const validated = FinalizeRunInputSchema.parse(input);
    let unlock!: () => void;
    const prior = this.#transactionTail;
    this.#transactionTail = new Promise<void>((resolve) => { unlock = resolve; });
    await prior;
    try {
      throwIfAborted(signal);
      const current = this.#records.get(validated.runId);
      if (!current || current.status !== validated.expectedStatus) return { applied: false, run: current ? clone(current) : null, event: null };
      const run = RunSchema.parse({
        ...current,
        ...(validated.resultPatch ?? {}),
        status: "completed",
        outcome: validated.outcome,
        grade: validated.grade,
        failure: validated.failure,
        warnings: validated.warnings,
        finishedAt: validated.finishedAt,
        durationMs: current.startedAt === null ? null : Math.max(0, Date.parse(validated.finishedAt) - Date.parse(current.startedAt)),
      });
      const event = await this.#events.append(validated.event, signal);
      this.#records.set(run.id, run);
      return { applied: true, run: clone(run), event };
    } finally {
      unlock();
    }
  }

  async transactionallyCancel(input: CancelRunInput, signal: AbortSignal): Promise<CancelRunResult> {
    const validated = CancelRunInputSchema.parse(input);
    let unlock!: () => void;
    const prior = this.#transactionTail;
    this.#transactionTail = new Promise<void>((resolve) => { unlock = resolve; });
    await prior;
    try {
      throwIfAborted(signal);
      const current = this.#records.get(validated.runId);
      if (!current || current.status !== validated.expectedStatus) {
        return CancelRunResultSchema.parse({ applied: false, run: current ?? null, event: null });
      }
      const run = RunSchema.parse({
        ...current,
        status: "cancelled",
        outcome: null,
        grade: null,
        failure: null,
        finishedAt: validated.finishedAt,
        durationMs: current.startedAt === null ? null : Math.max(0, Date.parse(validated.finishedAt) - Date.parse(current.startedAt)),
        releaseStatus: validated.releaseStatus,
        warnings: validated.warnings,
        potentialSessionLeak: validated.potentialSessionLeak,
      });
      const event = await this.#events.append(validated.event, signal);
      this.#records.set(run.id, run);
      return CancelRunResultSchema.parse({ applied: true, run, event });
    } finally {
      unlock();
    }
  }
}

export class InMemoryEvaluationSubmissionRepository implements EvaluationSubmissionRepository {
  #evaluations = new Map<string, Evaluation>();
  #runs = new Map<string, Run>();
  #queuedEvents = new Map<string, EventEnvelope>();
  #clock: Clock;
  #transactionTail: Promise<void> = Promise.resolve();

  constructor(clock: Clock) { this.#clock = clock; }

  async transactionallyCreate(input: Parameters<EvaluationSubmissionRepository["transactionallyCreate"]>[0], signal: AbortSignal): Promise<EvaluationSubmissionResult> {
    const validated = EvaluationSubmissionInputSchema.parse(input);
    let unlock!: () => void;
    const prior = this.#transactionTail;
    this.#transactionTail = new Promise<void>((resolve) => { unlock = resolve; });
    await prior;
    try {
      throwIfAborted(signal);
      const existing = this.#evaluations.get(validated.evaluation.id);
      if (existing) {
        const runs = validated.runs.map((run) => this.#runs.get(run.id));
        const queuedEvents = validated.queuedEvents.map((event) => this.#queuedEvents.get(event.eventId));
        if (runs.some((run) => run === undefined) || queuedEvents.some((event) => event === undefined)) {
          throw new Error("atomic submission identity collides with incomplete stored data");
        }
        const storedInputs = queuedEvents.map((event) => EventAppendInputSchema.parse(event));
        if (JSON.stringify(existing) !== JSON.stringify(validated.evaluation)
          || JSON.stringify(runs) !== JSON.stringify(validated.runs)
          || JSON.stringify(storedInputs) !== JSON.stringify(validated.queuedEvents)) {
          throw new Error("atomic submission identity conflicts with different content");
        }
        return EvaluationSubmissionResultSchema.parse({ created: false, evaluation: existing, runs, queuedEvents });
      }
      if (validated.runs.some((run) => this.#runs.has(run.id)) || validated.queuedEvents.some((event) => this.#queuedEvents.has(event.eventId))) {
        throw new Error("atomic submission contains a colliding run or event identity");
      }
      const envelopes = validated.queuedEvents.map((event, index) => EventEnvelopeSchema.parse({
        ...event,
        cursor: String(this.#queuedEvents.size + index + 1),
        recordedAt: this.#clock.nowIso(),
      }));
      this.#evaluations.set(validated.evaluation.id, clone(validated.evaluation));
      validated.runs.forEach((run) => this.#runs.set(run.id, clone(run)));
      envelopes.forEach((event) => this.#queuedEvents.set(event.eventId, clone(event)));
      return EvaluationSubmissionResultSchema.parse({ created: true, evaluation: validated.evaluation, runs: validated.runs, queuedEvents: envelopes });
    } finally {
      unlock();
    }
  }

  evaluation(id: EvaluationId): Evaluation | null { const value = this.#evaluations.get(id); return value ? clone(value) : null; }
  run(id: RunId): Run | null { const value = this.#runs.get(id); return value ? clone(value) : null; }
  events(): readonly EventEnvelope[] { return [...this.#queuedEvents.values()].map(clone); }
}

export class InMemoryProviderCreateAttemptRepository implements ProviderCreateAttemptRepository {
  #records = new Map<string, ProviderCreateAttemptRecord>();
  #key(runId: RunId, attemptCorrelationId: CreateAttemptCorrelationId): string { return `${runId}:${attemptCorrelationId}`; }

  async recordStarted(record: ProviderCreateAttemptRecord, signal: AbortSignal): Promise<ProviderCreateAttemptRecord> {
    throwIfAborted(signal);
    const parsed = ProviderCreateAttemptRecordSchema.parse(record);
    if (parsed.status !== "started") throw new Error("initial provider create-attempt record must be started");
    const key = this.#key(parsed.runId, parsed.attemptCorrelationId);
    if (this.#records.has(key)) throw new Error("provider create attempt already exists");
    this.#records.set(key, clone(parsed));
    return clone(parsed);
  }

  async transition(runId: RunId, attemptCorrelationId: CreateAttemptCorrelationId, expected: ProviderCreateAttemptStatus, next: ProviderCreateAttemptRecord, signal: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    const key = this.#key(runId, attemptCorrelationId);
    const current = this.#records.get(key);
    if (!current || current.status !== expected) return false;
    const parsed = ProviderCreateAttemptRecordSchema.parse(next);
    if (parsed.runId !== runId || parsed.attemptCorrelationId !== attemptCorrelationId || parsed.createdAt !== current.createdAt) throw new Error("provider create-attempt transition identity is immutable");
    this.#records.set(key, clone(parsed));
    return true;
  }

  async get(runId: RunId, attemptCorrelationId: CreateAttemptCorrelationId, signal: AbortSignal): Promise<ProviderCreateAttemptRecord | null> {
    throwIfAborted(signal);
    const value = this.#records.get(this.#key(runId, attemptCorrelationId));
    return value ? clone(value) : null;
  }

  async listUnresolved(signal: AbortSignal): Promise<readonly ProviderCreateAttemptRecord[]> {
    throwIfAborted(signal);
    return [...this.#records.values()].filter((record) => ["started", "unresolved", "session_found", "release_failed"].includes(record.status)).map(clone);
  }
}
