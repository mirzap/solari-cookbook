import {
  BrowserSessionSummarySchema,
  EventAppendInputSchema,
  FailureRecordSchema,
  GradeResultV2Schema,
  RunStatusChangedEventAppendInputSchema,
  RunWarningSchema,
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
  const semantics = {
    assertion_failed: ["incorrect_state", "failed"],
    assertion_unverifiable: ["grading", "inconclusive"],
    unsafe_action_blocked: ["policy", "inconclusive"],
    target_admission_failed: ["infrastructure", "inconclusive"],
    budget_exhausted: ["timeout", "inconclusive"],
    stale_element_exhausted: ["tool_error", "inconclusive"],
    solari_unavailable: ["infrastructure", "inconclusive"],
    target_unavailable: ["infrastructure", "inconclusive"],
    target_evidence_lost: ["infrastructure", "inconclusive"],
    provider_protocol_error: ["model_provider", "inconclusive"],
    invalid_evidence: ["grading", "inconclusive"],
    session_create_ambiguous: ["infrastructure", "inconclusive"],
    session_release_unconfirmed: ["infrastructure", "inconclusive"],
  } as const;
  const [category, outcome] = semantics[code];
  return new ExpectedRunFailure(FailureRecordSchema.parse({
    schemaVersion: 1,
    category,
    code,
    phase,
    retryable: options.retryable ?? false,
    outcome,
    message,
    fieldIssues: [],
    causeChain: options.causeChain ?? [],
    policyCode: options.policyCode ?? null,
  }), options.potentialSessionLeak ?? false);
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
    const warnings: RunWarning[] = [];
    const startedAt = dependencies.clock.nowIso();

    const transition = async (nextStatus: Exclude<RunStatus, "completed" | "cancelled">, patch: Record<string, unknown>, transitionSignal: AbortSignal): Promise<void> => {
      sequence += 1;
      const result = await dependencies.transitions.transactionallyApply({
        runId: run.id,
        expectedStatus: currentStatus as Exclude<RunStatus, "completed" | "cancelled">,
        nextStatus,
        context: { mode: "normal", leaseDisposition: lease === null ? "none" : nextStatus === "releasing_browser" ? "may_exist" : "may_exist" },
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
      if (!result.applied) throw new Error(`run transition lost compare-and-set: ${currentStatus} -> ${nextStatus}`);
      currentStatus = nextStatus;
    };

    try {
      if (run.status !== "queued") throw new Error("functional executor requires a queued run");
      await transition("acquiring_browser", { startedAt }, signal);

      const admission = await dependencies.admission.assess(config.target, signal);
      if (admission.status === "rejected") {
        throw terminalFailure("target_admission_failed", admission.message, "target_admission");
      }

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
          await dependencies.capacity.reduceAfterLimit(error.safe.retryAfterMs, signal);
          throw terminalFailure("solari_unavailable", "The provider declined this single create attempt because its concurrency limit was reached.", "browser_acquire");
        }
        if (isTraceGateError(error) && error.safe.code === "session_create_ambiguous") {
          throw terminalFailure("session_create_ambiguous", error.safe.message, "browser_acquire", { potentialSessionLeak: true });
        }
        throw error;
      }

      acquiredAt = dependencies.clock.nowIso();
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
      controller = await dependencies.controllerFactory.create(lease, signal);
      await controller.connect(lease, signal);
      const initialObservation = await controller.navigate(admission.target.startUrl, signal);
      await transition("discovering", {}, signal);
      const discovery = await dependencies.discovery.discover({
        runId: run.id,
        observation: initialObservation,
        interfaceMode: config.interfaceMode,
        admittedTarget: admission.target,
      }, signal);
      await transition("running_agent", {}, signal);
      safeToolRuntime = await dependencies.safeToolFactory.create({
        controller,
        admittedTarget: admission.target,
        discovery,
        interfaceMode: config.interfaceMode,
        webMcpReadOnlyEnabled: config.webMcpReadOnlyEnabled,
        configuredMcpEndpoints: config.configuredMcpEndpoints ?? [],
      }, signal);
      const surface = await safeToolRuntime.tools.surface(initialObservation.revision, signal);
      agentResult = await dependencies.agent.run(
        buildAgentExecutionInputV2(config, initialObservation, surface.tools),
        safeToolRuntime.tools,
        signal,
      );
      await transition("grading", {}, signal);
      const captured = await dependencies.capture.capture(controller, { assertions: config.assertions }, signal);
      grade = await dependencies.grader.grade({
        assertions: config.assertions,
        transient: captured.transient,
        evidence: captured.evidence,
      }, signal);
      failure = grade.failure;
    } catch (error) {
      if (signal.aborted) {
        failure = null;
      } else if (error instanceof ExpectedRunFailure) {
        failure = error.failure;
        potentialSessionLeak ||= error.potentialSessionLeak;
      } else {
        const safeFailure = isTraceGateError(error)
          ? FailureRecordSchema.safeParse(error.safe)
          : null;
        if (safeFailure?.success) {
          failure = safeFailure.data;
        } else {
          const code = currentStatus === "running_agent"
            ? "provider_protocol_error"
            : currentStatus === "discovering" || currentStatus === "grading"
              ? "target_evidence_lost"
              : currentStatus === "connecting_browser"
                ? "target_unavailable"
                : "solari_unavailable";
          const safeError = isTraceGateError(error) ? error.safe : null;
          const failureOptions = safeError === null
            ? {}
            : {
                retryable: "retryable" in safeError ? safeError.retryable : false,
                causeChain: safeError.causeChain,
              };
          failure = terminalFailure(
            code,
            safeError?.message ?? "Run execution stopped before trustworthy browser evidence was available.",
            safeError?.phase ?? currentStatus,
            failureOptions,
          ).failure;
        }
      }
    } finally {
      if (lease !== null) {
        if (currentStatus !== "releasing_browser") {
          try {
            await transition("releasing_browser", { releaseStatus: "releasing", potentialSessionLeak }, AbortSignal.timeout(15_000));
          } catch (error) {
            warnings.push(warning("cleanup_failed", "run_transition", error instanceof Error ? error.message : "Could not enter cleanup state.", true));
          }
        }
        if (safeToolRuntime !== null) {
          try {
            await safeToolRuntime.close(AbortSignal.timeout(15_000));
          } catch (error) {
            warnings.push(warning("cleanup_failed", "safe_tool_close", error instanceof Error ? error.message : "Safe tool runtime close failed.", true));
          }
        }
        if (controller !== null) {
          try {
            await controller.close(AbortSignal.timeout(15_000));
          } catch (error) {
            warnings.push(warning("cleanup_failed", "browser_close", error instanceof Error ? error.message : "Controller close failed.", true));
          }
        }
        try {
          release = await lease.release(signal.aborted ? "cancelled" : "run finished", AbortSignal.timeout(15_000));
        } catch (error) {
          release = {
            status: "failed",
            confirmation: "unconfirmed",
            releasedAt: null,
            warning: warning("cleanup_failed", "browser_release", error instanceof Error ? error.message : "Session release failed.", true),
          };
        }
        if (release.warning !== null) warnings.push(release.warning);
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
      }
    }

    if (signal.aborted) {
      if (lease !== null && release?.confirmation !== "confirmed_released") {
        const cleanupFailure = terminalFailure("session_release_unconfirmed", "The acknowledged Solari session release was not confirmed after cancellation.", "browser_release").failure;
        return { run: await dependencies.runs.get(run.id, AbortSignal.timeout(5_000)), terminalized: false, release, failure: cleanupFailure, warnings };
      }
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
      return { run: cancelled.run, terminalized: cancelled.applied, release, failure: null, warnings };
    }
    if (lease !== null && release?.confirmation !== "confirmed_released") {
      const cleanupFailure = terminalFailure("session_release_unconfirmed", "The acknowledged Solari session release was not confirmed.", "browser_release").failure;
      return { run: await dependencies.runs.get(run.id, AbortSignal.timeout(5_000)), terminalized: false, release, failure: cleanupFailure, warnings };
    }
    if (failure !== null && grade === null) grade = this.#inconclusiveGrade(config, failure);
    if (grade === null) throw new Error("run completed execution without a grade");
    failure = grade.failure;
    const leaseDisposition = lease === null ? "none" : "released";
    sequence += 1;
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
    }, signal);
    return { run: result.run, terminalized: result.applied, release, failure, warnings };
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
