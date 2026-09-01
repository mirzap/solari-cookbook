import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicClock,
  FakeBrowserProvider,
  FakeDemoAdminPort,
  ScriptedBrowserController,
  InMemoryEvaluationRepository,
  InMemoryEventRepository,
  InMemoryRunRepository,
  eventInputFixture,
  evaluationFixture,
  runFixture,
  passingGradeFixture,
  demoChallengeFixture,
  demoGradeEvidenceEnvelopeFixture,
} from "../src/testing/index.ts";
import { ChallengeIdSchema, EvaluationIdSchema, EventAppendInputSchema, RunIdSchema, RunSchema } from "../src/index.ts";

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

test("canonical demo admin fake records only typed safe requests", async () => {
  const fake = new FakeDemoAdminPort(demoChallengeFixture, demoGradeEvidenceEnvelopeFixture);
  const created = await fake.createChallenge({
    schemaVersion: 1,
    evaluationId: evaluationFixture.id,
    runId: runFixture.id,
    challengeId: demoChallengeFixture.challengeId,
    scenarioId: "classic-tee-size-m-v1",
  }, signal());
  const evidence = await fake.getGradeEvidence({
    schemaVersion: 1,
    runId: runFixture.id,
    challengeId: demoChallengeFixture.challengeId,
  }, signal());
  assert.equal(created.navigationUrl, demoChallengeFixture.navigationUrl);
  assert.equal(evidence.evidence.revision, demoGradeEvidenceEnvelopeFixture.evidence.revision);
  assert.equal(fake.createCalls.length, 1);
  assert.equal(fake.evidenceCalls.length, 1);

  await assert.rejects(fake.createChallenge({
    schemaVersion: 1,
    evaluationId: EvaluationIdSchema.parse("01890f00-0000-7000-8000-000000000099"),
    runId: runFixture.id,
    challengeId: demoChallengeFixture.challengeId,
    scenarioId: "classic-tee-size-m-v1",
  }, signal()), /does not match the create request identity/);
  await assert.rejects(fake.createChallenge({
    schemaVersion: 1,
    evaluationId: evaluationFixture.id,
    runId: RunIdSchema.parse("01890f00-0000-7000-8000-000000000099"),
    challengeId: demoChallengeFixture.challengeId,
    scenarioId: "classic-tee-size-m-v1",
  }, signal()), /does not match the create request identity/);
  await assert.rejects(fake.createChallenge({
    schemaVersion: 1,
    evaluationId: evaluationFixture.id,
    runId: runFixture.id,
    challengeId: ChallengeIdSchema.parse("different-challenge-id"),
    scenarioId: "classic-tee-size-m-v1",
  }, signal()), /does not match the create request identity/);
  await assert.rejects(fake.getGradeEvidence({
    schemaVersion: 1,
    runId: runFixture.id,
    challengeId: ChallengeIdSchema.parse("different-challenge-id"),
  }, signal()), /does not match the request identity/);
});

test("scripted browser close is idempotent and may run before connect", async () => {
  const browser = new ScriptedBrowserController([{ operation: "close" }]);
  await browser.close(signal());
  await browser.close(signal());
  assert.deepEqual(browser.calls, [{ operation: "close", input: null }]);
  assert.equal(browser.remainingSteps(), 0);
});

test("scripted browser close can retry after a failed teardown", async () => {
  const browser = new ScriptedBrowserController([
    { operation: "close", error: new Error("temporary close failure") },
    { operation: "close" },
  ]);
  await assert.rejects(browser.close(signal()), /temporary close failure/);
  await browser.close(signal());
  await browser.close(signal());
  assert.equal(browser.calls.filter((call) => call.operation === "close").length, 2);
  assert.equal(browser.remainingSteps(), 0);
});
