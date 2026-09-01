import type { EvaluationId } from "@tracegate/shared";

export class EvaluationQueueFullError extends Error {
  constructor() {
    super("The bounded evaluation queue is full");
    this.name = "EvaluationQueueFullError";
  }
}

export class DuplicateEvaluationJobError extends Error {
  constructor(evaluationId: EvaluationId) {
    super(`Evaluation ${evaluationId} is already active or queued`);
    this.name = "DuplicateEvaluationJobError";
  }
}

interface QueuedJob<T> {
  readonly evaluationId: EvaluationId;
  readonly execute: (signal: AbortSignal) => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  readonly controller: AbortController;
}

export interface EvaluationQueueState {
  readonly activeEvaluationId: EvaluationId | null;
  readonly pendingEvaluationIds: readonly EvaluationId[];
  readonly maxPending: number;
}

export class OneEvaluationQueue {
  readonly #maxPending: number;
  readonly #pending: QueuedJob<unknown>[] = [];
  #active: QueuedJob<unknown> | null = null;
  #idleWaiters: Array<() => void> = [];

  constructor(maxPending = 1) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 0 || maxPending > 10) throw new RangeError("maxPending must be 0...10");
    this.#maxPending = maxPending;
  }

  enqueue<T>(evaluationId: EvaluationId, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#active?.evaluationId === evaluationId || this.#pending.some((job) => job.evaluationId === evaluationId)) {
      return Promise.reject(new DuplicateEvaluationJobError(evaluationId));
    }
    if (this.#active !== null && this.#pending.length >= this.#maxPending) {
      return Promise.reject(new EvaluationQueueFullError());
    }
    return new Promise<T>((resolve, reject) => {
      const job: QueuedJob<T> = { evaluationId, execute, resolve, reject, controller: new AbortController() };
      this.#pending.push(job as QueuedJob<unknown>);
      this.#pump();
    });
  }

  cancel(evaluationId: EvaluationId): boolean {
    if (this.#active?.evaluationId === evaluationId) {
      this.#active.controller.abort("evaluation cancelled");
      return true;
    }
    const index = this.#pending.findIndex((job) => job.evaluationId === evaluationId);
    if (index < 0) return false;
    const [job] = this.#pending.splice(index, 1);
    job?.controller.abort("evaluation cancelled before start");
    job?.reject(new DOMException("The operation was aborted", "AbortError"));
    this.#settleIdle();
    return true;
  }

  state(): EvaluationQueueState {
    return {
      activeEvaluationId: this.#active?.evaluationId ?? null,
      pendingEvaluationIds: this.#pending.map((job) => job.evaluationId),
      maxPending: this.#maxPending,
    };
  }

  async idle(): Promise<void> {
    if (this.#active === null && this.#pending.length === 0) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  #pump(): void {
    if (this.#active !== null) return;
    const job = this.#pending.shift();
    if (job === undefined) {
      this.#settleIdle();
      return;
    }
    this.#active = job;
    void job.execute(job.controller.signal).then(job.resolve, job.reject).finally(() => {
      this.#active = null;
      this.#pump();
    });
  }

  #settleIdle(): void {
    if (this.#active !== null || this.#pending.length > 0) return;
    const waiters = this.#idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
