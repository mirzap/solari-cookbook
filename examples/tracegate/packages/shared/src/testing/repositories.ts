import { EventCursorSchema, type EventCursor, type EvaluationId, type RunId } from "../ids.ts";
import type { Evaluation, Run } from "../entities.ts";
import { EventAppendInputSchema, EventEnvelopeSchema, type EventAppendInput, type EventEnvelope } from "../events.ts";
import type {
  Clock,
  EvaluationRepository,
  EvaluationStatusPatch,
  EventRepository,
  FinalizeRunInput,
  FinalizeRunResult,
  RunRepository,
  RunStatusPatch,
} from "../ports.ts";
import { FinalizeRunInputSchema } from "../ports.ts";
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

export class InMemoryRunRepository implements RunRepository {
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
}
