import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicClock,
  FakeBrowserProvider,
  InMemoryEvaluationRepository,
  InMemoryEventRepository,
  InMemoryRunRepository,
  eventInputFixture,
  evaluationFixture,
  runFixture,
  passingGradeFixture,
} from "../src/testing/index.ts";
import { EventAppendInputSchema, RunSchema } from "../src/index.ts";

const signal = () => new AbortController().signal;

test("fake event repository is cursor ordered and append-idempotent", async () => {
  const clock = new DeterministicClock();
  const repository = new InMemoryEventRepository(clock);
  const first = await repository.append(eventInputFixture, signal());
  const duplicate = await repository.append(eventInputFixture, signal());
  assert.deepEqual(duplicate, first);
  assert.equal((await repository.listAfter(evaluationFixture.id, null, 10, signal())).length, 1);
  assert.equal(await repository.earliestCursor(evaluationFixture.id, signal()), "1");
  assert.equal(await repository.latestCursor(evaluationFixture.id, signal()), "1");
  await assert.rejects(repository.append(EventAppendInputSchema.parse({
    ...eventInputFixture,
    payload: { runIndex: 1 },
  }), signal()), /different event content/);
});

test("fake browser lease release and run finalization are idempotent under concurrency", async () => {
  const clock = new DeterministicClock();
  const provider = new FakeBrowserProvider(clock);
  const lease = await provider.acquire({
    evaluationId: evaluationFixture.id,
    runId: runFixture.id,
    modelId: runFixture.modelId,
    recordingRequested: false,
  }, signal());
  assert.deepEqual(await lease.release("test", signal()), await lease.release("again", signal()));

  const events = new InMemoryEventRepository(clock);
  const runs = new InMemoryRunRepository(events);
  const gradingRun = RunSchema.parse({ ...runFixture, status: "grading", startedAt: runFixture.createdAt });
  await runs.create(gradingRun, signal());
  const terminalEvent = EventAppendInputSchema.parse({
    ...eventInputFixture,
    runSequence: 1,
    type: "run.passed",
    payload: { outcome: "passed" },
  });
  const input = {
    runId: gradingRun.id,
    expectedStatus: "grading" as const,
    outcome: "passed" as const,
    grade: passingGradeFixture,
    failure: null,
    warnings: [],
    finishedAt: gradingRun.createdAt,
    event: terminalEvent,
  };
  const results = await Promise.all([runs.transactionallyFinalize(input, signal()), runs.transactionallyFinalize(input, signal())]);
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal((await events.listAfter(evaluationFixture.id, null, 10, signal())).length, 1);
});

test("fake repositories provide compare-and-set semantics", async () => {
  const evaluations = new InMemoryEvaluationRepository();
  await evaluations.create(evaluationFixture, signal());
  assert.equal(await evaluations.compareAndSetStatus(evaluationFixture.id, "running", "completed", {}, signal()), false);
  assert.equal(await evaluations.compareAndSetStatus(evaluationFixture.id, "queued", "running", { startedAt: evaluationFixture.createdAt }, signal()), true);
  assert.equal((await evaluations.get(evaluationFixture.id, signal()))?.status, "running");

  const events = new InMemoryEventRepository(new DeterministicClock());
  const runs = new InMemoryRunRepository(events);
  await runs.create(runFixture, signal());
  assert.equal(await runs.compareAndSetStatus(runFixture.id, "queued", "acquiring_browser", { startedAt: runFixture.createdAt }, signal()), true);
  assert.equal(await runs.compareAndSetStatus(runFixture.id, "queued", "cancelled", {}, signal()), false);
});

test("canonical fakes honor abort signals", async () => {
  const controller = new AbortController();
  controller.abort();
  const repository = new InMemoryEventRepository(new DeterministicClock());
  await assert.rejects(repository.append(eventInputFixture, controller.signal), { name: "AbortError" });
});
