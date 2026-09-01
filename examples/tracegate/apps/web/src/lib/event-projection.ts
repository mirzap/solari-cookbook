import {
  EvaluationSnapshotSchema,
  type EvaluationSnapshot,
  type EventEnvelope,
  type RunSnapshot,
} from "@tracegate/shared";

function aggregate(runs: readonly RunSnapshot[]) {
  const requested = runs.length;
  const passed = runs.filter((run) => run.outcome === "passed").length;
  const failed = runs.filter((run) => run.outcome === "failed").length;
  const inconclusive = runs.filter((run) => run.outcome === "inconclusive").length;
  const cancelled = runs.filter((run) => run.status === "cancelled").length;
  const terminal = passed + failed + inconclusive + cancelled;
  const gradeable = passed + failed;
  return {
    requested,
    started: runs.filter((run) => run.startedAt !== null || run.status !== "queued").length,
    passed,
    failed,
    inconclusive,
    cancelled,
    nonterminal: requested - terminal,
    potentialLeaks: runs.filter((run) => run.potentialSessionLeak).length,
    endToEndPassRate: { numerator: passed, denominator: requested, value: requested === 0 ? null : passed / requested },
    gradeableObservableStateSuccess: { numerator: passed, denominator: gradeable, value: gradeable === 0 ? null : passed / gradeable },
  };
}

export class EvaluationProjection {
  readonly #seen = new Set<string>();
  #snapshot: EvaluationSnapshot;

  constructor(snapshot: EvaluationSnapshot) {
    this.#snapshot = EvaluationSnapshotSchema.parse(snapshot);
  }

  get value(): EvaluationSnapshot {
    return this.#snapshot;
  }

  apply(event: EventEnvelope): EvaluationSnapshot {
    if (event.evaluationId !== this.#snapshot.evaluationId || this.#seen.has(event.eventId)) return this.#snapshot;
    if (this.#snapshot.latestCursor !== null && BigInt(event.cursor) <= BigInt(this.#snapshot.latestCursor)) return this.#snapshot;
    this.#seen.add(event.eventId);

    let status = this.#snapshot.status;
    let startedAt = this.#snapshot.startedAt;
    let finishedAt = this.#snapshot.finishedAt;
    if (event.type === "evaluation.started") {
      status = "running";
      startedAt = event.payload.startedAt;
    } else if (event.type === "evaluation.completed" || event.type === "evaluation.cancelled" || event.type === "evaluation.failed") {
      status = event.type.slice("evaluation.".length) as "completed" | "cancelled" | "failed";
      finishedAt = event.recordedAt;
    }

    const runs = this.#snapshot.runs.map((run): RunSnapshot => {
      if (run.id !== event.runId) return run;
      if (event.type === "run.status_changed") return { ...run, status: event.payload.next };
      if (event.type === "run.started") return { ...run, startedAt: event.payload.startedAt };
      if (event.type === "run.passed") return { ...run, status: "completed", outcome: "passed", finishedAt: event.recordedAt };
      if (event.type === "run.failed") return { ...run, status: "completed", outcome: "failed", failure: event.payload.failure, finishedAt: event.recordedAt };
      if (event.type === "run.inconclusive") return { ...run, status: "completed", outcome: "inconclusive", failure: event.payload.failure, finishedAt: event.recordedAt };
      if (event.type === "run.cancelled") return { ...run, status: "cancelled", outcome: null, finishedAt: event.recordedAt };
      if (event.type === "run.warning") return { ...run, warnings: [...run.warnings, event.payload].slice(-50) };
      return run;
    });

    this.#snapshot = EvaluationSnapshotSchema.parse({
      ...this.#snapshot,
      status,
      startedAt,
      finishedAt,
      runs,
      aggregate: aggregate(runs),
      latestCursor: event.cursor,
    });
    return this.#snapshot;
  }
}
