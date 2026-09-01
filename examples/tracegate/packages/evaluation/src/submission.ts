import {
  EvaluationSchema,
  RunQueuedEventAppendInputSchema,
  PublicEvaluationConfigV2Schema,
  RunSchema,
  type Clock,
  type EvaluationSubmissionRepository,
  type EvaluationSubmissionResult,
  type IdGenerator,
  type PublicEvaluationConfigV2,
  type Run,
} from "@tracegate/shared";

export class EvaluationSubmissionService {
  readonly #repository: EvaluationSubmissionRepository;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(repository: EvaluationSubmissionRepository, ids: IdGenerator, clock: Clock) {
    this.#repository = repository;
    this.#ids = ids;
    this.#clock = clock;
  }

  async submit(rawConfig: PublicEvaluationConfigV2, signal: AbortSignal): Promise<EvaluationSubmissionResult> {
    if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const config = PublicEvaluationConfigV2Schema.parse(rawConfig);
    const evaluationId = this.#ids.evaluationId();
    const createdAt = this.#clock.nowIso();
    const evaluation = EvaluationSchema.parse({
      schemaVersion: 2,
      id: evaluationId,
      config,
      status: "queued",
      createdAt,
      startedAt: null,
      finishedAt: null,
      failure: null,
    });

    const runs: Run[] = [];
    for (const modelId of config.modelIds) {
      for (let repeat = 0; repeat < config.requestedRunsPerModel; repeat += 1) {
        runs.push(RunSchema.parse({
          schemaVersion: 2,
          id: this.#ids.runId(),
          evaluationId,
          runIndex: runs.length,
          modelId,
          resolvedProvider: null,
          status: "queued",
          outcome: null,
          createdAt,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          iterations: 0,
          toolCalls: 0,
          browserActions: 0,
          usage: { promptTokens: null, completionTokens: null, totalTokens: null },
          failure: null,
          grade: null,
          replayStatus: "not_requested",
          releaseStatus: "not_started",
          warnings: [],
          potentialSessionLeak: false,
        }));
      }
    }

    const queuedEvents = runs.map((run) => RunQueuedEventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: this.#ids.eventId(),
      evaluationId,
      runId: run.id,
      runSequence: 0,
      occurredAt: createdAt,
      type: "run.queued",
      payload: { runIndex: run.runIndex },
    }));

    return this.#repository.transactionallyCreate({ evaluation, runs, queuedEvents }, signal);
  }
}
