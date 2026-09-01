import { AgentPolicy, TraceGateAgentRunner, createConfiguredMcpClient, type AgentMilestone } from "@tracegate/agent";
import { createDeepSeekOpenRouterDriverFactory } from "@tracegate/ai";
import { createTracegateRepositories, type TracegateDatabase, type TracegateRepositories } from "@tracegate/db";
import { PracticalTargetAdmission, TraceGateDiscoveryController, type BrowserDiscoverySource } from "@tracegate/discovery";
import { FunctionalEvaluationExecutor, FunctionalRunExecutor, OneEvaluationQueue, type SafeAgentToolFactory, type SafeAgentToolRuntime } from "@tracegate/evaluation";
import { DeterministicObservableGrader } from "@tracegate/grading";
import {
  AgentRunResultSchema,
  AgentTraceEventSchema,
  BrowserAcquireRequestSchema,
  EventAppendInputSchema,
  DiscoveredInterfaceSchema,
  FailureRecordSchema,
  IntermediateRunTransitionResultSchema,
  InterfaceUsageSummarySchema,
  ProviderCapacityStateSchema,
  ProviderCreateAttemptRecordSchema,
  RunSchema,
  RunStepSchema,
  RuntimeCapabilitySchema,
  SafeAgentToolResultSchema,
  SafeAgentToolSurfaceSchema,
  TraceGateError,
  UtcDateTimeSchema,
  createControlError,
  redactError,
  toolCompletionInterfaceUsageDelta,
  type AgentExecutionInputV2,
  type AgentRunResult,
  type AgentRunner,
  type AssertionCaptureInput,
  type AssertionCaptureResult,
  type AssertionEvidenceCapture,
  type BrowserAcquireRequest,
  type BrowserController,
  type BrowserControllerFactory,
  type BrowserLease,
  type BrowserProvider,
  type Clock,
  type ConfiguredMcpClientPort,
  type ConfiguredMcpEndpointV1,
  type ConfiguredMcpToolDescriptorV1,
  type DiscoveryContext,
  type DiscoveryController,
  type DiscoveryEvidence,
  type EffectDecision,
  type Evaluation,
  type EvaluationId,
  type EvaluationRepository,
  type EvaluationStatus,
  type EvaluationStatusPatch,
  type EventAppendInput,
  type GradeInputV2,
  type GradeResultV2,
  type Grader,
  type InterfaceChannel,
  type InterfaceUsageMetric,
  type IntermediateRunTransitionInput,
  type ObservationRevision,
  type ProviderCapacityPort,
  type ProviderCapacityState,
  type PublicEvaluationConfigV2,
  type PublicHttpsOrigin,
  type ReleaseResult,
  type Run,
  type RunId,
  type RunRepository,
  type RunStatus,
  type RunStep,
  type RunTransitionRepository,
  type SafeActionEffect,
  type SafeAgentAction,
  type SafeAgentToolName,
  type SafeAgentToolPort,
  type SafeAgentToolResult,
  type SafeAgentToolSurface,
  type UtcDateTime,
  type UntrustedAgentObservation,
  type WebMcpToolDescriptorV1,
} from "@tracegate/shared";
import {
  FreshBrowserAssertionEvidenceCapture,
  SolariBrowserControllerFactory,
  SolariBrowserProvider,
  SolariWebMcpReadOnlyAdapter,
  assertAllowedNavigation,
  canonicalAllowedOrigins,
  blockedByPolicy,
  obviousUnsafeControl,
} from "@tracegate/solari";

import { TracegateServer } from "./tracegate-server.ts";
import { UuidV7Generator } from "./ids.ts";

const DEEPSEEK = "deepseek/deepseek-v4-flash-0731" as const;
const NODE_PACKAGE_MANAGER = process.env.npm_config_user_agent?.split(" ")[0] ?? "pnpm/unknown";

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
};

export class SystemClock implements Clock {
  now(): Date { return new Date(); }
  nowIso(): UtcDateTime { return UtcDateTimeSchema.parse(this.now().toISOString()); }
  async sleep(durationMs: number, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
      const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
      const timer = setTimeout(finish, durationMs);
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError")); };
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}

class RuntimeCapacity implements ProviderCapacityPort {
  readonly #configuredMaximum: number;
  #effectiveCapacity: number;
  #retryAfterMs: number | null = null;

  constructor(maximum: number) {
    this.#configuredMaximum = Math.max(1, Math.min(5, maximum));
    this.#effectiveCapacity = this.#configuredMaximum;
  }

  async current(signal: AbortSignal): Promise<ProviderCapacityState> {
    throwIfAborted(signal);
    return ProviderCapacityStateSchema.parse({
      configuredMaximum: this.#configuredMaximum,
      effectiveCapacity: this.#effectiveCapacity,
      retryAfterMs: this.#retryAfterMs,
    });
  }

  async reduceAfterLimit(retryAfterMs: number | null, signal: AbortSignal): Promise<ProviderCapacityState> {
    throwIfAborted(signal);
    this.#effectiveCapacity = Math.max(1, this.#effectiveCapacity - 1);
    this.#retryAfterMs = retryAfterMs;
    return this.current(signal);
  }
}

class RunRuntimeRegistry {
  readonly configs = new Map<RunId, PublicEvaluationConfigV2>();
  readonly evaluationIds = new Map<RunId, EvaluationId>();
  readonly models = new Map<RunId, Run["modelId"]>();
  readonly controllers = new Map<RunId, BrowserController>();
  readonly observations = new Map<RunId, UntrustedAgentObservation>();
  readonly webMcpTools = new Map<RunId, readonly WebMcpToolDescriptorV1[]>();
  readonly leaseRunIds = new WeakMap<object, RunId>();
  readonly controllerRunIds = new WeakMap<object, RunId>();
  readonly toolRunIds = new WeakMap<object, RunId>();
  readonly sequences = new Map<RunId, number>();
  readonly readiness = new Map<RunId, Map<InterfaceChannel, { discovered: number; admitted: number }>>();

  register(evaluation: Evaluation, runs: readonly Run[]): void {
    for (const run of runs) {
      this.configs.set(run.id, evaluation.config);
      this.evaluationIds.set(run.id, evaluation.id);
      this.models.set(run.id, run.modelId);
      if (!this.sequences.has(run.id)) this.sequences.set(run.id, 0);
    }
  }

  setReadiness(runId: RunId, channel: InterfaceChannel, discovered: number, admitted: number): void {
    const metrics = this.readiness.get(runId) ?? new Map();
    metrics.set(channel, { discovered, admitted });
    this.readiness.set(runId, metrics);
  }

  unregister(runs: readonly Run[]): void {
    for (const run of runs) {
      this.configs.delete(run.id);
      this.evaluationIds.delete(run.id);
      this.models.delete(run.id);
      this.controllers.delete(run.id);
      this.observations.delete(run.id);
      this.webMcpTools.delete(run.id);
      this.sequences.delete(run.id);
      this.readiness.delete(run.id);
    }
  }

  next(runId: RunId): number {
    const next = (this.sequences.get(runId) ?? 0) + 1;
    this.sequences.set(runId, next);
    return next;
  }

  requireRunId(value: object, map: WeakMap<object, RunId>, label: string): RunId {
    const runId = map.get(value);
    if (runId === undefined) throw new Error(`${label} is not bound to a scheduled run`);
    return runId;
  }

  requireConfig(runId: RunId): PublicEvaluationConfigV2 {
    const config = this.configs.get(runId);
    if (config === undefined) throw new Error(`Runtime configuration is missing for run ${runId}`);
    return config;
  }

  requireEvaluationId(runId: RunId): EvaluationId {
    const evaluationId = this.evaluationIds.get(runId);
    if (evaluationId === undefined) throw new Error(`Evaluation identity is missing for run ${runId}`);
    return evaluationId;
  }
}

function stepKindForStatus(status: RunStatus): RunStep["kind"] {
  if (status === "discovering") return "discovery";
  if (status === "running_agent") return "model";
  if (status === "grading") return "grading";
  return "browser_action";
}

function countSummary(snapshot: Awaited<ReturnType<TracegateServer["getSnapshot"]>>) {
  if (snapshot === null) throw new Error("Evaluation snapshot disappeared while publishing a terminal milestone");
  const aggregate = snapshot.aggregate;
  return {
    requested: aggregate.requested,
    completed: aggregate.passed + aggregate.failed + aggregate.inconclusive,
    passed: aggregate.passed,
    failed: aggregate.failed,
    inconclusive: aggregate.inconclusive,
    cancelled: aggregate.cancelled,
    nonterminal: aggregate.nonterminal,
    potentialLeaks: aggregate.potentialLeaks,
  };
}

function publishingEvaluationRepository(
  base: EvaluationRepository,
  server: TracegateServer,
  ids: UuidV7Generator,
  clock: Clock,
): EvaluationRepository {
  return {
    create: (evaluation, signal) => base.create(evaluation, signal),
    get: (id, signal) => base.get(id, signal),
    listRecoverable: (signal) => base.listRecoverable(signal),
    compareAndSetStatus: async (
      id: EvaluationId,
      expected: EvaluationStatus,
      next: EvaluationStatus,
      patch: EvaluationStatusPatch,
      signal: AbortSignal,
    ) => {
      const applied = await base.compareAndSetStatus(id, expected, next, patch, signal);
      if (!applied) return false;
      const occurredAt = clock.nowIso();
      let event: EventAppendInput | null = null;
      if (next === "running") {
        event = EventAppendInputSchema.parse({ schemaVersion: 1, eventId: ids.eventId(), evaluationId: id, runId: null, runSequence: null, occurredAt, type: "evaluation.started", payload: { startedAt: patch.startedAt ?? occurredAt } });
      } else if (next === "completed" || next === "cancelled") {
        event = EventAppendInputSchema.parse({ schemaVersion: 1, eventId: ids.eventId(), evaluationId: id, runId: null, runSequence: null, occurredAt, type: next === "completed" ? "evaluation.completed" : "evaluation.cancelled", payload: countSummary(await server.getSnapshot(id, signal)) });
      } else if (next === "failed") {
        const failure = patch.failure ?? createControlError("internal_error", "Evaluation execution failed.", { category: "infrastructure", phase: "evaluation_execution", retryable: true });
        event = EventAppendInputSchema.parse({ schemaVersion: 1, eventId: ids.eventId(), evaluationId: id, runId: null, runSequence: null, occurredAt, type: "evaluation.failed", payload: { error: failure } });
      }
      if (event !== null) await server.appendEvent(event, signal);
      return true;
    },
  };
}

function publishingTransitionRepository(
  baseRuns: RunRepository,
  server: TracegateServer,
  registry: RunRuntimeRegistry,
  clock: Clock,
): RunTransitionRepository {
  return {
    transactionallyApply: async (inputValue: IntermediateRunTransitionInput, signal: AbortSignal) => {
      const current = await baseRuns.get(inputValue.runId, signal);
      if (current === null || current.status !== inputValue.expectedStatus) {
        return IntermediateRunTransitionResultSchema.parse({ applied: false, run: null, event: null });
      }
      const sequence = registry.next(inputValue.runId);
      const event = EventAppendInputSchema.parse({ ...inputValue.event, runSequence: sequence });
      const run = RunSchema.parse({
        ...current,
        status: inputValue.nextStatus,
        startedAt: inputValue.patch.startedAt === undefined ? current.startedAt : inputValue.patch.startedAt,
        failure: inputValue.patch.failure === undefined ? current.failure : inputValue.patch.failure,
        releaseStatus: inputValue.patch.releaseStatus ?? current.releaseStatus,
        potentialSessionLeak: inputValue.patch.potentialSessionLeak ?? current.potentialSessionLeak,
      });
      const step = RunStepSchema.parse({
        schemaVersion: 2,
        runId: run.id,
        sequence,
        kind: stepKindForStatus(run.status),
        payload: { status: run.status },
        interactionMode: "system",
        observationRevision: null,
        durationMs: null,
        occurredAt: clock.nowIso(),
      });
      const persisted = await server.persistMilestone({ expectedStatus: inputValue.expectedStatus, run, transition: inputValue.context, step, event }, signal);
      return IntermediateRunTransitionResultSchema.parse({ applied: true, run: persisted.run, event: persisted.event });
    },
  };
}

function publishingRunRepository(
  base: RunRepository,
  server: TracegateServer,
  registry: RunRuntimeRegistry,
): RunRepository {
  return {
    create: (run, signal) => base.create(run, signal),
    get: (id, signal) => base.get(id, signal),
    compareAndSetStatus: (id, expected, next, patch, signal) => base.compareAndSetStatus(id, expected, next, patch, signal),
    listRecoverable: (signal) => base.listRecoverable(signal),
    transactionallyFinalize: (input, signal) => server.finalizeRun({ ...input, event: { ...input.event, runSequence: registry.next(input.runId) } }, signal),
    transactionallyCancel: (input, signal) => server.cancelRun({ ...input, event: { ...input.event, runSequence: registry.next(input.runId) } }, signal),
  };
}

async function appendRunStep(
  server: TracegateServer,
  registry: RunRuntimeRegistry,
  ids: UuidV7Generator,
  clock: Clock,
  runId: RunId,
  event: AgentMilestone | { readonly type: EventAppendInput["type"]; readonly payload: EventAppendInput["payload"] },
  step: Pick<RunStep, "kind" | "interactionMode" | "observationRevision" | "durationMs">,
  signal: AbortSignal,
): Promise<void> {
  const sequence = registry.next(runId);
  const occurredAt = clock.nowIso();
  const eventInput = EventAppendInputSchema.parse({
    schemaVersion: 1,
    eventId: ids.eventId(),
    evaluationId: registry.requireEvaluationId(runId),
    runId,
    runSequence: sequence,
    occurredAt,
    type: event.type,
    payload: event.payload,
  });
  await server.appendRunEventStep({
    step: RunStepSchema.parse({ schemaVersion: 2, runId, sequence, occurredAt, payload: { milestone: event.type }, ...step }),
    event: eventInput,
  }, signal);
}

class InstrumentedBrowserProvider implements BrowserProvider {
  constructor(
    private readonly inner: BrowserProvider,
    private readonly attempts: TracegateRepositories["providerCreateAttempts"],
    private readonly capabilities: TracegateRepositories["capabilities"],
    private readonly server: TracegateServer,
    private readonly registry: RunRuntimeRegistry,
    private readonly ids: UuidV7Generator,
    private readonly clock: Clock,
  ) {}

  async acquire(requestValue: BrowserAcquireRequest, signal: AbortSignal): Promise<BrowserLease> {
    const request = BrowserAcquireRequestSchema.parse(requestValue);
    const createdAt = this.clock.nowIso();
    const started = ProviderCreateAttemptRecordSchema.parse({
      schemaVersion: 1,
      runId: request.runId,
      attemptCorrelationId: request.attemptCorrelationId,
      status: "started",
      providerSessionId: null,
      potentialSessionLeak: false,
      createdAt,
      updatedAt: createdAt,
    });
    await this.attempts.recordStarted(started, signal);
    let lease: BrowserLease;
    try {
      lease = await this.inner.acquire(request, signal);
    } catch (error) {
      const ambiguous = error instanceof TraceGateError && error.safe.code === "session_create_ambiguous";
      await this.attempts.transition(request.runId, request.attemptCorrelationId, "started", ProviderCreateAttemptRecordSchema.parse({
        ...started,
        status: ambiguous ? "unresolved" : "no_session_created",
        potentialSessionLeak: ambiguous,
        updatedAt: this.clock.nowIso(),
      }), AbortSignal.timeout(5_000));
      throw error;
    }
    let attemptStatus: "started" | "session_found" = "started";
    try {
      await this.attempts.transition(request.runId, request.attemptCorrelationId, "started", ProviderCreateAttemptRecordSchema.parse({
        ...started,
        status: "session_found",
        providerSessionId: lease.providerSessionId,
        updatedAt: this.clock.nowIso(),
      }), signal);
      attemptStatus = "session_found";
      await this.capabilities.upsert(RuntimeCapabilitySchema.parse({
        schemaVersion: 1,
        kind: "solari",
        subject: "browser-session-runtime",
        status: "verified",
        details: { configured: true, provider: "Solari Browser", verification: "live session acquired" },
        checkedAt: this.clock.nowIso(),
        error: null,
      }), signal);

      const wrapped: BrowserLease = {
        providerSessionId: lease.providerSessionId,
        connectEndpoint: lease.connectEndpoint,
        region: lease.region,
        recordingRequested: lease.recordingRequested,
        release: async (reason, releaseSignal) => {
          const result = await lease.release(reason, releaseSignal);
          const nextStatus = result.status === "released" ? "released" : "release_failed";
          await this.attempts.transition(request.runId, request.attemptCorrelationId, "session_found", ProviderCreateAttemptRecordSchema.parse({
            ...started,
            status: nextStatus,
            providerSessionId: lease.providerSessionId,
            potentialSessionLeak: result.status !== "released",
            updatedAt: this.clock.nowIso(),
          }), AbortSignal.timeout(5_000));
          await appendRunStep(this.server, this.registry, this.ids, this.clock, request.runId, {
            type: "run.release.status_changed",
            payload: result.status === "released"
              ? { previous: "releasing", next: "released", confirmed: true }
              : { previous: "releasing", next: "failed", confirmed: false },
          }, { kind: "browser_action", interactionMode: "system", observationRevision: null, durationMs: null }, AbortSignal.timeout(5_000));
          return result;
        },
      };
      this.registry.leaseRunIds.set(wrapped, request.runId);
      await appendRunStep(this.server, this.registry, this.ids, this.clock, request.runId, {
        type: "run.browser.ready",
        payload: { region: lease.region, recordingRequested: request.recordingRequested },
      }, { kind: "browser_action", interactionMode: "system", observationRevision: null, durationMs: null }, signal);
      await appendRunStep(this.server, this.registry, this.ids, this.clock, request.runId, {
        type: "run.environment.recorded",
        payload: {
          nodeVersion: process.version,
          pnpmVersion: NODE_PACKAGE_MANAGER,
          browserProvider: "Solari Browser",
          browserRegion: lease.region,
          modelId: request.modelId,
          resolvedProvider: null,
          safetyPolicyVersion: "public-safe-v1",
        },
      }, { kind: "browser_action", interactionMode: "system", observationRevision: null, durationMs: null }, signal);
      return wrapped;
    } catch (error) {
      let released = false;
      try {
        released = (await lease.release("post-acquisition setup failed", AbortSignal.timeout(15_000))).status === "released";
      } catch {
        released = false;
      }
      await this.attempts.transition(request.runId, request.attemptCorrelationId, attemptStatus, ProviderCreateAttemptRecordSchema.parse({
        ...started,
        status: released ? "released" : "release_failed",
        providerSessionId: lease.providerSessionId,
        potentialSessionLeak: !released,
        updatedAt: this.clock.nowIso(),
      }), AbortSignal.timeout(5_000)).catch(() => false);
      throw error;
    }
  }
}

class RunAwareControllerFactory implements BrowserControllerFactory {
  constructor(private readonly registry: RunRuntimeRegistry) {}

  async create(lease: BrowserLease, signal: AbortSignal): Promise<BrowserController> {
    const runId = this.registry.requireRunId(lease, this.registry.leaseRunIds, "Browser lease");
    const config = this.registry.requireConfig(runId);
    const controller = await new SolariBrowserControllerFactory({
      allowedOrigins: config.target.allowedNavigationOrigins,
      maxObservationBytes: config.budgets.maxObservationBytes,
      actionTimeoutMs: config.budgets.toolTimeoutMs,
    }).create(lease, signal);
    this.registry.controllers.set(runId, controller);
    this.registry.controllerRunIds.set(controller, runId);
    return controller;
  }
}

class PersistingDiscoveryController implements DiscoveryController {
  constructor(
    private readonly database: TracegateDatabase,
    private readonly registry: RunRuntimeRegistry,
    private readonly webMcp: SolariWebMcpReadOnlyAdapter,
    private readonly server: TracegateServer,
    private readonly ids: UuidV7Generator,
    private readonly clock: Clock,
  ) {}

  async discover(context: DiscoveryContext, signal: AbortSignal): Promise<DiscoveryEvidence> {
    const controller = this.registry.controllers.get(context.runId);
    if (controller === undefined) throw new Error("Discovery controller is missing for the active run");
    const config = this.registry.requireConfig(context.runId);
    const discovery = new TraceGateDiscoveryController({
      source: controller as BrowserController & BrowserDiscoverySource,
      webMcp: { enabled: config.webMcpReadOnlyEnabled, adapter: this.webMcp, controller },
    });
    const started = performance.now();
    const evidence = await discovery.discover(context, signal);
    this.registry.observations.set(context.runId, context.observation);
    this.registry.webMcpTools.set(context.runId, discovery.lastAdmittedWebMcpTools);
    const semanticSurfaceCount = evidence.semanticControlCount;
    this.registry.setReadiness(context.runId, "semantic_ui", semanticSurfaceCount, semanticSurfaceCount);
    this.registry.setReadiness(context.runId, "page_webmcp", evidence.webMcpGate === "unavailable" ? 0 : 1, discovery.lastAdmittedWebMcpTools.length);
    this.registry.setReadiness(context.runId, "llms_txt", evidence.llmsTxt.status === "available" ? 1 : 0, 0);
    this.registry.setReadiness(context.runId, "json_ld", evidence.jsonLdTypes.length, 0);
    this.registry.setReadiness(context.runId, "visual_fallback", evidence.interfaces.filter((item) => item.kind === "visual_fallback").length, 0);
    await this.database.replaceDiscoveredInterfaces(context.runId, evidence.interfaces, signal);
    await appendRunStep(this.server, this.registry, this.ids, this.clock, context.runId, {
      type: "run.discovery.completed",
      payload: evidence,
    }, { kind: "discovery", interactionMode: "system", observationRevision: evidence.observationRevision, durationMs: Math.max(0, Math.floor(performance.now() - started)) }, signal);
    return evidence;
  }
}

function allow(effect: SafeActionEffect, revision: ObservationRevision): EffectDecision {
  return { decision: "allow", effect, observationRevision: revision };
}

class RuntimeSafeTools implements SafeAgentToolPort {
  #observation: UntrustedAgentObservation;
  #catalog: readonly WebMcpToolDescriptorV1[];
  readonly #configuredCatalog: readonly ConfiguredMcpToolDescriptorV1[];
  readonly #configuredEndpoints: ReadonlyMap<string, ConfiguredMcpEndpointV1>;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #policy: AgentPolicy;

  constructor(
    private readonly controller: BrowserController,
    initialObservation: UntrustedAgentObservation,
    allowedOrigins: readonly PublicHttpsOrigin[],
    private readonly webMcpEnabled: boolean,
    private readonly webMcp: SolariWebMcpReadOnlyAdapter,
    catalog: readonly WebMcpToolDescriptorV1[],
    private readonly configuredMcp: ConfiguredMcpClientPort,
    configuredEndpoints: readonly ConfiguredMcpEndpointV1[],
    configuredCatalog: readonly ConfiguredMcpToolDescriptorV1[],
    interfaceMode: PublicEvaluationConfigV2["interfaceMode"],
  ) {
    this.#observation = initialObservation;
    this.#catalog = catalog;
    this.#configuredCatalog = configuredCatalog;
    this.#configuredEndpoints = new Map(configuredEndpoints.map((endpoint) => [endpoint.id, endpoint]));
    this.#allowedOrigins = canonicalAllowedOrigins(allowedOrigins);
    this.#policy = new AgentPolicy({
      startOrigin: new URL(initialObservation.url).origin as PublicHttpsOrigin,
      allowedNavigationOrigins: [...allowedOrigins],
      availableTools: ["navigate", "inspect", "click", "type", "select", "pressKey", "scroll", "wait", "invokeWebMcpReadOnly", "invokeConfiguredMcpReadOnly", "finish"],
      interfaceMode,
      safetySummary: "anonymous public observable-state tasks only; unknown effects are denied",
    });
  }

  async surface(observationRevision: ObservationRevision, signal: AbortSignal): Promise<SafeAgentToolSurface> {
    throwIfAborted(signal);
    if (observationRevision !== this.#observation.revision) throw blockedByPolicy("stale_observation", "The browser observation changed before tool refresh");
    if (this.webMcpEnabled) {
      const origin = new URL(this.#observation.url).origin as PublicHttpsOrigin;
      try { this.#catalog = await this.webMcp.discover(this.controller, origin, signal); }
      catch { this.#catalog = []; }
    }
    const tools: SafeAgentToolName[] = ["navigate", "inspect", "click", "type", "select", "pressKey", "scroll", "wait"];
    if (this.webMcpEnabled && this.#catalog.length > 0) tools.push("invokeWebMcpReadOnly");
    if (this.#configuredCatalog.length > 0) tools.push("invokeConfiguredMcpReadOnly");
    tools.push("finish");
    return SafeAgentToolSurfaceSchema.parse({
      observationRevision,
      tools,
      webMcpTools: this.#catalog,
      configuredMcpTools: this.#configuredCatalog,
    });
  }

  async execute(action: SafeAgentAction, signal: AbortSignal): Promise<SafeAgentToolResult> {
    throwIfAborted(signal);
    const surface = await this.surface(action.observationRevision, signal);
    this.#policy.assertAction(action, this.#observation, surface);
    const base = { schemaVersion: 1 as const, toolCallId: action.toolCallId, finishedBelief: null, summary: "Safe browser action completed." };
    let result: SafeAgentToolResult;
    if (action.kind === "finish") {
      result = SafeAgentToolResultSchema.parse({ ...base, tool: "finish", decision: allow("finish_declaration", action.observationRevision), observation: null, finishedBelief: action.completed, summary: action.summary });
    } else if (action.kind === "invokeWebMcpReadOnly") {
      const webMcpResult = await this.webMcp.invoke(this.controller, { toolId: action.toolId, input: action.input, currentOrigin: new URL(this.#observation.url).origin as PublicHttpsOrigin }, signal);
      result = SafeAgentToolResultSchema.parse({ ...base, tool: action.kind, decision: allow("admitted_read_only_webmcp", action.observationRevision), observation: this.#observation, webMcpResult, summary: webMcpResult.summary });
    } else if (action.kind === "invokeConfiguredMcpReadOnly") {
      const endpoint = this.#configuredEndpoints.get(action.endpointId);
      if (endpoint === undefined) throw blockedByPolicy("native_tool_forbidden", "The configured MCP endpoint is no longer admitted for this run");
      const configuredMcpResult = await this.configuredMcp.invoke(endpoint, {
        endpointId: action.endpointId,
        toolId: action.toolId,
        input: action.input,
      }, signal);
      result = SafeAgentToolResultSchema.parse({
        ...base,
        tool: action.kind,
        decision: allow("admitted_read_only_configured_mcp", action.observationRevision),
        observation: this.#observation,
        configuredMcpResult,
        summary: configuredMcpResult.summary,
      });
    } else {
      let observation: UntrustedAgentObservation;
      let effect: SafeActionEffect;
      if (action.kind === "navigate") {
        const url = assertAllowedNavigation(action.url, this.#allowedOrigins);
        observation = await this.controller.navigate(url.href, signal);
        effect = "admitted_get_navigation";
      } else if (action.kind === "inspect") {
        observation = await this.controller.observe(signal);
        effect = "inspect";
      } else if (action.kind === "click") {
        const element = this.#observation.elements.find((item) => item.ref === action.ref);
        if (element === undefined) throw blockedByPolicy("stale_observation", "The selected control is no longer observable");
        const unsafe = obviousUnsafeControl({ tag: element.role, role: element.role, name: element.name, disabled: element.disabled, attributes: element.attributes });
        if (unsafe !== null) throw blockedByPolicy(unsafe, "The selected control is outside the public reversible task boundary");
        observation = await this.controller.click(action, signal);
        effect = element.attributes.href
          ? "admitted_get_navigation"
          : element.role === "checkbox" || element.role === "radio"
            ? "local_filter_select"
            : "disclosure_toggle";
      } else if (action.kind === "type") {
        const element = this.#observation.elements.find((item) => item.ref === action.ref);
        if (element === undefined) throw blockedByPolicy("stale_observation", "The selected field is no longer observable");
        const unsafe = obviousUnsafeControl({ tag: element.role, role: element.role, name: element.name, disabled: element.disabled, attributes: element.attributes });
        if (unsafe !== null) throw blockedByPolicy(unsafe, "The selected field may contain sensitive or effectful data");
        observation = await this.controller.type(action, signal);
        effect = "non_sensitive_filter_input";
      } else if (action.kind === "select") {
        observation = await this.controller.select(action, signal);
        effect = "local_filter_select";
      } else if (action.kind === "pressKey") {
        observation = await this.controller.pressKey(action, signal);
        effect = "restricted_key_navigation";
      } else if (action.kind === "scroll") {
        observation = await this.controller.scroll(action.direction, action.amount, signal);
        effect = "viewport_scroll";
      } else {
        observation = await this.controller.wait(action.durationMs, signal);
        effect = "passive_wait";
      }
      this.#policy.assertObservation(observation);
      this.#observation = observation;
      result = SafeAgentToolResultSchema.parse({ ...base, tool: action.kind, decision: allow(effect, action.observationRevision), observation });
    }
    return result;
  }
}

class RuntimeSafeToolFactory implements SafeAgentToolFactory {
  constructor(
    private readonly database: TracegateDatabase,
    private readonly registry: RunRuntimeRegistry,
    private readonly webMcp: SolariWebMcpReadOnlyAdapter,
    private readonly server: TracegateServer,
    private readonly ids: UuidV7Generator,
    private readonly clock: Clock,
  ) {}

  async create(context: Parameters<SafeAgentToolFactory["create"]>[0], signal: AbortSignal): Promise<SafeAgentToolRuntime> {
    throwIfAborted(signal);
    const runId = this.registry.requireRunId(context.controller, this.registry.controllerRunIds, "Browser controller");
    const config = this.registry.requireConfig(runId);
    const observation = this.registry.observations.get(runId);
    if (observation === undefined) throw new Error("Initial observation is missing after discovery");

    const configuredMcp = createConfiguredMcpClient();
    const configuredCatalog: ConfiguredMcpToolDescriptorV1[] = [];
    const configuredInterfaces = [];
    let configuredDiscovered = 0;
    let configuredAdmitted = 0;
    const started = performance.now();
    try {
      for (const endpoint of context.configuredMcpEndpoints) {
        try {
          const discoverySignal = AbortSignal.any([signal, AbortSignal.timeout(config.budgets.toolTimeoutMs)]);
          const result = await configuredMcp.discover(endpoint, discoverySignal);
          configuredDiscovered += result.readiness.selectedTools.length;
          configuredCatalog.push(...result.admittedTools);
          configuredAdmitted += result.admittedTools.length;
          configuredInterfaces.push(DiscoveredInterfaceSchema.parse({
            schemaVersion: 1,
            kind: "configured_mcp",
            name: result.readiness.label,
            metadata: {
              endpointId: result.readiness.endpointId,
              status: result.admittedTools.length > 0 ? "ready" : "no_admitted_tools",
              selectedToolCount: result.readiness.selectedTools.length,
              admittedToolCount: result.readiness.admittedTools.length,
              deniedToolCount: result.readiness.deniedTools.length,
              selectedTools: result.readiness.selectedTools,
              admittedTools: result.readiness.admittedTools,
              deniedTools: result.readiness.deniedTools,
            },
            discoveredAt: this.clock.nowIso(),
          }));
        } catch (error) {
          if (signal.aborted) throw error;
          configuredInterfaces.push(DiscoveredInterfaceSchema.parse({
            schemaVersion: 1,
            kind: "configured_mcp",
            name: endpoint.label,
            metadata: {
              endpointId: endpoint.id,
              status: "unavailable",
              selectedToolCount: endpoint.selectedTools.length,
              admittedToolCount: 0,
              deniedToolCount: endpoint.selectedTools.length,
              selectedTools: endpoint.selectedTools,
            },
            discoveredAt: this.clock.nowIso(),
          }));
        }
      }
      this.registry.setReadiness(runId, "configured_mcp", configuredDiscovered, configuredAdmitted);
      if (configuredInterfaces.length > 0) {
        const interfaces = [...context.discovery.interfaces, ...configuredInterfaces];
        await this.database.replaceDiscoveredInterfaces(runId, interfaces, signal);
        await appendRunStep(this.server, this.registry, this.ids, this.clock, runId, {
          type: "run.discovery.completed",
          payload: { ...context.discovery, interfaces },
        }, {
          kind: "discovery",
          interactionMode: "system",
          observationRevision: context.discovery.observationRevision,
          durationMs: Math.max(0, Math.floor(performance.now() - started)),
        }, signal);
      }
    } catch (error) {
      await configuredMcp.close(AbortSignal.timeout(5_000)).catch(() => undefined);
      throw error;
    }

    const tools = new RuntimeSafeTools(
      context.controller,
      observation,
      context.admittedTarget.allowedNavigationOrigins,
      context.webMcpReadOnlyEnabled,
      this.webMcp,
      this.registry.webMcpTools.get(runId) ?? [],
      configuredMcp,
      context.configuredMcpEndpoints,
      configuredCatalog,
      context.interfaceMode,
    );
    this.registry.toolRunIds.set(tools, runId);
    return {
      tools,
      close: () => configuredMcp.close(AbortSignal.timeout(5_000)),
    };
  }
}

class PersistingAgentRunner implements AgentRunner {
  readonly #factory: ReturnType<typeof createDeepSeekOpenRouterDriverFactory>;
  #modelVerification: Promise<void> | undefined;

  constructor(
    apiKey: string,
    private readonly registry: RunRuntimeRegistry,
    private readonly capabilities: TracegateRepositories["capabilities"],
    private readonly server: TracegateServer,
    private readonly ids: UuidV7Generator,
    private readonly clock: Clock,
  ) { this.#factory = createDeepSeekOpenRouterDriverFactory(apiKey); }

  async #verifyPersistedModelUsage(): Promise<void> {
    if (this.#modelVerification === undefined) {
      const verification = this.capabilities.upsert(RuntimeCapabilitySchema.parse({
        schemaVersion: 1,
        kind: "model",
        subject: DEEPSEEK,
        status: "verified",
        details: { configured: true, adapter: "TanStack AI + OpenRouter", verification: "persisted live model usage milestone" },
        checkedAt: this.clock.nowIso(),
        error: null,
      }), AbortSignal.timeout(5_000)).then(() => undefined);
      this.#modelVerification = verification.catch((error: unknown) => {
        this.#modelVerification = undefined;
        throw error;
      });
    }
    await this.#modelVerification;
  }

  async run(input: AgentExecutionInputV2, safeTools: SafeAgentToolPort, signal: AbortSignal): Promise<AgentRunResult> {
    const runId = this.registry.requireRunId(safeTools, this.registry.toolRunIds, "Safe tool surface");
    const config = this.registry.requireConfig(runId);
    const activity = new Map<InterfaceChannel, { invoked: number; succeeded: number; failed: number }>();
    const completedToolCallIds = new Set<string>();
    const runner = new TraceGateAgentRunner(this.#factory, {
      modelId: DEEPSEEK,
      sampling: config.sampling,
      sink: async (milestone) => {
        const parsed = AgentTraceEventSchema.parse(milestone) as AgentMilestone;
        if (parsed.type === "run.tool.completed" && !completedToolCallIds.has(parsed.payload.toolCallId)) {
          completedToolCallIds.add(parsed.payload.toolCallId);
          const delta = toolCompletionInterfaceUsageDelta(parsed.payload);
          if (delta !== null) {
            const current = activity.get(delta.channel) ?? { invoked: 0, succeeded: 0, failed: 0 };
            current.invoked += 1;
            current[delta.outcome] += 1;
            activity.set(delta.channel, current);
          }
        }
        const kind: RunStep["kind"] = parsed.type.startsWith("run.tool") ? "tool" : "model";
        const durationMs = parsed.type === "run.tool.completed" ? parsed.payload.durationMs : null;
        await appendRunStep(this.server, this.registry, this.ids, this.clock, runId, parsed, { kind, interactionMode: "safe_tool", observationRevision: null, durationMs }, signal);
        if (parsed.type === "run.usage.updated") await this.#verifyPersistedModelUsage();
      },
    });
    const result = await runner.run(input, safeTools, signal);
    const readiness = this.registry.readiness.get(runId) ?? new Map();
    const channels: readonly InterfaceChannel[] = ["semantic_ui", "page_webmcp", "configured_mcp", "llms_txt", "json_ld", "visual_fallback"];
    const metrics: InterfaceUsageMetric[] = channels.map((channel) => {
      const available = readiness.get(channel) ?? { discovered: 0, admitted: 0 };
      const used = activity.get(channel) ?? { invoked: 0, succeeded: 0, failed: 0 };
      return {
        channel,
        discovered: Math.max(available.discovered, used.invoked > 0 ? 1 : 0),
        admitted: Math.max(available.admitted, used.invoked > 0 ? 1 : 0),
        invoked: used.invoked,
        succeeded: used.succeeded,
        failed: used.failed,
      };
    });
    return AgentRunResultSchema.parse({
      ...result,
      interfaceUsage: InterfaceUsageSummarySchema.parse({ schemaVersion: 1, metrics }),
    });
  }
}

class PersistingEvidenceCapture implements AssertionEvidenceCapture {
  readonly #inner = new FreshBrowserAssertionEvidenceCapture();
  constructor(
    private readonly database: TracegateDatabase,
    private readonly registry: RunRuntimeRegistry,
    private readonly server: TracegateServer,
    private readonly ids: UuidV7Generator,
    private readonly clock: Clock,
  ) {}

  async capture(controller: BrowserController, input: AssertionCaptureInput, signal: AbortSignal): Promise<AssertionCaptureResult> {
    const runId = this.registry.requireRunId(controller, this.registry.controllerRunIds, "Browser controller");
    await appendRunStep(this.server, this.registry, this.ids, this.clock, runId, { type: "run.evidence.capture_started", payload: { attempt: 1 } }, { kind: "grading", interactionMode: "system", observationRevision: null, durationMs: null }, signal);
    const started = performance.now();
    const captured = await this.#inner.capture(controller, input, signal);
    await this.database.upsertAssertionEvidence(runId, captured.evidence, signal);
    await appendRunStep(this.server, this.registry, this.ids, this.clock, runId, {
      type: "run.evidence.captured",
      payload: {
        evidenceHash: captured.evidence.evidenceHash,
        captureAttempts: captured.evidence.captureAttempts,
        unverifiableCount: captured.evidence.assertions.filter((item) => item.status === "unverifiable").length,
      },
    }, { kind: "grading", interactionMode: "system", observationRevision: null, durationMs: Math.max(0, Math.floor(performance.now() - started)) }, signal);
    return captured;
  }
}

class PersistingGrader implements Grader {
  readonly #runByEvidenceHash = new Map<string, RunId>();
  constructor(
    private readonly inner: Grader,
    private readonly registry: RunRuntimeRegistry,
    private readonly server: TracegateServer,
    private readonly ids: UuidV7Generator,
    private readonly clock: Clock,
  ) {}

  bind(runId: RunId, evidenceHash: string): void { this.#runByEvidenceHash.set(evidenceHash, runId); }

  async grade(input: GradeInputV2, signal: AbortSignal): Promise<GradeResultV2> {
    const runId = this.#runByEvidenceHash.get(input.evidence.evidenceHash);
    if (runId === undefined) throw new Error("Committed evidence is not bound to the active run");
    await appendRunStep(this.server, this.registry, this.ids, this.clock, runId, { type: "run.grade.started", payload: { evidenceHash: input.evidence.evidenceHash } }, { kind: "grading", interactionMode: "system", observationRevision: null, durationMs: null }, signal);
    const started = performance.now();
    try {
      const grade = await this.inner.grade(input, signal);
      await appendRunStep(this.server, this.registry, this.ids, this.clock, runId, { type: "run.grade.completed", payload: grade }, { kind: "grading", interactionMode: "system", observationRevision: null, durationMs: Math.max(0, Math.floor(performance.now() - started)) }, signal);
      return grade;
    } finally {
      this.#runByEvidenceHash.delete(input.evidence.evidenceHash);
    }
  }
}

class BindingEvidenceCapture implements AssertionEvidenceCapture {
  constructor(private readonly inner: PersistingEvidenceCapture, private readonly grader: PersistingGrader, private readonly registry: RunRuntimeRegistry) {}
  async capture(controller: BrowserController, input: AssertionCaptureInput, signal: AbortSignal): Promise<AssertionCaptureResult> {
    const captured = await this.inner.capture(controller, input, signal);
    const runId = this.registry.requireRunId(controller, this.registry.controllerRunIds, "Browser controller");
    this.grader.bind(runId, captured.evidence.evidenceHash);
    return captured;
  }
}

export interface FunctionalRuntimeOptions {
  readonly openRouterApiKey: string;
  readonly solariApiKey: string;
  readonly maximumConcurrency?: number;
}

export class FunctionalTracegateRuntime {
  readonly #queue = new OneEvaluationQueue(4);
  readonly #registry = new RunRuntimeRegistry();
  readonly #executor: FunctionalEvaluationExecutor;
  readonly #provider: SolariBrowserProvider;
  readonly #evaluations: EvaluationRepository;
  readonly #server: TracegateServer;
  readonly #clock: Clock;
  readonly #ids: UuidV7Generator;
  #closing = false;

  constructor(database: TracegateDatabase, options: FunctionalRuntimeOptions, serverFactory: (schedule: (evaluation: Evaluation, runs: readonly Run[]) => void) => TracegateServer) {
    this.#clock = new SystemClock();
    this.#ids = new UuidV7Generator();
    this.#provider = new SolariBrowserProvider({ apiKey: options.solariApiKey });
    const repositories = createTracegateRepositories(database);
    const capacity = new RuntimeCapacity(options.maximumConcurrency ?? 3);
    this.#server = serverFactory((evaluation, runs) => this.schedule(evaluation, runs));
    this.#evaluations = publishingEvaluationRepository(repositories.evaluations, this.#server, this.#ids, this.#clock);
    const webMcp = new SolariWebMcpReadOnlyAdapter();
    const grader = new PersistingGrader(new DeterministicObservableGrader(this.#clock), this.#registry, this.#server, this.#ids, this.#clock);
    const capture = new BindingEvidenceCapture(new PersistingEvidenceCapture(database, this.#registry, this.#server, this.#ids, this.#clock), grader, this.#registry);
    const runExecutor = new FunctionalRunExecutor({
      admission: new PracticalTargetAdmission(),
      browserProvider: new InstrumentedBrowserProvider(this.#provider, repositories.providerCreateAttempts, repositories.capabilities, this.#server, this.#registry, this.#ids, this.#clock),
      controllerFactory: new RunAwareControllerFactory(this.#registry),
      browserSessions: repositories.browserSessions,
      discovery: new PersistingDiscoveryController(database, this.#registry, webMcp, this.#server, this.#ids, this.#clock),
      safeToolFactory: new RuntimeSafeToolFactory(database, this.#registry, webMcp, this.#server, this.#ids, this.#clock),
      agent: new PersistingAgentRunner(options.openRouterApiKey, this.#registry, repositories.capabilities, this.#server, this.#ids, this.#clock),
      capture,
      grader,
      runs: publishingRunRepository(repositories.runs, this.#server, this.#registry),
      transitions: publishingTransitionRepository(repositories.runs, this.#server, this.#registry, this.#clock),
      capacity,
      ids: this.#ids,
      clock: this.#clock,
    });
    this.#executor = new FunctionalEvaluationExecutor({ evaluations: this.#evaluations, runExecutor, capacity, clock: this.#clock });
  }

  get server(): TracegateServer { return this.#server; }

  schedule(evaluation: Evaluation, runs: readonly Run[]): void {
    if (this.#closing) return;
    this.#registry.register(evaluation, runs);
    const job = this.#queue.enqueue(evaluation.id, async (signal) => {
      try {
        await this.#executor.execute(evaluation, runs, signal);
      } finally {
        this.#registry.unregister(runs);
      }
    });
    void job.catch((error: unknown) => this.#failScheduledEvaluation(evaluation.id, error));
  }

  async recover(signal: AbortSignal): Promise<void> {
    const recoverableEvaluations = await this.#evaluations.listRecoverable(signal);
    const recoverableRuns = await this.#server.database.listRecoverableRuns(signal);
    for (const evaluation of recoverableEvaluations) {
      if (evaluation.status === "queued") {
        const runs = recoverableRuns.filter((run) => run.evaluationId === evaluation.id && run.status === "queued");
        if (runs.length > 0) this.schedule(evaluation, runs);
      } else {
        await this.#evaluations.compareAndSetStatus(evaluation.id, evaluation.status, "failed", {
          finishedAt: this.#clock.nowIso(),
          failure: createControlError("internal_error", "The previous process stopped before this evaluation reached a durable terminal state.", { category: "infrastructure", phase: "startup_recovery", retryable: true }),
        }, signal);
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    const state = this.#queue.state();
    if (state.activeEvaluationId !== null) this.#queue.cancel(state.activeEvaluationId);
    for (const id of state.pendingEvaluationIds) this.#queue.cancel(id);
    await this.#queue.idle();
    await this.#provider.close();
    await this.#server.database.close();
  }

  async #failScheduledEvaluation(evaluationId: EvaluationId, error: unknown): Promise<void> {
    const current = await this.#evaluations.get(evaluationId, AbortSignal.timeout(5_000)).catch(() => null);
    if (current === null || ["completed", "cancelled", "failed"].includes(current.status)) return;
    const safe = redactError(error);
    await this.#evaluations.compareAndSetStatus(evaluationId, current.status, "failed", {
      finishedAt: this.#clock.nowIso(),
      failure: createControlError("internal_error", "Evaluation scheduling or execution stopped unexpectedly.", { category: "infrastructure", phase: "evaluation_schedule", retryable: true, causeChain: [safe.message] }),
    }, AbortSignal.timeout(5_000)).catch(() => false);
  }
}

export async function persistBootCapabilities(database: TracegateDatabase, clock: Clock): Promise<void> {
  const checkedAt = clock.nowIso();
  const durable = await database.listCapabilities(AbortSignal.timeout(5_000));
  const isDurablyVerified = (kind: "model" | "solari", subject: string) => durable.some(
    (capability) => capability.kind === kind && capability.subject === subject && capability.status === "verified",
  );

  if (!isDurablyVerified("model", DEEPSEEK)) {
    await database.upsertCapability(RuntimeCapabilitySchema.parse({
      schemaVersion: 1,
      kind: "model",
      subject: DEEPSEEK,
      status: "pending",
      details: { configured: true, adapter: "TanStack AI + OpenRouter", verification: "requested, not yet verified by persisted live usage" },
      checkedAt,
      error: null,
    }), AbortSignal.timeout(5_000));
  }
  if (!isDurablyVerified("solari", "browser-session-runtime")) {
    await database.upsertCapability(RuntimeCapabilitySchema.parse({
      schemaVersion: 1,
      kind: "solari",
      subject: "browser-session-runtime",
      status: "pending",
      details: { configured: true, provider: "Solari Browser", verification: "requested, not yet verified by a live session" },
      checkedAt,
      error: null,
    }), AbortSignal.timeout(5_000));
  }
  await database.upsertCapability(RuntimeCapabilitySchema.parse({
    schemaVersion: 1,
    kind: "webmcp",
    subject: "current-origin-read-only-adapter",
    status: "verified",
    details: { defaultEnabled: false, trust: "untrusted page capability", admission: "read-only current-origin" },
    checkedAt,
    error: null,
  }), AbortSignal.timeout(5_000));
}
