import assert from "node:assert/strict";
import test from "node:test";

import {
  AssertionCaptureResultSchema,
  BrowserSessionSummarySchema,
  type BrowserSessionRepository,
  type BrowserSessionSummary,
  type SafeAgentToolPort,
} from "@tracegate/shared";
import {
  ASSERTION_ONLY_CANARY,
  DeterministicClock,
  FakeAgentRunner,
  FakeAssertionEvidenceCapture,
  FakeBrowserControllerFactory,
  FakeBrowserProvider,
  FakeDiscoveryController,
  FakeProviderCapacityPort,
  FakeSafeAgentToolPort,
  FakeTargetAdmissionPort,
  InMemoryEvaluationRepository,
  InMemoryEvaluationSubmissionRepository,
  InMemoryEventRepository,
  InMemoryRunRepository,
  ScriptedBrowserController,
  SequentialIdGenerator,
  admittedTargetFixture,
  agentRunResultFixture,
  assertionCanaryConfigFixture,
  browserAssertionEvidenceFixture,
  discoveryFixture,
  observationFixture,
} from "@tracegate/shared/testing";
import {
  EvaluationSubmissionService,
  FunctionalEvaluationExecutor,
  FunctionalRunExecutor,
  OneEvaluationQueue,
  type SafeAgentToolFactory,
} from "@tracegate/evaluation";
import { DeterministicObservableGrader } from "@tracegate/grading";

const signal = () => new AbortController().signal;

class BrowserSessions implements BrowserSessionRepository {
  readonly records = new Map<string, BrowserSessionSummary>();
  async upsert(value: BrowserSessionSummary): Promise<BrowserSessionSummary> {
    const parsed = BrowserSessionSummarySchema.parse(value);
    this.records.set(parsed.runId, structuredClone(parsed));
    return structuredClone(parsed);
  }
  async get(runId: Parameters<BrowserSessionRepository["get"]>[0]): Promise<BrowserSessionSummary | null> {
    return structuredClone(this.records.get(runId) ?? null);
  }
  async listPotentiallyLeaked(): Promise<readonly BrowserSessionSummary[]> {
    return [...this.records.values()].filter((value) => !value.releaseConfirmed).map((value) => structuredClone(value));
  }
}

test("fake-port functional chain is assertion-blind until fresh deterministic grading", async () => {
  const clock = new DeterministicClock();
  const ids = new SequentialIdGenerator();
  const config = { ...assertionCanaryConfigFixture, requestedRunsPerModel: 1, requestedConcurrency: 1 };
  const submitted = await new EvaluationSubmissionService(
    new InMemoryEvaluationSubmissionRepository(clock), ids, clock,
  ).submit(config, signal());

  const evaluations = new InMemoryEvaluationRepository();
  const events = new InMemoryEventRepository(clock);
  const runs = new InMemoryRunRepository(events);
  await evaluations.create(submitted.evaluation, signal());
  await runs.create(submitted.runs[0]!, signal());

  const controller = new ScriptedBrowserController([
    { operation: "connect" },
    { operation: "navigate", observation: observationFixture },
    { operation: "close" },
  ]);
  const browserProvider = new FakeBrowserProvider(clock);
  const agent = new FakeAgentRunner(agentRunResultFixture);
  const safeTools = new FakeSafeAgentToolPort({ observationRevision: 1, tools: ["inspect", "finish"], webMcpTools: [] });
  const safeToolFactory: SafeAgentToolFactory = { async create(): Promise<SafeAgentToolPort> { return safeTools; } };
  const evidence = AssertionCaptureResultSchema.parse({
    transient: {
      schemaVersion: 1,
      canonicalFinalUrl: config.target.startUrl,
      documentId: "document-e2e",
      loaderId: "loader-e2e",
      capturedAt: browserAssertionEvidenceFixture.capturedAt,
      assertionObservations: [{
        assertionId: config.assertions[0]!.id,
        status: "observed",
        observedResult: true,
        expectedSummary: "title equals assertion canary",
        actualSummary: "fresh browser title matched",
        reasonCode: null,
      }],
      evidenceHash: browserAssertionEvidenceFixture.evidenceHash,
    },
    evidence: {
      ...browserAssertionEvidenceFixture,
      assertions: [{
        assertionId: config.assertions[0]!.id,
        status: "observed",
        observedResult: true,
        expectedSummary: "title equals assertion canary",
        actualSummary: "fresh browser title matched",
        reasonCode: null,
      }],
    },
  });
  const browserSessions = new BrowserSessions();
  const capacity = new FakeProviderCapacityPort(1);
  const runExecutor = new FunctionalRunExecutor({
    admission: new FakeTargetAdmissionPort({ status: "admitted", target: admittedTargetFixture }),
    browserProvider,
    controllerFactory: new FakeBrowserControllerFactory([controller]),
    browserSessions,
    discovery: new FakeDiscoveryController(discoveryFixture),
    safeToolFactory,
    agent,
    capture: new FakeAssertionEvidenceCapture(evidence),
    grader: new DeterministicObservableGrader(clock),
    runs,
    transitions: runs,
    capacity,
    ids,
    clock,
  });
  const evaluationExecutor = new FunctionalEvaluationExecutor({ evaluations, runExecutor, capacity, clock });
  const queue = new OneEvaluationQueue(1);
  const result = await queue.enqueue(submitted.evaluation.id, (abortSignal) => evaluationExecutor.execute(submitted.evaluation, submitted.runs, abortSignal));

  assert.equal(result.completed, true);
  assert.equal(result.runs[0]?.run?.outcome, "passed");
  assert.equal(result.runs[0]?.run?.releaseStatus, "released");
  assert.equal(browserSessions.records.get(submitted.runs[0]!.id)?.releaseConfirmed, true);
  assert.equal(agent.calls.length, 1);
  assert.equal(JSON.stringify(agent.calls[0]?.input).includes(ASSERTION_ONLY_CANARY), false);
  assert.equal(evidence.evidence.assertions[0]?.expectedSummary.includes("assertion"), true);
  assert.equal(browserProvider.acquisitions.length, 1);
  assert.equal((browserProvider.leases[0] as unknown as { releaseCalls: number }).releaseCalls, 1);
});
