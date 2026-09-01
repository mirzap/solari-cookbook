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

type SettledRun = { readonly index: number; readonly result?: RunExecutionResult; readonly error?: unknown };
type SystemicFailure = {
  readonly phase: "evaluation_capacity" | "evaluation_execution" | "evaluation_cleanup";
  readonly message: string;
};

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
    if (runs.length === 0 || runs.some((run) => run.evaluationId !== evaluation.id) || new Set(runs.map((run) => run.id)).size !== runs.length) {
      throw new Error("evaluation runs must be non-empty, unique, and belong to the evaluation");
    }
    const startedAt = this.#clock.nowIso();
    if (!await this.#evaluations.compareAndSetStatus(evaluation.id, "queued", "running", { startedAt }, signal)) {
      throw new Error("evaluation start lost compare-and-set");
    }

    const results: Array<RunExecutionResult | undefined> = new Array(runs.length);
    const active = new Map<number, Promise<SettledRun>>();
    let next = 0;
    let systemicFailure: SystemicFailure | null = null;

    const noteSystemicFailure = (failure: SystemicFailure): void => {
      systemicFailure ??= failure;
    };
    const acceptSettled = (settled: SettledRun): void => {
      active.delete(settled.index);
      if (settled.error !== undefined) {
        noteSystemicFailure({
          phase: "evaluation_execution",
          message: "A run could not persist a trustworthy terminal state.",
        });
        return;
      }
      const result = settled.result;
      if (result === undefined) {
        noteSystemicFailure({
          phase: "evaluation_execution",
          message: "A run executor returned without a result.",
        });
        return;
      }
      results[settled.index] = result;
      if (!result.terminalized || result.run === null) {
        noteSystemicFailure({
          phase: "evaluation_cleanup",
          message: "A dispatched run could not confirm lease-safe terminal cleanup.",
        });
        return;
      }
      if (result.run.id !== runs[settled.index]?.id || result.run.evaluationId !== evaluation.id) {
        noteSystemicFailure({
          phase: "evaluation_execution",
          message: "A run executor returned a terminal record for the wrong run.",
        });
      }
    };
    const drainActive = async (): Promise<void> => {
      while (active.size > 0) acceptSettled(await Promise.race(active.values()));
    };

    try {
      while ((next < runs.length && !signal.aborted && systemicFailure === null) || active.size > 0) {
        if (!signal.aborted && systemicFailure === null) {
          let effectiveCapacity: number;
          try {
            const state = await this.#capacity.current(signal);
            effectiveCapacity = Math.min(evaluation.config.requestedConcurrency, state.effectiveCapacity, runs.length);
          } catch {
            if (!signal.aborted) {
              noteSystemicFailure({
                phase: "evaluation_capacity",
                message: "Provider capacity could not be read reliably.",
              });
            }
            effectiveCapacity = 0;
          }
          if (signal.aborted) {
            effectiveCapacity = 0;
          } else if (effectiveCapacity <= 0 && active.size === 0 && next < runs.length) {
            noteSystemicFailure({
              phase: "evaluation_capacity",
              message: "No trustworthy run capacity was available for the configured sample.",
            });
          }
          while (!signal.aborted && systemicFailure === null && next < runs.length && active.size < effectiveCapacity) {
            const index = next;
            const run = runs[index]!;
            next += 1;
            const task = this.#runExecutor.execute(run, evaluation.config, signal)
              .then((result): SettledRun => ({ index, result }), (error: unknown): SettledRun => ({ index, error }));
            active.set(index, task);
          }
        }
        if (active.size === 0) break;
        acceptSettled(await Promise.race(active.values()));
      }
    } catch {
      noteSystemicFailure({
        phase: "evaluation_execution",
        message: "Evaluation orchestration stopped before all runs could be dispatched safely.",
      });
    }

    await drainActive();
    const completeResults = results.filter((item): item is RunExecutionResult => item !== undefined);

    if (systemicFailure !== null) {
      return this.#failEvaluation(evaluation, completeResults, systemicFailure);
    }

    const hasCompleteConfiguredSample = results.every((result, index) =>
      result !== undefined
      && result.terminalized
      && result.run !== null
      && result.run.id === runs[index]?.id
      && result.run.evaluationId === evaluation.id
      && result.run.status === "completed"
      && result.run.outcome !== null,
    );
    if (hasCompleteConfiguredSample) {
      const terminalResults = results as RunExecutionResult[];
      const terminalRuns = terminalResults.map((result) => result.run!);
      const aggregate = deriveEvaluationAggregate(terminalRuns);
      if (!await this.#evaluations.compareAndSetStatus(evaluation.id, "running", "completed", {
        finishedAt: this.#clock.nowIso(),
        failure: null,
      }, AbortSignal.timeout(5_000))) {
        throw new Error("evaluation completion lost compare-and-set");
      }
      return {
        evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)),
        runs: terminalResults,
        aggregate,
        completed: true,
      };
    }

    if (signal.aborted) {
      if (!await this.#evaluations.compareAndSetStatus(evaluation.id, "running", "cancelling", {}, AbortSignal.timeout(5_000))) {
        throw new Error("evaluation cancellation start lost compare-and-set");
      }
      if (!await this.#evaluations.compareAndSetStatus(evaluation.id, "cancelling", "cancelled", {
        finishedAt: this.#clock.nowIso(),
      }, AbortSignal.timeout(5_000))) {
        throw new Error("evaluation cancellation completion lost compare-and-set");
      }
      return {
        evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)),
        runs: completeResults,
        aggregate: null,
        completed: false,
      };
    }

    return this.#failEvaluation(evaluation, completeResults, {
      phase: "evaluation_execution",
      message: "At least one configured run did not reach a durable terminal state.",
    });
  }

  async #failEvaluation(
    evaluation: Evaluation,
    results: readonly RunExecutionResult[],
    failure: SystemicFailure,
  ): Promise<EvaluationExecutionResult> {
    const committed = await this.#evaluations.compareAndSetStatus(evaluation.id, "running", "failed", {
      finishedAt: this.#clock.nowIso(),
      failure: createControlError("internal_error", failure.message, {
        category: "infrastructure",
        phase: failure.phase,
        retryable: true,
      }),
    }, AbortSignal.timeout(5_000));
    if (!committed) throw new Error("evaluation failure terminalization lost compare-and-set");
    return {
      evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)),
      runs: results,
      aggregate: null,
      completed: false,
    };
  }
}
