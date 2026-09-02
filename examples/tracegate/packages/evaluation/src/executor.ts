import {
  AgentRunResultSchema,
  BrowserSessionSummarySchema,
  EventAppendInputSchema,
  FailureRecordSchema,
  GradeResultV2Schema,
  RunStatusChangedEventAppendInputSchema,
  RunWarningSchema,
  ReleaseResultSchema,
  TERMINAL_FAILURE_SEMANTICS,
  buildAgentExecutionInputV2,
  createControlError,
  isBrowserProviderConcurrencyLimitError,
  isTraceGateError,
  summarizeAssertionExpectation,
  type AdmittedPublicTarget,
  type AgentRunResult,
  type AgentRunner,
  type AssertionEvidenceCapture,
  type BrowserController,
  type BrowserControllerFactory,
  type BrowserLease,
  type BrowserProvider,
  type BrowserSessionRepository,
  type BrowserSessionSummary,
  type Clock,
  type ConfiguredMcpEndpointV1,
  type DiscoveryController,
  type DiscoveryEvidence,
  type FailureRecord,
  type GradeResultV2,
  type Grader,
  type IdGenerator,
  type InterfaceMode,
  type ProviderCapacityPort,
  type PublicEvaluationConfigV2,
  type ReleaseResult,
  type Run,
  type RunRepository,
  type RunStatus,
  type RunTransitionRepository,
  type RunWarning,
  type SafeAgentToolPort,
  type TargetAdmissionPort,
} from "@tracegate/shared";

export interface SafeAgentToolFactoryContext {
  readonly controller: BrowserController;
  readonly admittedTarget: AdmittedPublicTarget;
  readonly discovery: DiscoveryEvidence;
  readonly interfaceMode: InterfaceMode;
  readonly webMcpReadOnlyEnabled: boolean;
  readonly configuredMcpEndpoints: readonly ConfiguredMcpEndpointV1[];
}

export interface SafeAgentToolRuntime {
  readonly tools: SafeAgentToolPort;
  close(signal: AbortSignal): Promise<void>;
}

export interface SafeAgentToolFactory {
  create(context: SafeAgentToolFactoryContext, signal: AbortSignal): Promise<SafeAgentToolRuntime>;
}

export interface RunExecutorDependencies {
  readonly admission: TargetAdmissionPort;
  readonly browserProvider: BrowserProvider;
  readonly controllerFactory: BrowserControllerFactory;
  readonly browserSessions: BrowserSessionRepository;
  readonly discovery: DiscoveryController;
  readonly safeToolFactory: SafeAgentToolFactory;
  readonly agent: AgentRunner;
  readonly capture: AssertionEvidenceCapture;
  readonly grader: Grader;
  readonly runs: RunRepository;
  readonly transitions: RunTransitionRepository;
  readonly capacity: ProviderCapacityPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface RunExecutionResult {
  readonly run: Run | null;
  readonly terminalized: boolean;
  readonly release: ReleaseResult | null;
  readonly failure: FailureRecord | null;
  readonly warnings: readonly RunWarning[];
}

class ExpectedRunFailure extends Error {
  readonly failure: FailureRecord;
  readonly potentialSessionLeak: boolean;
  constructor(failure: FailureRecord, potentialSessionLeak = false) {
    super(failure.message);
    this.failure = failure;
    this.potentialSessionLeak = potentialSessionLeak;
  }
}

class SystemicRunError extends Error {
  readonly phase: string;
  constructor(phase: string, options: { cause?: unknown } = {}) {
    super(`Durable run orchestration failed during ${phase}.`, options);
    this.name = "SystemicRunError";
    this.phase = phase;
  }
}

const systemicRunError = (phase: string, error: unknown): SystemicRunError =>
  error instanceof SystemicRunError ? error : new SystemicRunError(phase, { cause: error });

const terminalFailure = (
  code: FailureRecord["code"],
  message: string,
  phase: string,
  options: {
    policyCode?: FailureRecord["policyCode"];
    potentialSessionLeak?: boolean;
    retryable?: boolean;
    causeChain?: FailureRecord["causeChain"];
  } = {},
): ExpectedRunFailure => {
  const semantics = TERMINAL_FAILURE_SEMANTICS[code];
  return new ExpectedRunFailure(FailureRecordSchema.parse({
    schemaVersion: 1,
    category: semantics.category,
    code,
    phase,
    retryable: options.retryable ?? false,
    outcome: semantics.outcome,
    message,
    fieldIssues: [],
    causeChain: options.causeChain ?? [],
    policyCode: options.policyCode ?? null,
  }), options.potentialSessionLeak ?? false);
};

const appendRunWarning = (warnings: RunWarning[], candidate: RunWarning): void => {
  if (warnings.length >= 50) return;
  if (warnings.some((item) => item.code === candidate.code && item.phase === candidate.phase && item.message === candidate.message)) return;
  warnings.push(candidate);
};

const warning = (code: RunWarning["code"], phase: string, message: string, retryable = false): RunWarning => RunWarningSchema.parse({
  schemaVersion: 1,
  category: "infrastructure",
  code,
  phase,
  retryable,
  message,
  fieldIssues: [],
  causeChain: [],
});

export class FunctionalRunExecutor {
  readonly #dependencies: RunExecutorDependencies;

  constructor(dependencies: RunExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(run: Run, config: PublicEvaluationConfigV2, signal: AbortSignal): Promise<RunExecutionResult> {
    const dependencies = this.#dependencies;
    let currentStatus: RunStatus = run.status;
    let sequence = 0;
    let lease: BrowserLease | null = null;
    let acquiredAt: BrowserSessionSummary["acquiredAt"] | null = null;
    let controller: BrowserController | null = null;
    let safeToolRuntime: SafeAgentToolRuntime | null = null;
    let release: ReleaseResult | null = null;
    let grade: GradeResultV2 | null = null;
    let agentResult: AgentRunResult | null = null;
    let failure: FailureRecord | null = null;
    let potentialSessionLeak = false;
    let executionPhase = "run_precondition";
    let systemicFailure: SystemicRunError | null = null;
    const warnings: RunWarning[] = [];
    const startedAt = dependencies.clock.nowIso();

    const transition = async (nextStatus: Exclude<RunStatus, "completed" | "cancelled">, patch: Record<string, unknown>, transitionSignal: AbortSignal): Promise<void> => {
      try {
        sequence += 1;
        const result = await dependencies.transitions.transactionallyApply({
          runId: run.id,
          expectedStatus: currentStatus as Exclude<RunStatus, "completed" | "cancelled">,
          nextStatus,
          context: { mode: "normal", leaseDisposition: lease === null ? "none" : "may_exist" },
          patch,
          event: RunStatusChangedEventAppendInputSchema.parse({
            schemaVersion: 1,
            eventId: dependencies.ids.eventId(),
            evaluationId: run.evaluationId,
            runId: run.id,
            runSequence: sequence,
            occurredAt: dependencies.clock.nowIso(),
            type: "run.status_changed",
            payload: { previous: currentStatus, next: nextStatus, mode: "normal" },
          }),
        }, transitionSignal);
        if (!result.applied) throw new Error("run transition lost compare-and-set");
        currentStatus = nextStatus;
      } catch (error) {
        if (transitionSignal.aborted) throw error;
        throw systemicRunError("run_transition", error);
      }
    };

    try {
      if (run.status !== "queued") throw new Error("functional executor requires a queued run");
      await transition("acquiring_browser", { startedAt }, signal);

      executionPhase = "target_admission";
      const admission = await dependencies.admission.assess(config.target, signal);
      if (admission.status === "rejected") {
        throw terminalFailure("target_admission_failed", admission.message, "target_admission");
      }

      executionPhase = "browser_acquire";
      try {
        lease = await dependencies.browserProvider.acquire({
          evaluationId: run.evaluationId,
          runId: run.id,
          modelId: run.modelId,
          attemptCorrelationId: dependencies.ids.createAttemptCorrelationId(),
          recordingRequested: config.recordingRequested,
        }, signal);
      } catch (error) {
        if (isBrowserProviderConcurrencyLimitError(error)) {
          try {
            await dependencies.capacity.reduceAfterLimit(error.safe.retryAfterMs, signal);
          } catch (capacityError) {
            if (signal.aborted) throw capacityError;
            throw systemicRunError("provider_capacity", capacityError);
          }
          throw terminalFailure("solari_unavailable", "The provider declined this single create attempt because its concurrency limit was reached.", "browser_acquire");
        }
        if (isTraceGateError(error) && error.safe.code === "session_create_ambiguous") {
          throw terminalFailure("session_create_ambiguous", error.safe.message, "browser_acquire", { potentialSessionLeak: true });
        }
        throw error;
      }

      acquiredAt = dependencies.clock.nowIso();
      executionPhase = "browser_session_persist";
      await dependencies.browserSessions.upsert(BrowserSessionSummarySchema.parse({
        schemaVersion: 2,
        runId: run.id,
        providerSessionId: lease.providerSessionId,
        region: lease.region,
        acquiredAt,
        releasedAt: null,
        releaseStatus: "not_started",
        releaseConfirmed: false,
        replayStatus: config.recordingRequested ? "recording" : "not_requested",
        recordingRequested: config.recordingRequested,
      }), signal);

      await transition("connecting_browser", {}, signal);
      executionPhase = "browser_connect";
      controller = await dependencies.controllerFactory.create(lease, signal);
      await controller.connect(lease, signal);
      executionPhase = "navigation";
      const initialObservation = await controller.navigate(admission.target.startUrl, signal);
      await transition("discovering", {}, signal);
      executionPhase = "discovery";
      const discovery = await dependencies.discovery.discover({
        runId: run.id,
        observation: initialObservation,
        interfaceMode: config.interfaceMode,
        admittedTarget: admission.target,
      }, signal);
      for (const discoveryWarning of discovery.warnings) appendRunWarning(warnings, discoveryWarning);
      await transition("running_agent", {}, signal);
      executionPhase = "agent_setup";
      safeToolRuntime = await dependencies.safeToolFactory.create({
        controller,
        admittedTarget: admission.target,
        discovery,
        interfaceMode: config.interfaceMode,
        webMcpReadOnlyEnabled: config.webMcpReadOnlyEnabled,
        configuredMcpEndpoints: config.configuredMcpEndpoints ?? [],
      }, signal);
      const surface = await safeToolRuntime.tools.surface(initialObservation.revision, signal);
      executionPhase = "agent_execution";
      agentResult = AgentRunResultSchema.parse(await dependencies.agent.run(
        buildAgentExecutionInputV2(config, initialObservation, surface.tools),
        safeToolRuntime.tools,
        signal,
      ));
      for (const agentWarning of agentResult.warnings) appendRunWarning(warnings, agentWarning);
      await transition("grading", {}, signal);
      executionPhase = "assertion_capture";
      const captured = await dependencies.capture.capture(controller, { assertions: config.assertions }, signal);
      executionPhase = "grading";
      grade = await dependencies.grader.grade({
        assertions: config.assertions,
        transient: captured.transient,
        evidence: captured.evidence,
        agentCompletionDisposition: agentResult.completionDisposition,
      }, signal);
      failure = grade.failure;
    } catch (error) {
      if (error instanceof SystemicRunError) {
        systemicFailure = error;
      } else if (signal.aborted) {
        failure = null;
      } else if (error instanceof ExpectedRunFailure) {
        failure = error.failure;
        potentialSessionLeak ||= error.potentialSessionLeak;
      } else {
        const safeFailure = isTraceGateError(error)
          ? FailureRecordSchema.safeParse(error.safe)
          : null;
        failure = safeFailure?.success
          ? safeFailure.data
          : terminalFailure(
              "unexpected_run_error",
              "Run execution stopped unexpectedly before a trustworthy outcome was established.",
              executionPhase,
            ).failure;
      }
    } finally {
      if (lease !== null) {
        if (currentStatus !== "releasing_browser") {
          try {
            await transition("releasing_browser", { releaseStatus: "releasing", potentialSessionLeak }, AbortSignal.timeout(15_000));
          } catch (error) {
            systemicFailure ??= systemicRunError("run_transition", error);
          }
        }
        if (safeToolRuntime !== null) {
          try {
            await safeToolRuntime.close(AbortSignal.timeout(15_000));
          } catch {
            appendRunWarning(warnings, warning("cleanup_failed", "safe_tool_close", "Safe tool runtime cleanup failed.", true));
          }
        }
        if (controller !== null) {
          try {
            await controller.close(AbortSignal.timeout(15_000));
          } catch {
            appendRunWarning(warnings, warning("cleanup_failed", "browser_close", "Browser controller cleanup failed.", true));
          }
        }
        try {
          release = ReleaseResultSchema.parse(await lease.release(
            signal.aborted ? "cancelled" : "run finished",
            AbortSignal.timeout(15_000),
          ));
        } catch {
          release = {
            status: "failed",
            confirmation: "unconfirmed",
            releasedAt: null,
            warning: warning("cleanup_failed", "browser_release", "Browser session release failed.", true),
          };
        }
        if (release.warning !== null) appendRunWarning(warnings, release.warning);
        try {
          await dependencies.browserSessions.upsert(BrowserSessionSummarySchema.parse({
            schemaVersion: 2,
            runId: run.id,
            providerSessionId: lease.providerSessionId,
            region: lease.region,
            acquiredAt: acquiredAt ?? startedAt,
            releasedAt: release.releasedAt,
            releaseStatus: release.status,
            releaseConfirmed: release.confirmation === "confirmed_released",
            replayStatus: config.recordingRequested ? "pending" : "not_requested",
            recordingRequested: config.recordingRequested,
          }), AbortSignal.timeout(15_000));
        } catch (error) {
          systemicFailure ??= systemicRunError("browser_session_persist", error);
        }
      }
    }

    if (systemicFailure !== null) throw systemicFailure;

    if (lease !== null && release?.confirmation !== "confirmed_released") {
      throw systemicRunError("browser_release", new Error("acknowledged browser session release was not confirmed"));
    }

    if (signal.aborted) {
      try {
        const reason = createControlError("user_requested", "The evaluation was cancelled.", { category: "cancellation", phase: "evaluation_execution" });
        sequence += 1;
        const cancelled = await dependencies.runs.transactionallyCancel({
          runId: run.id,
          expectedStatus: currentStatus as Exclude<RunStatus, "completed" | "cancelled">,
          context: { mode: "normal", leaseDisposition: lease === null ? "none" : "released" },
          reason,
          finishedAt: dependencies.clock.nowIso(),
          releaseStatus: lease === null ? "not_started" : "released",
          warnings,
          potentialSessionLeak,
          event: EventAppendInputSchema.parse({
            schemaVersion: 1,
            eventId: dependencies.ids.eventId(),
            evaluationId: run.evaluationId,
            runId: run.id,
            runSequence: sequence,
            occurredAt: dependencies.clock.nowIso(),
            type: "run.cancelled",
            payload: { reason },
          }),
        }, AbortSignal.timeout(5_000));
        if (!cancelled.applied || cancelled.run === null) throw new Error("run cancellation lost compare-and-set");
        return { run: cancelled.run, terminalized: true, release, failure: null, warnings };
      } catch (error) {
        throw systemicRunError("run_cancellation", error);
      }
    }

    if (failure !== null && grade === null) grade = this.#inconclusiveGrade(config, failure);
    if (grade === null) throw systemicRunError("run_finalization", new Error("run completed execution without a grade"));
    failure = grade.failure;
    const leaseDisposition = lease === null ? "none" : "released";
    sequence += 1;
    try {
      const result = await dependencies.runs.transactionallyFinalize({
        runId: run.id,
        expectedStatus: currentStatus as Exclude<RunStatus, "completed" | "cancelled">,
        context: { mode: "normal", leaseDisposition },
        outcome: grade.outcome,
        grade,
        failure,
        warnings,
        finishedAt: dependencies.clock.nowIso(),
        resultPatch: {
          resolvedProvider: agentResult?.resolvedProvider ?? null,
          iterations: agentResult?.iterations ?? 0,
          toolCalls: agentResult?.toolCalls ?? 0,
          browserActions: agentResult?.browserActions ?? 0,
          interfaceUsage: agentResult?.interfaceUsage,
          usage: agentResult?.usage ?? { promptTokens: null, completionTokens: null, totalTokens: null },
          releaseStatus: lease === null ? "not_started" : "released",
          replayStatus: config.recordingRequested ? "pending" : "not_requested",
          potentialSessionLeak,
        },
        event: EventAppendInputSchema.parse({
          schemaVersion: 1,
          eventId: dependencies.ids.eventId(),
          evaluationId: run.evaluationId,
          runId: run.id,
          runSequence: sequence,
          occurredAt: dependencies.clock.nowIso(),
          type: `run.${grade.outcome}`,
          payload: grade.outcome === "passed" ? { outcome: "passed" } : { outcome: grade.outcome, failure },
        }),
      }, AbortSignal.timeout(5_000));
      if (!result.applied || result.run === null) throw new Error("run finalization lost compare-and-set");
      return { run: result.run, terminalized: true, release, failure: result.run.failure, warnings };
    } catch (error) {
      throw systemicRunError("run_finalization", error);
    }
  }

  #inconclusiveGrade(config: PublicEvaluationConfigV2, failure: FailureRecord): GradeResultV2 {
    return GradeResultV2Schema.parse({
      schemaVersion: 2,
      evidenceHash: "0".repeat(64),
      safetyPolicyVersion: config.safetyPolicyVersion,
      outcome: "inconclusive",
      assertions: config.assertions.map((assertion) => ({
        assertionId: assertion.id,
        status: "unverifiable",
        expectedSummary: summarizeAssertionExpectation(assertion),
        actualSummary: "No trustworthy final browser evidence was available.",
        code: "evidence_invalid",
      })),
      failure,
      gradedAt: this.#dependencies.clock.nowIso(),
    });
  }
}
