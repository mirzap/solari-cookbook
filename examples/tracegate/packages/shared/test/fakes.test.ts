import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserSessionIdSchema,
  EvaluationSchema,
  EventAppendInputSchema,
  ProviderCreateAttemptRecordSchema,
  ProviderCreateReconciliationResultSchema,
  RunQueuedEventAppendInputSchema,
  RunSchema,
  RunStatusChangedEventAppendInputSchema,
  SafeAgentToolResultSchema,
  SafeAgentToolSurfaceSchema,
  ToolCallIdSchema,
} from "../src/index.ts";
import {
  DeterministicClock,
  FakeBrowserControllerFactory,
  FakeBrowserProvider,
  FakeProviderCapacityPort,
  FakeProviderSessionReconciliationPort,
  FakeSafeAgentToolPort,
  FakeWebMcpReadOnlyAdapter,
  InMemoryEvaluationRepository,
  InMemoryEvaluationSubmissionRepository,
  InMemoryEventRepository,
  InMemoryProviderCreateAttemptRepository,
  InMemoryRunRepository,
  ScriptedBrowserController,
  FIXTURE_CREATE_ATTEMPT_ID,
  eventInputFixture,
  evaluationConfigFixture,
  evaluationFixture,
  observationFixture,
  passingGradeFixture,
  runFixture,
  webMcpResultFixture,
  webMcpToolDescriptorFixture,
} from "../src/testing/index.ts";

const signal = () => new AbortController().signal;

test("fake event repository is cursor ordered and append-idempotent", async () => {
  const repository = new InMemoryEventRepository(new DeterministicClock());
  const first = await repository.append(eventInputFixture, signal());
  const duplicate = await repository.append(eventInputFixture, signal());
  assert.deepEqual(duplicate, first);
  assert.equal((await repository.listAfter(evaluationFixture.id, null, 10, signal())).length, 1);
  await assert.rejects(repository.append(EventAppendInputSchema.parse({
    ...eventInputFixture,
    payload: { runIndex: 1 },
  }), signal()), /different event content/);
});

test("atomic submission fake creates evaluation, runs and queued events together", async () => {
  const clock = new DeterministicClock();
  const repository = new InMemoryEvaluationSubmissionRepository(clock);
  const evaluation = EvaluationSchema.parse({
    ...evaluationFixture,
    config: { ...evaluationConfigFixture, requestedRunsPerModel: 1 },
  });
  const queuedEvent = RunQueuedEventAppendInputSchema.parse(eventInputFixture);
  const input = { evaluation, runs: [runFixture], queuedEvents: [queuedEvent] };
  const [first, duplicate] = await Promise.all([
    repository.transactionallyCreate(input, signal()),
    repository.transactionallyCreate(input, signal()),
  ]);
  assert.equal([first, duplicate].filter((result) => result.created).length, 1);
  assert.equal(repository.evaluation(evaluation.id)?.status, "queued");
  assert.equal(repository.run(runFixture.id)?.status, "queued");
  assert.equal(repository.events().length, 1);
  await assert.rejects(repository.transactionallyCreate({
    ...input,
    evaluation: EvaluationSchema.parse({ ...evaluation, config: { ...evaluation.config, prompt: "different submitted graph" } }),
  }, signal()), /conflicts with different content/);
});

test("intermediate transition commits matching status event atomically", async () => {
  const clock = new DeterministicClock();
  const events = new InMemoryEventRepository(clock);
  const runs = new InMemoryRunRepository(events);
  await runs.create(runFixture, signal());
  const transitionEvent = RunStatusChangedEventAppendInputSchema.parse({
    ...eventInputFixture,
    runSequence: 1,
    type: "run.status_changed",
    payload: { previous: "queued", next: "acquiring_browser", mode: "normal" },
  });
  const result = await runs.transactionallyApply({
    runId: runFixture.id,
    expectedStatus: "queued",
    nextStatus: "acquiring_browser",
    context: { mode: "normal", leaseDisposition: "none" },
    patch: { startedAt: runFixture.createdAt },
    event: transitionEvent,
  }, signal());
  assert.equal(result.applied, true);
  assert.equal(result.run?.status, "acquiring_browser");
  assert.equal(result.event?.type, "run.status_changed");
});

test("browser lease release is confirmed and idempotent", async () => {
  const clock = new DeterministicClock();
  const provider = new FakeBrowserProvider(clock);
  const lease = await provider.acquire({
    evaluationId: evaluationFixture.id,
    runId: runFixture.id,
    modelId: runFixture.modelId,
    attemptCorrelationId: FIXTURE_CREATE_ATTEMPT_ID,
    recordingRequested: false,
  }, signal());
  const first = await lease.release("test", signal());
  assert.deepEqual(first, await lease.release("again", signal()));
  assert.equal(first.confirmation, "confirmed_released");
});

test("controller factory constructs per lease and safe-tool fake enforces action/result identity", async () => {
  const browser = new ScriptedBrowserController([{ operation: "close" }]);
  const provider = new FakeBrowserProvider(new DeterministicClock());
  const lease = await provider.acquire({
    evaluationId: evaluationFixture.id, runId: runFixture.id, modelId: runFixture.modelId,
    attemptCorrelationId: FIXTURE_CREATE_ATTEMPT_ID, recordingRequested: false,
  }, signal());
  const factory = new FakeBrowserControllerFactory([browser]);
  assert.equal(await factory.create(lease, signal()), browser);

  const surface = SafeAgentToolSurfaceSchema.parse({ observationRevision: 1, tools: ["inspect", "finish"] });
  const toolCallId = ToolCallIdSchema.parse("tool-call-1");
  const result = SafeAgentToolResultSchema.parse({
    schemaVersion: 1, toolCallId, tool: "inspect",
    decision: { decision: "allow", effect: "inspect", observationRevision: 1 },
    observation: observationFixture, finishedBelief: null, summary: "inspected",
  });
  const safeTools = new FakeSafeAgentToolPort(surface, [result]);
  assert.deepEqual((await safeTools.surface(1, signal())).tools, ["inspect", "finish"]);
  assert.equal((await safeTools.execute({ kind: "inspect", toolCallId, observationRevision: 1 }, signal())).tool, "inspect");
});

test("WebMCP fake preserves current-origin discovery and tool-result identity", async () => {
  const browser = new ScriptedBrowserController([]);
  const adapter = new FakeWebMcpReadOnlyAdapter([webMcpToolDescriptorFixture], [webMcpResultFixture]);
  const descriptors = await adapter.discover(browser, webMcpToolDescriptorFixture.currentOrigin, signal());
  assert.deepEqual(descriptors, [webMcpToolDescriptorFixture]);
  const result = await adapter.invoke(browser, {
    toolId: webMcpToolDescriptorFixture.id,
    currentOrigin: webMcpToolDescriptorFixture.currentOrigin,
    input: { query: "senior engineer", minimumSalary: 150_000 },
  }, signal());
  assert.equal(result.toolId, webMcpToolDescriptorFixture.id);
  assert.equal(adapter.discoveryCalls.length, 1);
  assert.equal(adapter.invocationCalls.length, 1);
});

test("capacity and ambiguous-create reconciliation fakes preserve typed safety semantics", async () => {
  const attemptRepository = new InMemoryProviderCreateAttemptRepository();
  const startedAttempt = ProviderCreateAttemptRecordSchema.parse({
    schemaVersion: 1, runId: runFixture.id, attemptCorrelationId: FIXTURE_CREATE_ATTEMPT_ID,
    status: "started", providerSessionId: null, potentialSessionLeak: false,
    createdAt: evaluationFixture.createdAt, updatedAt: evaluationFixture.createdAt,
  });
  await attemptRepository.recordStarted(startedAttempt, signal());
  const unresolvedAttempt = ProviderCreateAttemptRecordSchema.parse({ ...startedAttempt, status: "unresolved", potentialSessionLeak: true });
  assert.equal(await attemptRepository.transition(runFixture.id, FIXTURE_CREATE_ATTEMPT_ID, "started", unresolvedAttempt, signal()), true);
  assert.equal((await attemptRepository.listUnresolved(signal())).length, 1);

  const capacity = new FakeProviderCapacityPort(5, 5);
  assert.equal((await capacity.reduceAfterLimit(1_000, signal())).effectiveCapacity, 4);
  assert.deepEqual(capacity.reductions, [1_000]);

  const providerSessionId = BrowserSessionIdSchema.parse("browser-session-reconciled");
  const result = ProviderCreateReconciliationResultSchema.parse({
    status: "session_found", attemptCorrelationId: FIXTURE_CREATE_ATTEMPT_ID, providerSessionId,
  });
  const reconciliation = new FakeProviderSessionReconciliationPort(result, {
    status: "released", confirmation: "confirmed_released", releasedAt: evaluationFixture.createdAt, warning: null,
  });
  assert.equal((await reconciliation.reconcileCreate(FIXTURE_CREATE_ATTEMPT_ID, signal())).status, "session_found");
  assert.equal((await reconciliation.releaseReconciled(providerSessionId, "cleanup", signal())).confirmation, "confirmed_released");
});

test("run finalization remains compare-and-set and event-coupled", async () => {
  const clock = new DeterministicClock();
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
    context: { mode: "normal" as const, leaseDisposition: "released" as const },
    outcome: "passed" as const,
    grade: passingGradeFixture,
    failure: null,
    warnings: [],
    finishedAt: gradingRun.createdAt,
    event: terminalEvent,
  };
  await assert.rejects(runs.transactionallyFinalize({ ...input, context: { mode: "normal", leaseDisposition: "may_exist" } }, signal()));
  const results = await Promise.all([runs.transactionallyFinalize(input, signal()), runs.transactionallyFinalize(input, signal())]);
  assert.equal(results.filter((result) => result.applied).length, 1);
  assert.equal((await events.listAfter(evaluationFixture.id, null, 10, signal())).length, 1);
});

test("canonical fakes honor abort signals and controller close retries safely", async () => {
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(new InMemoryEventRepository(new DeterministicClock()).append(eventInputFixture, aborted.signal), { name: "AbortError" });

  const browser = new ScriptedBrowserController([
    { operation: "close", error: new Error("temporary close failure") },
    { operation: "close" },
  ]);
  await assert.rejects(browser.close(signal()), /temporary close failure/);
  await browser.close(signal());
  await browser.close(signal());
  assert.equal(browser.calls.filter((call) => call.operation === "close").length, 2);
});

test("standalone repositories retain compare-and-set semantics", async () => {
  const evaluations = new InMemoryEvaluationRepository();
  await evaluations.create(evaluationFixture, signal());
  assert.equal(await evaluations.compareAndSetStatus(evaluationFixture.id, "queued", "running", { startedAt: evaluationFixture.createdAt }, signal()), true);
  assert.equal((await evaluations.get(evaluationFixture.id, signal()))?.status, "running");
});
