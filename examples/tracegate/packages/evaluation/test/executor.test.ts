import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserSessionSummarySchema,
  createBrowserProviderConcurrencyLimitError,
  type BrowserController,
  type AgentRunner,
  type BrowserSessionRepository,
  type BrowserSessionSummary,
  type PublicHttpsOrigin,
  type SafeAgentToolPort,
} from "@tracegate/shared";
import {
  DeterministicClock,
  FakeAgentRunner,
  FakeAssertionEvidenceCapture,
  FakeBrowserControllerFactory,
  FakeBrowserProvider,
  FakeDiscoveryController,
  FakeGrader,
  FakeProviderCapacityPort,
  FakeSafeAgentToolPort,
  FakeTargetAdmissionPort,
  InMemoryEventRepository,
  InMemoryRunRepository,
  ScriptedBrowserController,
  SequentialIdGenerator,
  admittedTargetFixture,
  agentRunResultFixture,
  assertionCaptureResultFixture,
  discoveryFixture,
  evaluationConfigFixture,
  observationFixture,
  passingGradeFixture,
  runFixture,
} from "@tracegate/shared/testing";
import { FunctionalRunExecutor, type RunExecutorDependencies, type SafeAgentToolFactory, type SafeAgentToolFactoryContext } from "../src/index.ts";

const signal = () => new AbortController().signal;

class InMemoryBrowserSessions implements BrowserSessionRepository {
  readonly records: BrowserSessionSummary[] = [];
  async upsert(session: BrowserSessionSummary, abortSignal: AbortSignal): Promise<BrowserSessionSummary> {
    if (abortSignal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const parsed = BrowserSessionSummarySchema.parse(session);
    const index = this.records.findIndex((candidate) => candidate.runId === parsed.runId);
    if (index >= 0) this.records[index] = structuredClone(parsed);
    else this.records.push(structuredClone(parsed));
    return structuredClone(parsed);
  }
  async get(runId: typeof runFixture.id, abortSignal: AbortSignal): Promise<BrowserSessionSummary | null> {
    if (abortSignal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    return structuredClone(this.records.find((candidate) => candidate.runId === runId) ?? null);
  }
  async listPotentiallyLeaked(abortSignal: AbortSignal): Promise<readonly BrowserSessionSummary[]> {
    if (abortSignal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    return this.records.filter((record) => !record.releaseConfirmed).map((record) => structuredClone(record));
  }
}

class FixedSafeToolFactory implements SafeAgentToolFactory {
  readonly contexts: SafeAgentToolFactoryContext[] = [];
  readonly tools: SafeAgentToolPort;
  constructor(tools: SafeAgentToolPort) { this.tools = tools; }
  async create(context: SafeAgentToolFactoryContext, abortSignal: AbortSignal): Promise<SafeAgentToolPort> {
    if (abortSignal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    this.contexts.push(context);
    return this.tools;
  }
}

const createHarness = (options: {
  browser?: FakeBrowserProvider;
  controller?: BrowserController;
  admission?: FakeTargetAdmissionPort;
  agent?: AgentRunner;
} = {}) => {
  const clock = new DeterministicClock();
  const events = new InMemoryEventRepository(clock);
  const runs = new InMemoryRunRepository(events);
  const browser = options.browser ?? new FakeBrowserProvider(clock);
  const controller = options.controller ?? new ScriptedBrowserController([
    { operation: "connect" },
    { operation: "navigate", observation: observationFixture },
    { operation: "close" },
  ]);
  const safeTools = new FakeSafeAgentToolPort({ observationRevision: 1, tools: ["inspect", "finish"], webMcpTools: [] });
  const safeToolFactory = new FixedSafeToolFactory(safeTools);
  const browserSessions = new InMemoryBrowserSessions();
  const capacity = new FakeProviderCapacityPort(5, 5);
  const dependencies: RunExecutorDependencies = {
    admission: options.admission ?? new FakeTargetAdmissionPort({ status: "admitted", target: admittedTargetFixture }),
    browserProvider: browser,
    controllerFactory: new FakeBrowserControllerFactory([controller]),
    browserSessions,
    discovery: new FakeDiscoveryController(discoveryFixture),
    safeToolFactory,
    agent: options.agent ?? new FakeAgentRunner(agentRunResultFixture),
    capture: new FakeAssertionEvidenceCapture(assertionCaptureResultFixture),
    grader: new FakeGrader(passingGradeFixture),
    runs,
    transitions: runs,
    capacity,
    ids: new SequentialIdGenerator(),
    clock,
  };
  return { executor: new FunctionalRunExecutor(dependencies), runs, events, browser, browserSessions, capacity, safeToolFactory };
};

test("successful run uses frozen ports, persists metrics, and releases before terminalization", async () => {
  const harness = createHarness();
  await harness.runs.create(runFixture, signal());
  const result = await harness.executor.execute(runFixture, { ...evaluationConfigFixture, requestedRunsPerModel: 1 }, signal());
  assert.equal(result.terminalized, true);
  assert.equal(result.run?.outcome, "passed");
  assert.equal(result.run?.resolvedProvider, "openrouter");
  assert.equal(result.run?.usage.totalTokens, 150);
  assert.equal(result.run?.releaseStatus, "released");
  assert.equal(result.release?.confirmation, "confirmed_released");
  assert.equal(harness.browserSessions.records[0]?.releaseConfirmed, true);
  assert.equal(harness.safeToolFactory.contexts.length, 1);
  const events = await harness.events.listAfter(runFixture.evaluationId, null, 20, signal());
  assert.equal(events.at(-1)?.type, "run.passed");
});

test("target rejection becomes an evidence-invalid INCONCLUSIVE without acquiring a session", async () => {
  const harness = createHarness({
    admission: new FakeTargetAdmissionPort({ status: "rejected", reason: "private_or_reserved_address", message: "Resolved destination is not public." }),
  });
  await harness.runs.create(runFixture, signal());
  const result = await harness.executor.execute(runFixture, { ...evaluationConfigFixture, requestedRunsPerModel: 1 }, signal());
  assert.equal(result.terminalized, true);
  assert.equal(result.run?.outcome, "inconclusive");
  assert.equal(result.failure?.code, "target_admission_failed");
  assert.equal(harness.browser.acquisitions.length, 0);
  assert.equal(result.run?.grade?.assertions.every((item) => item.status === "unverifiable"), true);
});

test("definitive provider capacity failure degrades later capacity and never retries current create", async () => {
  const clock = new DeterministicClock();
  class LimitedProvider extends FakeBrowserProvider {
    override async acquire(): Promise<never> { throw createBrowserProviderConcurrencyLimitError(12_000); }
  }
  const harness = createHarness({ browser: new LimitedProvider(clock) });
  await harness.runs.create(runFixture, signal());
  const result = await harness.executor.execute(runFixture, { ...evaluationConfigFixture, requestedRunsPerModel: 1 }, signal());
  assert.equal(result.terminalized, true);
  assert.equal(result.failure?.code, "solari_unavailable");
  assert.deepEqual(harness.capacity.reductions, [12_000]);
  assert.equal(harness.browser.acquisitions.length, 0);
});

test("agent failure still closes and releases every acknowledged provider session in finally", async () => {
  class FailingAgent extends FakeAgentRunner {
    override async run(): Promise<never> { throw new Error("malformed provider lifecycle"); }
  }
  const harness = createHarness({ agent: new FailingAgent(agentRunResultFixture) });
  await harness.runs.create(runFixture, signal());
  const result = await harness.executor.execute(runFixture, { ...evaluationConfigFixture, requestedRunsPerModel: 1 }, signal());
  assert.equal(result.terminalized, true);
  assert.equal(result.run?.outcome, "inconclusive");
  assert.equal(result.failure?.code, "provider_protocol_error");
  assert.equal(result.release?.confirmation, "confirmed_released");
  assert.equal((harness.browser.leases[0] as unknown as { releaseCalls: number }).releaseCalls, 1);
});

test("unconfirmed release is a visible red cleanup state and blocks terminal commit", async () => {
  const harness = createHarness({ browser: new FakeBrowserProvider(new DeterministicClock(), { failRelease: true }) });
  await harness.runs.create(runFixture, signal());
  const result = await harness.executor.execute(runFixture, { ...evaluationConfigFixture, requestedRunsPerModel: 1 }, signal());
  assert.equal(result.terminalized, false);
  assert.equal(result.release?.confirmation, "unconfirmed");
  assert.equal(result.failure?.code, "session_release_unconfirmed");
  assert.equal(result.run?.status, "releasing_browser");
  assert.equal((harness.browser.leases[0] as unknown as { releaseCalls: number }).releaseCalls, 1);
});

test("controller close failure cannot bypass provider release", async () => {
  const controller = new ScriptedBrowserController([
    { operation: "connect" },
    { operation: "navigate", observation: observationFixture },
    { operation: "close", error: new Error("controller transport closed early") },
  ]);
  const harness = createHarness({ controller });
  await harness.runs.create(runFixture, signal());
  const result = await harness.executor.execute(runFixture, { ...evaluationConfigFixture, requestedRunsPerModel: 1 }, signal());
  assert.equal(result.terminalized, true);
  assert.equal(result.release?.confirmation, "confirmed_released");
  assert.equal(result.warnings.some((item) => item.code === "cleanup_failed"), true);
});

test("active cancellation waits for finally release then atomically cancels the run", async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const blockingAgent: AgentRunner = {
    async run(_input, _tools, abortSignal) {
      markStarted();
      await new Promise<never>((_resolve, reject) => {
        abortSignal.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")), { once: true });
      });
      throw new Error("unreachable");
    },
  };
  const harness = createHarness({ agent: blockingAgent });
  await harness.runs.create(runFixture, signal());
  const cancellation = new AbortController();
  const pending = harness.executor.execute(runFixture, { ...evaluationConfigFixture, requestedRunsPerModel: 1 }, cancellation.signal);
  await started;
  cancellation.abort("user requested");
  const result = await pending;
  assert.equal(result.terminalized, true);
  assert.equal(result.run?.status, "cancelled");
  assert.equal(result.run?.releaseStatus, "released");
  assert.equal(result.run?.grade, null);
  assert.equal(result.release?.confirmation, "confirmed_released");
  const events = await harness.events.listAfter(runFixture.evaluationId, null, 20, signal());
  assert.equal(events.at(-1)?.type, "run.cancelled");
  assert.equal((harness.browser.leases[0] as unknown as { releaseCalls: number }).releaseCalls, 1);
});

test("WebMCP opt-in remains config-only until B/C provide an admitted current-origin surface", async () => {
  const origin = new URL(evaluationConfigFixture.target.startUrl).origin as PublicHttpsOrigin;
  assert.equal(origin, admittedTargetFixture.allowedNavigationOrigins[0]);
  const harness = createHarness();
  await harness.runs.create(runFixture, signal());
  const result = await harness.executor.execute(runFixture, { ...evaluationConfigFixture, webMcpReadOnlyEnabled: true, requestedRunsPerModel: 1 }, signal());
  assert.equal(result.terminalized, true);
  assert.equal(result.run?.outcome, "passed");
  assert.equal(harness.safeToolFactory.contexts[0]?.webMcpReadOnlyEnabled, true);
});
