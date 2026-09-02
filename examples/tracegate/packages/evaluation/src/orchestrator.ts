import {
  createControlError,
  type Clock,
  type Evaluation,
  type EvaluationAggregateV2,
  type EvaluationId,
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
type ExecutionControl = {
  cancellationAdmitted: boolean;
  admissionPending: boolean;
  admissionSettled: Promise<void> | null;
  settleAdmission: (() => void) | null;
};
type CancellationBoundary = {
  readonly requiredCancelled: Set<number>;
  readonly neverDispatched: Set<number>;
};

function isTerminalEvaluation(evaluation: Evaluation): boolean {
  return evaluation.status === "completed" || evaluation.status === "cancelled" || evaluation.status === "failed";
}

function cancellationIntegrityFailure(
  result: RunExecutionResult,
  expectedRun: Run,
  neverDispatched: boolean,
): SystemicFailure | null {
  const terminalRun = result.run;
  if (!result.terminalized || terminalRun === null) {
    return { phase: "evaluation_cleanup", message: "A cancelled run could not confirm lease-safe terminal cleanup." };
  }
  if (terminalRun.id !== expectedRun.id || terminalRun.evaluationId !== expectedRun.evaluationId) {
    return { phase: "evaluation_execution", message: "A run executor returned a terminal record for the wrong run." };
  }
  if (
    terminalRun.status !== "cancelled"
    || terminalRun.outcome !== null
    || terminalRun.grade !== null
    || terminalRun.failure !== null
    || result.failure !== null
  ) {
    return { phase: "evaluation_execution", message: "A cancellation-required run did not reach a truthful cancelled state." };
  }
  if (terminalRun.potentialSessionLeak) {
    return { phase: "evaluation_cleanup", message: "A cancelled run retained a potential provider-session leak." };
  }
  if (result.release === null) {
    if (terminalRun.releaseStatus !== "not_started") {
      return { phase: "evaluation_cleanup", message: "A cancelled run reported an inconsistent no-session release state." };
    }
  } else if (result.release.confirmation !== "confirmed_released" || terminalRun.releaseStatus !== "released") {
    return { phase: "evaluation_cleanup", message: "A cancelled run could not confirm provider-session release." };
  }
  if (neverDispatched && (
    terminalRun.startedAt !== null
    || terminalRun.resolvedProvider !== null
    || terminalRun.iterations !== 0
    || terminalRun.toolCalls !== 0
    || terminalRun.browserActions !== 0
    || terminalRun.usage.promptTokens !== null
    || terminalRun.usage.completionTokens !== null
    || terminalRun.usage.totalTokens !== null
    || result.release !== null
    || terminalRun.releaseStatus !== "not_started"
  )) {
    return { phase: "evaluation_execution", message: "A never-dispatched run performed work while cancellation was being reconciled." };
  }
  return null;
}

export class FunctionalEvaluationExecutor {
  readonly #evaluations: EvaluationRepository;
  readonly #runExecutor: RunExecutorPort;
  readonly #capacity: ProviderCapacityPort;
  readonly #clock: Clock;
  readonly #activeExecutions = new Map<EvaluationId, ExecutionControl>();

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

  async requestCancellation(evaluationId: EvaluationId, signal: AbortSignal): Promise<boolean> {
    const control = this.#activeExecutions.get(evaluationId);
    if (control?.cancellationAdmitted) return true;
    if (control?.admissionPending && control.admissionSettled !== null) {
      await control.admissionSettled;
      if (control.cancellationAdmitted) return true;
    }

    if (control !== undefined) {
      control.admissionPending = true;
      control.admissionSettled = new Promise<void>((resolve) => {
        control.settleAdmission = resolve;
      });
    }
    const markAdmitted = (): void => {
      if (control !== undefined) control.cancellationAdmitted = true;
    };

    try {
      let admissionError: unknown = null;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (await this.#evaluations.compareAndSetStatus(evaluationId, "running", "cancelling", {}, signal)) {
            markAdmitted();
            return true;
          }
          const current = await this.#evaluations.get(evaluationId, signal);
          if (current === null || current.status === "queued" || current.status === "completed" || current.status === "failed") {
            return false;
          }
          if (current.status === "cancelling" || current.status === "cancelled") {
            markAdmitted();
            return true;
          }
        }
        admissionError = new Error("evaluation cancellation admission remained running after compare-and-set loss");
      } catch (error) {
        admissionError = error;
      }

      try {
        const current = await this.#evaluations.get(evaluationId, AbortSignal.timeout(5_000));
        if (current?.status === "cancelling" || current?.status === "cancelled") {
          markAdmitted();
          return true;
        }
        if (current === null || current.status === "queued" || current.status === "completed" || current.status === "failed") {
          return false;
        }
      } catch {
        // Preserve the original admission error when the independent reconciliation read is also unavailable.
      }
      throw admissionError;
    } finally {
      if (control !== undefined) {
        control.admissionPending = false;
        control.settleAdmission?.();
        control.admissionSettled = null;
        control.settleAdmission = null;
      }
    }
  }

  async execute(evaluation: Evaluation, runs: readonly Run[], signal: AbortSignal): Promise<EvaluationExecutionResult> {
    if (this.#activeExecutions.has(evaluation.id)) throw new Error("functional evaluation executor already owns this evaluation");
    const control: ExecutionControl = {
      cancellationAdmitted: false,
      admissionPending: false,
      admissionSettled: null,
      settleAdmission: null,
    };
    this.#activeExecutions.set(evaluation.id, control);
    try {
      return await this.#executeOwned(evaluation, runs, signal, control);
    } finally {
      if (this.#activeExecutions.get(evaluation.id) === control) this.#activeExecutions.delete(evaluation.id);
    }
  }

  async #executeOwned(
    evaluation: Evaluation,
    runs: readonly Run[],
    signal: AbortSignal,
    control: ExecutionControl,
  ): Promise<EvaluationExecutionResult> {
    if (evaluation.status !== "queued") throw new Error("functional evaluation executor requires a queued evaluation");
    if (runs.length === 0 || runs.some((run) => run.evaluationId !== evaluation.id) || new Set(runs.map((run) => run.id)).size !== runs.length) {
      throw new Error("evaluation runs must be non-empty, unique, and belong to the evaluation");
    }
    const startedAt = this.#clock.nowIso();
    if (!await this.#evaluations.compareAndSetStatus(evaluation.id, "queued", "running", { startedAt }, signal)) {
      throw new Error("evaluation start lost compare-and-set");
    }

    const results: Array<RunExecutionResult | undefined> = new Array(runs.length);
    const runFailures = new Map<number, SystemicFailure>();
    const active = new Map<number, Promise<SettledRun>>();
    let next = 0;
    let systemicFailure: SystemicFailure | null = null;
    let cancellationAdmissionFailure: SystemicFailure | null = null;
    const cancellationState: { boundary: CancellationBoundary | null } = { boundary: null };

    const cancellationRequested = (): boolean => control.cancellationAdmitted || signal.aborted;
    const captureCancellationBoundary = (): void => {
      if (cancellationState.boundary !== null) return;
      const neverDispatched = new Set<number>();
      for (let index = next; index < runs.length; index += 1) neverDispatched.add(index);
      cancellationState.boundary = {
        requiredCancelled: new Set([...active.keys(), ...neverDispatched]),
        neverDispatched,
      };
    };
    const waitForAdmissionBarrier = async (): Promise<void> => {
      while (control.admissionPending && control.admissionSettled !== null) {
        await control.admissionSettled;
      }
    };
    const observeCancellation = async (): Promise<void> => {
      await waitForAdmissionBarrier();
      if (signal.aborted && !control.cancellationAdmitted && cancellationAdmissionFailure === null) {
        try {
          if (!await this.requestCancellation(evaluation.id, AbortSignal.timeout(5_000))) {
            cancellationAdmissionFailure = {
              phase: "evaluation_execution",
              message: "Evaluation cancellation could not be durably admitted.",
            };
          }
        } catch {
          cancellationAdmissionFailure = {
            phase: "evaluation_execution",
            message: "Evaluation cancellation admission could not be reconciled durably.",
          };
        }
      }
      await waitForAdmissionBarrier();
      if (cancellationRequested()) captureCancellationBoundary();
    };
    const noteSystemicFailure = (failure: SystemicFailure): void => {
      systemicFailure ??= failure;
    };
    const noteRunFailure = (index: number, failure: SystemicFailure): void => {
      if (!runFailures.has(index)) runFailures.set(index, failure);
    };
    const acceptSettled = (settled: SettledRun): void => {
      active.delete(settled.index);
      if (settled.error !== undefined) {
        noteRunFailure(settled.index, {
          phase: "evaluation_execution",
          message: "A run could not persist a trustworthy terminal state.",
        });
        return;
      }
      const result = settled.result;
      if (result === undefined) {
        noteRunFailure(settled.index, {
          phase: "evaluation_execution",
          message: "A run executor returned without a result.",
        });
        return;
      }
      if (!result.terminalized || result.run === null) {
        noteRunFailure(settled.index, {
          phase: "evaluation_cleanup",
          message: "A dispatched run could not confirm lease-safe terminal cleanup.",
        });
        return;
      }
      if (result.run.id !== runs[settled.index]?.id || result.run.evaluationId !== evaluation.id) {
        noteRunFailure(settled.index, {
          phase: "evaluation_execution",
          message: "A run executor returned a terminal record for the wrong run.",
        });
        return;
      }
      const completed = result.run.status === "completed" && result.run.outcome !== null;
      const cancelled = result.run.status === "cancelled" && result.run.outcome === null;
      if (!completed && !cancelled) {
        noteRunFailure(settled.index, {
          phase: "evaluation_execution",
          message: "A run executor returned without a durable terminal record.",
        });
        return;
      }
      results[settled.index] = result;
    };
    const drainActive = async (): Promise<void> => {
      while (active.size > 0) {
        await observeCancellation();
        const settled = await Promise.race(active.values());
        await observeCancellation();
        acceptSettled(settled);
      }
    };

    try {
      while ((next < runs.length && !cancellationRequested() && systemicFailure === null) || active.size > 0) {
        await observeCancellation();
        if (!cancellationRequested() && systemicFailure === null) {
          let effectiveCapacity: number;
          try {
            const state = await this.#capacity.current(signal);
            await observeCancellation();
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
          if (cancellationRequested()) {
            captureCancellationBoundary();
            effectiveCapacity = 0;
          } else if (effectiveCapacity <= 0 && active.size === 0 && next < runs.length) {
            noteSystemicFailure({
              phase: "evaluation_capacity",
              message: "No trustworthy run capacity was available for the configured sample.",
            });
          }
          await observeCancellation();
          while (!cancellationRequested() && systemicFailure === null && next < runs.length && active.size < effectiveCapacity) {
            const index = next;
            const run = runs[index]!;
            next += 1;
            const task = this.#runExecutor.execute(run, evaluation.config, signal)
              .then((result): SettledRun => ({ index, result }), (error: unknown): SettledRun => ({ index, error }));
            active.set(index, task);
          }
          if (cancellationRequested()) captureCancellationBoundary();
        }
        if (active.size === 0) break;
        const settled = await Promise.race(active.values());
        await observeCancellation();
        acceptSettled(settled);
      }
    } catch {
      noteSystemicFailure({
        phase: "evaluation_execution",
        message: "Evaluation orchestration stopped before all runs could be dispatched safely.",
      });
    }

    await observeCancellation();
    await drainActive();
    await observeCancellation();

    const reconcileCancellation = (
      boundary: CancellationBoundary,
      forcedFailure: SystemicFailure | null,
      admissionProven: boolean,
    ): Promise<EvaluationExecutionResult> => this.#reconcileCancellation(
      evaluation,
      runs,
      results,
      runFailures,
      boundary,
      forcedFailure,
      admissionProven,
    );
    const reconcileFailureRace = (failure: SystemicFailure): Promise<EvaluationExecutionResult> => {
      control.cancellationAdmitted = true;
      captureCancellationBoundary();
      return reconcileCancellation(cancellationState.boundary!, failure, true);
    };

    const cancellationBoundary = cancellationState.boundary;
    if (cancellationBoundary !== null) {
      const admissionFailure = !control.cancellationAdmitted && cancellationAdmissionFailure === null
        ? { phase: "evaluation_execution", message: "Evaluation cancellation was observed without durable admission." } as const
        : cancellationAdmissionFailure;
      return reconcileCancellation(
        cancellationBoundary,
        admissionFailure ?? systemicFailure,
        control.cancellationAdmitted,
      );
    }

    const completeResults = results.filter((item): item is RunExecutionResult => item !== undefined);
    if (systemicFailure !== null) {
      const durableSystemicFailure = systemicFailure;
      return this.#failEvaluation(
        evaluation,
        completeResults,
        durableSystemicFailure,
        "running",
        false,
        () => reconcileFailureRace(durableSystemicFailure),
      );
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
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await this.#evaluations.compareAndSetStatus(evaluation.id, "running", "completed", {
          finishedAt: this.#clock.nowIso(),
          failure: null,
        }, AbortSignal.timeout(5_000))) {
          return {
            evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)),
            runs: terminalResults,
            aggregate,
            completed: true,
          };
        }
        const current = await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000));
        if (current === null) throw new Error("evaluation disappeared during completion");
        if (current.status === "cancelling") {
          control.cancellationAdmitted = true;
          return this.#finishCancellation(evaluation, terminalResults);
        }
        if (isTerminalEvaluation(current)) return this.#preserveTerminal(current, terminalResults, aggregate);
        if (current.status !== "running") throw new Error("evaluation completion observed an invalid durable status");
      }
      const completionFailure: SystemicFailure = {
        phase: "evaluation_execution",
        message: "Evaluation completion could not be durably committed.",
      };
      return this.#failEvaluation(
        evaluation,
        terminalResults,
        completionFailure,
        "running",
        false,
        () => reconcileFailureRace(completionFailure),
      );
    }

    const lowestFailedIndex = runs.findIndex((_run, index) => runFailures.has(index) || results[index] === undefined);
    const selectedFailure = lowestFailedIndex >= 0 ? runFailures.get(lowestFailedIndex) : undefined;
    const terminalFailure: SystemicFailure = selectedFailure ?? {
      phase: "evaluation_execution",
      message: "At least one configured run did not reach a durable terminal state.",
    };
    return this.#failEvaluation(
      evaluation,
      completeResults,
      terminalFailure,
      "running",
      false,
      () => reconcileFailureRace(terminalFailure),
    );
  }

  async #reconcileCancellation(
    evaluation: Evaluation,
    runs: readonly Run[],
    results: Array<RunExecutionResult | undefined>,
    runFailures: Map<number, SystemicFailure>,
    boundary: CancellationBoundary,
    forcedFailure: SystemicFailure | null,
    admissionProven: boolean,
  ): Promise<EvaluationExecutionResult> {
    const cancelledSignal = AbortSignal.abort(new Error("evaluation cancellation reconciliation"));
    for (const index of boundary.neverDispatched) {
      try {
        const result = await this.#runExecutor.execute(runs[index]!, evaluation.config, cancelledSignal);
        const failure = cancellationIntegrityFailure(result, runs[index]!, true);
        if (failure === null) {
          results[index] = result;
        } else if (!runFailures.has(index)) {
          runFailures.set(index, failure);
        }
      } catch {
        if (!runFailures.has(index)) {
          runFailures.set(index, {
            phase: "evaluation_execution",
            message: "A queued run could not persist a trustworthy cancelled state.",
          });
        }
      }
    }

    let cancellationFailure = forcedFailure;
    if (!admissionProven) {
      cancellationFailure ??= {
        phase: "evaluation_execution",
        message: "Evaluation cancellation was not durably admitted.",
      };
    }
    for (let index = 0; index < runs.length; index += 1) {
      const recordedFailure = runFailures.get(index);
      if (recordedFailure !== undefined) {
        cancellationFailure ??= recordedFailure;
        continue;
      }
      if (!boundary.requiredCancelled.has(index)) continue;
      const result = results[index];
      if (result === undefined) {
        cancellationFailure ??= {
          phase: "evaluation_execution",
          message: "A cancellation-required run did not return a durable terminal record.",
        };
        continue;
      }
      cancellationFailure ??= cancellationIntegrityFailure(
        result,
        runs[index]!,
        boundary.neverDispatched.has(index),
      );
    }

    const completeResults = results.filter((item): item is RunExecutionResult => item !== undefined);
    if (cancellationFailure !== null) {
      const current = await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000));
      if (current === null) throw new Error("evaluation disappeared during cancellation failure reconciliation");
      if (isTerminalEvaluation(current)) return this.#preserveTerminal(current, completeResults);
      if (current.status !== "running" && current.status !== "cancelling") {
        throw new Error("evaluation cancellation failure observed an invalid durable status");
      }
      return this.#failEvaluation(evaluation, completeResults, cancellationFailure, current.status, true);
    }
    return this.#finishCancellation(evaluation, completeResults);
  }

  async #finishCancellation(
    evaluation: Evaluation,
    results: readonly RunExecutionResult[],
  ): Promise<EvaluationExecutionResult> {
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await this.#evaluations.compareAndSetStatus(evaluation.id, "cancelling", "cancelled", {
          finishedAt: this.#clock.nowIso(),
          failure: null,
        }, AbortSignal.timeout(5_000))) {
          return {
            evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)),
            runs: results,
            aggregate: null,
            completed: false,
          };
        }
        const current = await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000));
        if (current === null) throw new Error("evaluation disappeared during cancellation finalization");
        if (isTerminalEvaluation(current)) return this.#preserveTerminal(current, results);
        if (current.status !== "cancelling") throw new Error("evaluation cancellation observed an invalid durable status");
      }
    } catch {
      // A durable cancelled/failed/completed state is reconciled by the failure helper before any new write.
    }
    return this.#failEvaluation(evaluation, results, {
      phase: "evaluation_cleanup",
      message: "Evaluation cancellation could not confirm durable terminalization.",
    }, "cancelling");
  }

  async #failEvaluation(
    evaluation: Evaluation,
    results: readonly (RunExecutionResult | undefined)[],
    failure: SystemicFailure,
    initialExpected: "running" | "cancelling",
    cleanupAlreadyReconciled = false,
    onCancelling?: () => Promise<EvaluationExecutionResult>,
  ): Promise<EvaluationExecutionResult> {
    let expected = initialExpected;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (await this.#evaluations.compareAndSetStatus(evaluation.id, expected, "failed", {
          finishedAt: this.#clock.nowIso(),
          failure: createControlError("internal_error", failure.message, {
            category: "infrastructure",
            phase: failure.phase,
            retryable: true,
          }),
        }, AbortSignal.timeout(5_000))) {
          return {
            evaluation: await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000)),
            runs: results.filter((item): item is RunExecutionResult => item !== undefined),
            aggregate: null,
            completed: false,
          };
        }
      } catch {
        // Reconcile the durable state below; never overwrite an independently committed terminal result.
      }

      const current = await this.#evaluations.get(evaluation.id, AbortSignal.timeout(5_000));
      if (current === null) throw new Error("evaluation disappeared during failure terminalization");
      if (isTerminalEvaluation(current)) return this.#preserveTerminal(current, results);
      if (expected === "running" && current.status === "cancelling") {
        if (!cleanupAlreadyReconciled) {
          if (onCancelling === undefined) {
            throw new Error("evaluation cancellation won before run cleanup reconciliation");
          }
          return onCancelling();
        }
        expected = "cancelling";
        continue;
      }
      if (current.status !== expected) throw new Error("evaluation failure observed an invalid durable status");
    }
    throw new Error("evaluation failure terminalization could not be durably committed");
  }

  #preserveTerminal(
    evaluation: Evaluation,
    results: readonly (RunExecutionResult | undefined)[],
    aggregate: EvaluationAggregateV2 | null = null,
  ): EvaluationExecutionResult {
    return {
      evaluation,
      runs: results.filter((item): item is RunExecutionResult => item !== undefined),
      aggregate: evaluation.status === "completed" ? aggregate : null,
      completed: evaluation.status === "completed",
    };
  }
}
