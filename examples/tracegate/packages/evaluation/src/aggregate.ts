import { EvaluationAggregateV2Schema, type EvaluationAggregateV2, type Run } from "@tracegate/shared";

const rate = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : numerator / denominator,
});

export function deriveEvaluationAggregate(runs: readonly Run[]): EvaluationAggregateV2 {
  const passed = runs.filter((run) => run.outcome === "passed").length;
  const failed = runs.filter((run) => run.outcome === "failed").length;
  const inconclusive = runs.filter((run) => run.outcome === "inconclusive").length;
  const cancelled = runs.filter((run) => run.status === "cancelled").length;
  const nonterminal = runs.length - passed - failed - inconclusive - cancelled;
  return EvaluationAggregateV2Schema.parse({
    requested: runs.length,
    started: runs.filter((run) => run.startedAt !== null).length,
    passed,
    failed,
    inconclusive,
    cancelled,
    nonterminal,
    potentialLeaks: runs.filter((run) => run.potentialSessionLeak).length,
    endToEndPassRate: rate(passed, runs.length),
    gradeableObservableStateSuccess: rate(passed, passed + failed),
  });
}
