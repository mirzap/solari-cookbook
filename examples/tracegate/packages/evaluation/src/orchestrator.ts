import {
  createControlError,
  type Clock,
  type Evaluation,
  type EvaluationAggregateV2,
  type EvaluationRepository,
  type ProviderCapacityPort,
  type PublicEvaluationConfigV2,
  type Run,
} from "@tracegate/shared";
import { deriveEvaluationAggregate } from "./aggregate.ts";
import type { RunExecutionResult } from "./executor.ts";

export interface RunExecutorPort {
  execute(run: Run, config: PublicEvaluationConfigV2, signal: AbortSignal): Promise<RunExecutionResult>;
}

export interface EvaluationExecutionResult {
  readonly evaluation: Evaluation | null;
  readonly runs: readonly RunExecutionResult[];
  readonly aggregate: EvaluationAggregateV2 | null;
  readonly completed: boolean;
}

export class FunctionalEvaluationExecutor {
  readonly #evaluations: EvaluationRepository;
  readonly #runExecutor: RunExecutorPort;
  readonly #capacity: ProviderCapacityPort;
  readonly #clock: Clock;

  constructor(dependencies: {
    evaluations: EvaluationRepository;
    runExecutor: RunExecutorPort;
    capacity: ProviderCapacityPort;
    clock: Clock;
  }) {
    this.#evaluations = dependencies.evaluations;
    this.#runExecutor = dependencies.runExecutor;
    this.#capacity = dependencies.capacity;
    this.#clock = dependencies.clock;
  }

  async execute(evaluation: Evaluation, runs: readonly Run[], signal: AbortSignal): Promise<EvaluationExecutionResult> {
    if (evaluation.status !== "queued") throw new Error("functional evaluation executor requires a queued evaluation");
    if (runs.length === 0 || runs.some((run) => run.evaluationId !== evaluation.id)) throw new Error("evaluation runs must be non-empty and belong to the evaluation");
    const startedAt = this.#clock.nowIso();
    if (!await this.#evaluations.compareAndSetStatus(evaluation.id, "queued", "running", { startedAt }, signal)) {
      throw new Error("evaluation start lost compare-and-set");
    }

    const results: Array<RunExecutionResult | undefined> = new Array(runs.length);
    const active = new Map<number, Promise<{ index: number; result?: RunExecutionResult; error?: unknown }>>();
    let next = 0;
    let firstError: unknown = null;

    try {
      while ((next < runs.length && !signal.aborted && firstError === null) || active.size > 0) {
        if (!signal.aborted && firstError === null) {
          const state = await this.#capacity.current(signal);
          const limit = Math.min(evaluation.config.requestedConcurrency, state.effectiveCapacity, runs.length);
          while (next < runs.length && active.size < limit) {
            const index = next;
            const run = runs[index]!;
            next += 1;
            const task = this.#runExecutor.execute(run, evaluation.config, signal)
              .then((result) => ({ index, result }), (error: unknown) => ({ index, error }));
            active.set(index, task);
          }
        }
        if (active.size === 0) break;
        const settled = await Promise.race(active.values());
        active.delete(settled.index);
        if (settled.error !== undefined) firstError ??= settled.error;
        else results[settled.index] = settled.result;
      }
    } catch (error) {
      firstError ??= error;
      // A capacity/cancellation race must not abandon already-dispatched run cleanup.
      while (active.size > 0) {
      const settled = await Promise.race(active.values());
      active.delete(settled.index);
      if (settled.error !== undefined) firstError ??= settled.error;
      else results[settled.index] = settled.result;
      }
    }

    if (signal.aborted) {
      const cancellationResults = results.filter((item): item is RunExecutionResult => item !== undefined);
      if (cancellationResults.some((result) => !result.terminalized)) {
        await this.#evaluations.compareAndSetStatus(evaluation.id, "running", "failed", {
          finishedAt: this.#clock.nowIso(),
          failure: createControlError("internal_error", "Cancellation cleanup left at least one run nonterminal.", {
            category: "infrastructure",
            phase: "evaluation_cancellation",
            retryable: true,
          }),
        }, AbortSignal.timeout(5_000));
        return { evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)), runs: cancellationResults, aggregate: null, completed: false };
      }
      await this.#evaluations.compareAndSetStatus(evaluation.id, "running", "cancelling", {}, AbortSignal.timeout(5_000));
      await this.#evaluations.compareAndSetStatus(evaluation.id, "cancelling", "cancelled", { finishedAt: this.#clock.nowIso() }, AbortSignal.timeout(5_000));
      return { evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)), runs: cancellationResults, aggregate: null, completed: false };
    }

    const completeResults = results.filter((item): item is RunExecutionResult => item !== undefined);
    const allTerminal = firstError === null && completeResults.length === runs.length && completeResults.every((result) => result.terminalized && result.run !== null);
    if (!allTerminal) {
      await this.#evaluations.compareAndSetStatus(evaluation.id, "running", "failed", {
        finishedAt: this.#clock.nowIso(),
        failure: createControlError("internal_error", "At least one run did not reach a durable terminal state.", {
          category: "infrastructure",
          phase: "evaluation_execution",
          retryable: true,
          causeChain: firstError instanceof Error ? [firstError.message.slice(0, 500)] : [],
        }),
      }, AbortSignal.timeout(5_000));
      return { evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)), runs: completeResults, aggregate: null, completed: false };
    }

    const terminalRuns = completeResults.map((result) => result.run!);
    const aggregate = deriveEvaluationAggregate(terminalRuns);
    if (!await this.#evaluations.compareAndSetStatus(evaluation.id, "running", "completed", { finishedAt: this.#clock.nowIso(), failure: null }, signal)) {
      throw new Error("evaluation completion lost compare-and-set");
    }
    return {
      evaluation: await this.#evaluations.get(evaluation.id, signal),
      runs: completeResults,
      aggregate,
      completed: true,
    };
  }
}
