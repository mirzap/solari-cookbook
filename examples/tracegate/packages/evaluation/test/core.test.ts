import assert from "node:assert/strict";
import test from "node:test";

import { EvaluationIdSchema, EvaluationSchema, RunSchema } from "@tracegate/shared";
import {
  DeterministicClock,
  InMemoryEvaluationSubmissionRepository,
  InMemoryEvaluationRepository,
  FakeProviderCapacityPort,
  SequentialIdGenerator,
  evaluationConfigFixture,
  failedFailureFixture,
  failedGradeFixture,
  inconclusiveFailureFixture,
  inconclusiveGradeFixture,
  passingGradeFixture,
  evaluationFixture,
  runFixture,
} from "@tracegate/shared/testing";
import {
  DuplicateEvaluationJobError,
  EvaluationQueueFullError,
  EvaluationSubmissionService,
  FunctionalEvaluationExecutor,
  OneEvaluationQueue,
  deriveEvaluationAggregate,
  type RunExecutionResult,
  type RunExecutorPort,
} from "../src/index.ts";

const signal = () => new AbortController().signal;

test("submission expands the complete configured graph in one transaction", async () => {
  const clock = new DeterministicClock();
  const repository = new InMemoryEvaluationSubmissionRepository(clock);
  const service = new EvaluationSubmissionService(repository, new SequentialIdGenerator(), clock);
  const result = await service.submit({ ...evaluationConfigFixture, requestedRunsPerModel: 3 }, signal());
  assert.equal(result.created, true);
  assert.equal(result.runs.length, 3);
  assert.deepEqual(result.runs.map((run) => run.runIndex), [0, 1, 2]);
  assert.equal(result.queuedEvents.length, 3);
  assert.equal(result.queuedEvents.every((event) => event.type === "run.queued" && event.runSequence === 0), true);
  assert.equal(result.runs.every((run) => run.evaluationId === result.evaluation.id && run.status === "queued"), true);
});

test("single-active FIFO queue is bounded, ordered, duplicate-safe, and cancellable", async () => {
  const queue = new OneEvaluationQueue(1);
  const ids = [1, 2, 3, 4].map((value) => EvaluationIdSchema.parse(`01890f00-0000-7000-8000-${String(value).padStart(12, "0")}`));
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = queue.enqueue(ids[0]!, async () => { order.push("first:start"); await firstGate; order.push("first:end"); return 1; });
  const second = queue.enqueue(ids[1]!, async () => { order.push("second"); return 2; });
  await assert.rejects(queue.enqueue(ids[2]!, async () => 3), EvaluationQueueFullError);
  await assert.rejects(queue.enqueue(ids[1]!, async () => 4), DuplicateEvaluationJobError);
  assert.deepEqual(queue.state().pendingEvaluationIds, [ids[1]]);
  assert.equal(queue.cancel(ids[1]!), true);
  await assert.rejects(second, { name: "AbortError" });
  const third = queue.enqueue(ids[2]!, async () => { order.push("third"); return 3; });
  releaseFirst();
  assert.equal(await first, 1);
  assert.equal(await third, 3);
  await queue.idle();
  assert.deepEqual(order, ["first:start", "first:end", "third"]);
  assert.equal(queue.state().activeEvaluationId, null);
});

test("aggregate uses raw terminal counts and exact denominators", () => {
  const startedAt = runFixture.createdAt;
  const finishedAt = runFixture.createdAt;
  const run = (runIndex: number, suffix: number, data: Record<string, unknown>) => RunSchema.parse({
    ...runFixture,
    id: `01890f00-0000-7000-8000-${String(suffix).padStart(12, "0")}`,
    runIndex,
    startedAt,
    finishedAt,
    status: "completed",
    ...data,
  });
  const runs = [
    run(0, 101, { outcome: "passed", grade: passingGradeFixture, failure: null }),
    run(1, 102, { outcome: "failed", grade: failedGradeFixture, failure: failedFailureFixture }),
    run(2, 103, { outcome: "inconclusive", grade: inconclusiveGradeFixture, failure: inconclusiveFailureFixture, potentialSessionLeak: true }),
  ];
  const aggregate = deriveEvaluationAggregate(runs);
  assert.deepEqual({ passed: aggregate.passed, failed: aggregate.failed, inconclusive: aggregate.inconclusive }, { passed: 1, failed: 1, inconclusive: 1 });
  assert.deepEqual(aggregate.endToEndPassRate, { numerator: 1, denominator: 3, value: 1 / 3 });
  assert.deepEqual(aggregate.gradeableObservableStateSuccess, { numerator: 1, denominator: 2, value: 0.5 });
  assert.equal(aggregate.potentialLeaks, 1);
});

test("evaluation executor respects requested/provider concurrency and re-reads degraded capacity", async () => {
  const clock = new DeterministicClock();
  const evaluations = new InMemoryEvaluationRepository();
  const capacity = new FakeProviderCapacityPort(5, 2);
  const config = { ...evaluationConfigFixture, requestedRunsPerModel: 4, requestedConcurrency: 4 };
  const evaluation = EvaluationSchema.parse({ ...evaluationFixture, config });
  await evaluations.create(evaluation, signal());
  const queuedRuns = Array.from({ length: 4 }, (_, runIndex) => RunSchema.parse({
    ...runFixture,
    id: `01890f00-0000-7000-8000-${String(200 + runIndex).padStart(12, "0")}`,
    runIndex,
  }));
  let active = 0;
  let maximumActive = 0;
  let completed = 0;
  const executor: RunExecutorPort = {
    async execute(run): Promise<RunExecutionResult> {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed += 1;
      if (completed === 1) await capacity.reduceAfterLimit(null, signal());
      active -= 1;
      return {
        run: RunSchema.parse({
          ...run,
          status: "completed",
          outcome: "passed",
          startedAt: run.createdAt,
          finishedAt: run.createdAt,
          durationMs: 0,
          grade: passingGradeFixture,
          failure: null,
          releaseStatus: "released",
        }),
        terminalized: true,
        release: null,
        failure: null,
        warnings: [],
      };
    },
  };
  const result = await new FunctionalEvaluationExecutor({ evaluations, runExecutor: executor, capacity, clock }).execute(evaluation, queuedRuns, signal());
  assert.equal(result.completed, true);
  assert.equal(result.evaluation?.status, "completed");
  assert.equal(result.aggregate?.passed, 4);
  assert.equal(maximumActive, 2);
  assert.equal((await capacity.current(signal())).effectiveCapacity, 1);
});

test("evaluation remains visibly red when any run cannot durably terminalize", async () => {
  const clock = new DeterministicClock();
  const evaluations = new InMemoryEvaluationRepository();
  const evaluation = EvaluationSchema.parse({ ...evaluationFixture, config: { ...evaluationConfigFixture, requestedRunsPerModel: 1 } });
  await evaluations.create(evaluation, signal());
  const executor: RunExecutorPort = {
    async execute(run): Promise<RunExecutionResult> {
      return { run: RunSchema.parse({ ...run, status: "releasing_browser", startedAt: run.createdAt, releaseStatus: "failed" }), terminalized: false, release: null, failure: null, warnings: [] };
    },
  };
  const result = await new FunctionalEvaluationExecutor({
    evaluations,
    runExecutor: executor,
    capacity: new FakeProviderCapacityPort(1),
    clock,
  }).execute(evaluation, [runFixture], signal());
  assert.equal(result.completed, false);
  assert.equal(result.evaluation?.status, "failed");
  assert.equal(result.evaluation?.failure?.code, "internal_error");
  assert.equal(result.aggregate, null);
});

test("evaluation cancellation waits for active run cleanup and commits CANCELLED", async () => {
  const clock = new DeterministicClock();
  const evaluations = new InMemoryEvaluationRepository();
  const evaluation = EvaluationSchema.parse({ ...evaluationFixture, config: { ...evaluationConfigFixture, requestedRunsPerModel: 1 } });
  await evaluations.create(evaluation, signal());
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const executor: RunExecutorPort = {
    async execute(run, _config, abortSignal): Promise<RunExecutionResult> {
      markStarted();
      await new Promise<void>((resolve) => abortSignal.addEventListener("abort", () => resolve(), { once: true }));
      return {
        run: RunSchema.parse({
          ...run,
          status: "cancelled",
          startedAt: run.createdAt,
          finishedAt: run.createdAt,
          durationMs: 0,
          releaseStatus: "released",
        }),
        terminalized: true,
        release: null,
        failure: null,
        warnings: [],
      };
    },
  };
  const cancellation = new AbortController();
  const pending = new FunctionalEvaluationExecutor({
    evaluations,
    runExecutor: executor,
    capacity: new FakeProviderCapacityPort(1),
    clock,
  }).execute(evaluation, [runFixture], cancellation.signal);
  await started;
  cancellation.abort("user requested");
  const result = await pending;
  assert.equal(result.completed, false);
  assert.equal(result.evaluation?.status, "cancelled");
  assert.equal(result.runs[0]?.run?.status, "cancelled");
});
