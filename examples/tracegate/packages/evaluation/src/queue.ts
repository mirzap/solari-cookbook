import type { EvaluationId } from "@tracegate/shared";

export class EvaluationQueueFullError extends Error {
  readonly code = "evaluation_queue_full" as const;
  readonly maxPending: number;

  constructor(maxPending: number) {
    super("The bounded evaluation queue is full");
    this.name = "EvaluationQueueFullError";
    this.maxPending = maxPending;
  }
}

export class DuplicateEvaluationJobError extends Error {
  readonly code = "duplicate_evaluation_job" as const;
  readonly evaluationId: EvaluationId;

  constructor(evaluationId: EvaluationId) {
    super(`Evaluation ${evaluationId} is already active, queued, or reserved`);
    this.name = "DuplicateEvaluationJobError";
    this.evaluationId = evaluationId;
  }
}

export type EvaluationQueueReservationState = "reserved" | "committed" | "released" | "cancelled";

export class EvaluationQueueReservationStateError extends Error {
  readonly code = "invalid_evaluation_queue_reservation_state" as const;
  readonly state: EvaluationQueueReservationState;

  constructor(state: EvaluationQueueReservationState) {
    super(`Evaluation queue reservation cannot be committed from ${state} state`);
    this.name = "EvaluationQueueReservationStateError";
    this.state = state;
  }
}

export interface EvaluationQueueReservation<T> {
  readonly evaluationId: EvaluationId;
  readonly state: EvaluationQueueReservationState;
  commit(): Promise<T>;
  release(): void;
}

interface QueuedJob<T> {
  readonly evaluationId: EvaluationId;
  readonly execute: (signal: AbortSignal) => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  readonly controller: AbortController;
}

interface ReservedJob<T> {
  readonly evaluationId: EvaluationId;
  readonly execute: (signal: AbortSignal) => Promise<T>;
  readonly controller: AbortController;
  state: EvaluationQueueReservationState;
}

export interface EvaluationQueueState {
  readonly activeEvaluationId: EvaluationId | null;
  readonly pendingEvaluationIds: readonly EvaluationId[];
  readonly reservedEvaluationIds: readonly EvaluationId[];
  readonly maxPending: number;
}

export class OneEvaluationQueue {
  readonly #maxPending: number;
  readonly #pending: QueuedJob<unknown>[] = [];
  readonly #reserved = new Map<EvaluationId, ReservedJob<unknown>>();
  #active: QueuedJob<unknown> | null = null;
  #idleWaiters: Array<() => void> = [];

  constructor(maxPending = 1) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 0 || maxPending > 10) throw new RangeError("maxPending must be 0...10");
    this.#maxPending = maxPending;
  }

  reserve<T>(
    evaluationId: EvaluationId,
    execute: (signal: AbortSignal) => Promise<T>,
  ): EvaluationQueueReservation<T> {
    if (this.#contains(evaluationId)) throw new DuplicateEvaluationJobError(evaluationId);
    const occupied = (this.#active === null ? 0 : 1) + this.#pending.length + this.#reserved.size;
    if (occupied >= 1 + this.#maxPending) throw new EvaluationQueueFullError(this.#maxPending);

    const record: ReservedJob<T> = {
      evaluationId,
      execute,
      controller: new AbortController(),
      state: "reserved",
    };
    this.#reserved.set(evaluationId, record as ReservedJob<unknown>);
    const queue = this;

    return {
      evaluationId,
      get state(): EvaluationQueueReservationState { return record.state; },
      commit(): Promise<T> {
        if (record.state !== "reserved") throw new EvaluationQueueReservationStateError(record.state);
        queue.#reserved.delete(evaluationId);
        record.state = "committed";
        const result = new Promise<T>((resolve, reject) => {
          queue.#pending.push({
            evaluationId,
            execute,
            resolve,
            reject,
            controller: record.controller,
          } as QueuedJob<unknown>);
          queue.#pump();
        });
        return result;
      },
      release(): void {
        if (record.state !== "reserved") return;
        queue.#reserved.delete(evaluationId);
        record.state = "released";
        record.controller.abort("evaluation reservation released before submission");
        queue.#settleIdle();
      },
    };
  }

  enqueue<T>(evaluationId: EvaluationId, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return this.reserve(evaluationId, execute).commit();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  cancel(evaluationId: EvaluationId): boolean {
    if (this.#active?.evaluationId === evaluationId) {
      this.#active.controller.abort("evaluation cancelled");
      return true;
    }

    const pendingIndex = this.#pending.findIndex((job) => job.evaluationId === evaluationId);
    if (pendingIndex >= 0) {
      const [job] = this.#pending.splice(pendingIndex, 1);
      job?.controller.abort("evaluation cancelled before start");
      job?.reject(new DOMException("The operation was aborted", "AbortError"));
      this.#settleIdle();
      return true;
    }

    const reservation = this.#reserved.get(evaluationId);
    if (reservation === undefined) return false;
    this.#reserved.delete(evaluationId);
    reservation.state = "cancelled";
    reservation.controller.abort("evaluation reservation cancelled before submission");
    this.#settleIdle();
    return true;
  }

  state(): EvaluationQueueState {
    return {
      activeEvaluationId: this.#active?.evaluationId ?? null,
      pendingEvaluationIds: this.#pending.map((job) => job.evaluationId),
      reservedEvaluationIds: [...this.#reserved.keys()],
      maxPending: this.#maxPending,
    };
  }

  async idle(): Promise<void> {
    if (this.#active === null && this.#pending.length === 0 && this.#reserved.size === 0) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  #contains(evaluationId: EvaluationId): boolean {
    return this.#active?.evaluationId === evaluationId
      || this.#pending.some((job) => job.evaluationId === evaluationId)
      || this.#reserved.has(evaluationId);
  }

  #pump(): void {
    if (this.#active !== null) return;
    const job = this.#pending.shift();
    if (job === undefined) {
      this.#settleIdle();
      return;
    }
    this.#active = job;
    void Promise.resolve()
      .then(() => job.execute(job.controller.signal))
      .then(job.resolve, job.reject)
      .finally(() => {
        this.#active = null;
        this.#pump();
      });
  }

  #settleIdle(): void {
    if (this.#active !== null || this.#pending.length > 0 || this.#reserved.size > 0) return;
    const waiters = this.#idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
