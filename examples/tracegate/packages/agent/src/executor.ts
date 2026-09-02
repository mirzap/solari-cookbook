import { createHash } from "node:crypto";
import {
  AgentCompletionDispositionSchema,
  FailureAwareRunToolCompletedEventSchema,
  FailureRecordSchema,
  SafeAgentActionSchema,
  SafeAgentToolExchangeSchema,
  SafeAgentToolNameSchema,
  SafeAgentToolResultSchema,
  SafeAgentToolSurfaceSchema,
  SafeErrorSchema,
  ToolCallIdSchema,
  UntrustedAgentObservationSchema,
  browserPolicyDiagnosticFromFailureRecord,
  isTraceGateError,
  redactJson,
  type AgentCompletionDisposition,
  type ErrorCategory,
  type RunToolCompletionFailurePhase,
  type RunToolCompletionFailureV1,
  type SafeAgentAction,
  type SafeAgentToolName,
  type SafeErrorCode,
  type SafeAgentToolPort,
  type SafeAgentToolSurface,
  type ToolInterfaceSource,
  type UntrustedAgentObservation,
} from "@tracegate/shared";
import type { AgentToolExecutor, ToolAdmission } from "./model-driver.ts";
import { BudgetLedger } from "./budgets.ts";
import { terminalError, throwIfAborted } from "./errors.ts";
import { emitMilestone, type AgentMilestoneSink } from "./milestones.ts";
import { AgentPolicy } from "./policy.ts";

interface Admission extends ToolAdmission {
  readonly providerCallId: string;
  readonly toolName: SafeAgentToolName;
  readonly observationRevision: number;
  readonly rawArguments: string;
  readonly admittedAt: number;
}

type SafeToolErrorReason = "malformed_proposal" | "policy_denied" | "stale_proposal" | "tool_unavailable" | "tool_failed";

interface TrustedRuntimeFailurePolicy {
  readonly trust: "trusted_agent_runtime";
  readonly equivalentFailureCount: number;
  readonly retryAllowed: false;
  readonly requiredAdaptation: true;
}

interface RejectedAdmission extends ToolAdmission {
  readonly providerCallId: string;
  readonly toolName: SafeAgentToolName | null;
  readonly admittedAt: number;
  readonly rejection: SafeToolErrorReason;
}

type StoredAdmission = Admission | RejectedAdmission;
type ExecutionStage = "pre_dispatch" | "port_entered" | "post_dispatch_validation";
type OriginalDispatchState = {
  disposition: "dispatched" | "rejected_before_dispatch";
};
type FailureAwareCompletion = Readonly<{
  tool: SafeAgentToolName;
  resultSummary: string;
} & (
  | { dispatchDisposition: "dispatched"; success: true }
  | {
      dispatchDisposition: "dispatched" | "rejected_before_dispatch";
      success: false;
      failure: RunToolCompletionFailureV1;
    }
)>;
type OperationSettlement =
  | { readonly status: "fulfilled"; readonly value: unknown }
  | { readonly status: "rejected"; readonly error: unknown }
  | { readonly status: "unsettled" };

class StagedExecutionFailure {
  constructor(
    readonly stage: ExecutionStage,
    readonly cause: unknown,
    readonly semanticFailureFingerprint: string | null = null,
    readonly malformedProposal = false,
  ) {}
}

class MalformedProposalFailure {
  constructor(readonly cause: unknown) {}
}

class EquivalentSemanticFailure {
  constructor(readonly policy: TrustedRuntimeFailurePolicy) {}
}

const MUTATING_ACTIONS = new Set<SafeAgentToolName>(["navigate", "click", "type", "select", "pressKey"]);
const RECOVERABLE_ERROR_CODES = new Set([
  "provider_protocol_error",
  "unsafe_action_blocked",
  "stale_element_exhausted",
  "stale_element",
  "ambiguous_element",
]);
const RECOVERABLE_PORT_REJECTION_POLICY_CODES = new Set([
  "authentication_forbidden",
  "financial_action_forbidden",
  "messaging_or_publication_forbidden",
  "destructive_action_forbidden",
  "sensitive_control",
  "submit_activation_forbidden",
  "permission_forbidden",
  "popup_forbidden",
  "press_key_forbidden",
  "unobservable_effect",
  "unknown_effect",
  "native_tool_forbidden",
  "stale_observation",
]);
const MAX_SAFE_TOOL_FEEDBACK_BYTES = 2_048;
const MAX_TRACKED_SEMANTIC_FAILURES = 16;
const MAX_EQUIVALENT_FAILURE_COUNT = 99;
const POST_TIMEOUT_SETTLEMENT_GRACE_MS = 1_000;

function interfaceSource(tool: SafeAgentToolName): ToolInterfaceSource {
  if (tool === "invokeWebMcpReadOnly") return "page_webmcp";
  if (tool === "invokeConfiguredMcpReadOnly") return "configured_mcp";
  if (["navigate", "wait", "finish"].includes(tool)) return "orchestration";
  return "semantic_ui";
}

function isRejectedAdmission(admission: StoredAdmission): admission is RejectedAdmission {
  return "rejection" in admission;
}

function syntheticCompletionFailure(
  code: SafeErrorCode,
  category: ErrorCategory,
  phase: RunToolCompletionFailurePhase,
): RunToolCompletionFailureV1 {
  return { schemaVersion: 1, code, category, phase };
}

function completionFailureFromError(
  error: unknown,
  phase: RunToolCompletionFailurePhase,
): RunToolCompletionFailureV1 {
  const parsedSafe = isTraceGateError(error) ? SafeErrorSchema.safeParse(error.safe) : null;
  const safe = parsedSafe?.success ? parsedSafe.data : null;
  let closedPhase = phase;
  let browserPolicyDiagnostic: ReturnType<typeof browserPolicyDiagnosticFromFailureRecord> = null;
  if (phase === "runtime_dispatch" && safe !== null) {
    const failureRecord = FailureRecordSchema.safeParse(safe);
    if (
      failureRecord.success &&
      failureRecord.data.code === "unsafe_action_blocked" &&
      failureRecord.data.category === "policy" &&
      failureRecord.data.phase === "browser_policy"
    ) {
      closedPhase = "browser_policy";
      browserPolicyDiagnostic = browserPolicyDiagnosticFromFailureRecord(failureRecord.data);
    }
  }
  return {
    schemaVersion: 1,
    code: safe?.code ?? "unexpected_run_error",
    category: safe?.category ?? "unknown",
    phase: closedPhase,
    ...(browserPolicyDiagnostic === null ? {} : { browserPolicyDiagnostic }),
  };
}

function completionFailurePhase(
  stage: ExecutionStage | null,
  dispatchDisposition: "dispatched" | "rejected_before_dispatch",
): RunToolCompletionFailurePhase {
  if (stage === "pre_dispatch") return "pre_dispatch_validation";
  if (stage === "post_dispatch_validation") return "post_dispatch_validation";
  if (stage === "port_entered" || dispatchDisposition === "dispatched") return "runtime_dispatch";
  return "pre_dispatch_validation";
}

function feedbackReason(error: unknown, stage: ExecutionStage, malformedProposal = false): SafeToolErrorReason {
  if (malformedProposal) return "malformed_proposal";
  if (stage !== "pre_dispatch" || !isTraceGateError(error)) return "tool_failed";
  if (error.safe.code === "unsafe_action_blocked") return "policy_denied";
  if (["stale_element_exhausted", "stale_element", "ambiguous_element"].includes(error.safe.code)) return "stale_proposal";
  return "tool_failed";
}

function normalizedSemanticText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function semanticActionFailureFingerprint(
  action: SafeAgentAction,
  observation: UntrustedAgentObservation,
): string | null {
  if (!("ref" in action)) return null;
  const element = observation.elements.find((candidate) => candidate.ref === action.ref);
  if (element === undefined) return null;
  const actionInput = action.kind === "type"
    ? { text: action.text, clearFirst: action.clearFirst }
    : action.kind === "select"
      ? { value: action.value }
      : action.kind === "pressKey"
        ? { key: action.key }
        : {};
  const canonical = JSON.stringify({
    version: 1,
    page: observation.url,
    action: { kind: action.kind, input: actionInput },
    target: {
      role: normalizedSemanticText(element.role),
      name: normalizedSemanticText(element.name),
      disabled: element.disabled,
      checked: element.checked,
      selected: element.selected,
      expanded: element.expanded,
      attributes: Object.entries(element.attributes).sort(([left], [right]) => left.localeCompare(right)),
    },
  });
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

function safeToolErrorFeedback(
  reason: SafeToolErrorReason,
  resynchronized = false,
  runtimePolicy: TrustedRuntimeFailurePolicy | null = null,
): string {
  const message = runtimePolicy !== null
    ? runtimePolicy.equivalentFailureCount === 1
      ? "The semantic action entered the runtime and failed. A fresh browser surface was recovered; choose a different action or finish instead of retrying an equivalent target."
      : "An equivalent semantic action already failed after runtime recovery. This proposal was rejected before dispatch; choose a different action or finish."
    : reason === "policy_denied"
      ? "The proposal was denied before a safe result could be produced. Choose a different action from the current admitted tool surface."
    : reason === "stale_proposal"
      ? "The proposal no longer matched the current browser surface. Inspect the latest surface and choose another admitted action."
      : reason === "tool_unavailable"
        ? "The proposed tool is not available on the current strict tool surface. Choose one of the tools currently provided."
        : reason === "malformed_proposal"
          ? "The proposal was malformed or did not match the strict tool schema. Correct the arguments or choose another admitted action."
          : resynchronized
            ? "The action did not produce a valid safe result, but a fresh admitted-origin browser surface was recovered. Reconsider the task from that surface."
            : "The safe tool could not produce a valid bounded result. Choose another admitted action.";
  const serialized = JSON.stringify({
    schemaVersion: 2,
    trust: "untrusted_page_or_tool_content",
    kind: "safe_tool_error",
    error: {
      reason,
      recoverable: true,
      browserSurfaceResynchronized: resynchronized,
      message,
      ...(runtimePolicy === null ? {} : { runtimePolicy }),
    },
  });
  if (Buffer.byteLength(serialized, "utf8") > MAX_SAFE_TOOL_FEEDBACK_BYTES) {
    return '{"schemaVersion":2,"trust":"untrusted_page_or_tool_content","kind":"safe_tool_error","error":{"reason":"tool_failed","recoverable":true,"browserSurfaceResynchronized":false,"message":"The safe tool proposal was rejected."}}';
  }
  return serialized;
}

function isRecoverableError(error: unknown): boolean {
  return !isTraceGateError(error) || RECOVERABLE_ERROR_CODES.has(error.safe.code);
}

function canRecoverWithoutTargetUncertainty(stage: ExecutionStage, tool: SafeAgentToolName, error: unknown): boolean {
  if (stage === "pre_dispatch") return true;
  if (!isTraceGateError(error)) return false;
  if (stage !== "port_entered") return false;
  if (error.safe.phase === "agent.policy") return true;
  if ("policyCode" in error.safe && error.safe.policyCode !== null && RECOVERABLE_PORT_REJECTION_POLICY_CODES.has(error.safe.policyCode)) return true;
  return tool !== "navigate" && ["stale_element", "ambiguous_element"].includes(error.safe.code);
}

export class SerializedSafeToolExecutor implements AgentToolExecutor {
  readonly #tools: SafeAgentToolPort;
  readonly #ledger: BudgetLedger;
  readonly #policy: AgentPolicy;
  readonly #sink: AgentMilestoneSink;
  readonly #now: () => number;
  readonly #signal: AbortSignal;
  readonly #admissions = new Map<string, StoredAdmission>();
  readonly #completed = new Set<string>();
  readonly #started = new Set<string>();
  readonly #feedback = new Map<string, string>();
  readonly #semanticFailures = new Map<string, number>();
  #tail: Promise<void> = Promise.resolve();
  #observation: UntrustedAgentObservation;
  #surface: SafeAgentToolSurface | null = null;
  #finished: { completed: boolean; completionDisposition: AgentCompletionDisposition; summary: string } | null = null;
  #terminalUncertainty: ReturnType<typeof terminalError> | null = null;
  #successfulToolCalls = 0;
  #failedToolProposals = 0;
  #documentTransitions = 0;
  #policyRefusalProviderCallId: string | null = null;

  constructor(input: {
    tools: SafeAgentToolPort;
    ledger: BudgetLedger;
    policy: AgentPolicy;
    observation: UntrustedAgentObservation;
    signal: AbortSignal;
    sink: AgentMilestoneSink;
    now?: () => number;
  }) {
    this.#tools = input.tools;
    this.#ledger = input.ledger;
    this.#policy = input.policy;
    this.#observation = UntrustedAgentObservationSchema.parse(input.observation);
    this.#signal = input.signal;
    this.#sink = input.sink;
    this.#now = input.now ?? performance.now.bind(performance);
    this.#policy.assertObservation(this.#observation);
  }

  get observation(): UntrustedAgentObservation { return this.#observation; }
  get finishBelief(): { completed: boolean; completionDisposition: AgentCompletionDisposition; summary: string } | null { return this.#finished; }
  get documentTransitions(): number { return this.#documentTransitions; }

  progress(): {
    readonly successfulToolCalls: number;
    readonly failedToolProposals: number;
    readonly documentTransitions: number;
    readonly observationRevision: number;
  } {
    return {
      successfulToolCalls: this.#successfulToolCalls,
      failedToolProposals: this.#failedToolProposals,
      documentTransitions: this.#documentTransitions,
      observationRevision: this.#observation.revision,
    };
  }

  assertTargetEvidenceAvailable(): void {
    if (this.#terminalUncertainty) throw this.#terminalUncertainty;
  }

  async refreshSurface(signal: AbortSignal): Promise<SafeAgentToolSurface> {
    this.assertTargetEvidenceAvailable();
    const linked = AbortSignal.any([this.#signal, signal]);
    let surface: SafeAgentToolSurface;
    try {
      const rawSurface = await this.#tools.surface(this.#observation.revision, linked);
      throwIfAborted(linked, "agent.tools");
      surface = SafeAgentToolSurfaceSchema.parse(rawSurface);
    } catch (error) {
      if (isTraceGateError(error)) throw error;
      throw terminalError("target_evidence_lost", "Safe-tool surface failed contract validation", "agent.tools", { cause: error });
    }
    this.#policy.assertSurface(surface, this.#observation);
    if (!surface.tools.includes("finish")) {
      throw terminalError("provider_protocol_error", "Dynamic safe-tool surface omitted finish", "agent.tools");
    }
    this.#surface = surface;
    return surface;
  }

  admit(providerCallId: string, toolNameInput: string, rawArguments: string): ToolAdmission {
    this.assertTargetEvidenceAvailable();
    if (this.#admissions.has(providerCallId)) throw terminalError("provider_protocol_error", "Duplicate provider tool-call identifier", "agent.tool");
    const surface = this.#surface;
    if (surface === null) throw terminalError("provider_protocol_error", "Tool proposal arrived before capability refresh", "agent.tool");
    const ordinal = this.#ledger.admitTool(this.#signal);
    const normalizedId = ToolCallIdSchema.parse(`tool-${ordinal}`);
    const parsedName = SafeAgentToolNameSchema.safeParse(toolNameInput);
    const toolName = parsedName.success ? parsedName.data : null;
    let rejection: SafeToolErrorReason | null = null;
    let parsedArguments: unknown = null;
    if (Buffer.byteLength(rawArguments, "utf8") > 8_192) rejection = "malformed_proposal";
    else {
      try { parsedArguments = JSON.parse(rawArguments); }
      catch { rejection = "malformed_proposal"; }
    }
    if (toolName === null || !surface.tools.includes(toolName)) rejection = "tool_unavailable";
    if (rejection !== null) {
      const rejected: RejectedAdmission = { normalizedId, ordinal, providerCallId, toolName, admittedAt: this.#now(), rejection };
      this.#admissions.set(providerCallId, rejected);
      this.#feedback.set(providerCallId, safeToolErrorFeedback(rejection));
      return rejected;
    }
    if (toolName === null) throw terminalError("provider_protocol_error", "Rejected tool admission was not retained", "agent.tool");
    if (toolName === "finish" && parsedArguments !== null && typeof parsedArguments === "object" && !Array.isArray(parsedArguments)) {
      const declaration = parsedArguments as Record<string, unknown>;
      if (declaration.completed === false && declaration.completionDisposition === "policy_refused" &&
          typeof declaration.summary === "string" && declaration.summary.length <= 2_000) {
        this.#policyRefusalProviderCallId ??= providerCallId;
        this.#finished = {
          completed: false,
          completionDisposition: "policy_refused",
          summary: declaration.summary,
        };
      }
    }
    const admission: Admission = {
      normalizedId,
      ordinal,
      providerCallId,
      toolName,
      observationRevision: this.#observation.revision,
      rawArguments,
      admittedAt: this.#now(),
    };
    this.#admissions.set(providerCallId, admission);
    return admission;
  }

  safeToolFeedback(providerCallId: string): string | null {
    return this.#feedback.get(providerCallId) ?? null;
  }

  async failAdmitted(providerCallId: string, _error: unknown): Promise<void> {
    const admission = this.#requireAdmission(providerCallId);
    if (this.#completed.has(providerCallId)) return;
    const failure = syntheticCompletionFailure("provider_protocol_error", "model_provider", "proposal_admission");
    const run = () => this.#failAdmittedNow(admission, failure, "rejected_before_dispatch");
    const result = this.#tail.then(run, run);
    this.#tail = result.then(() => {}, () => {});
    return result;
  }

  async #failAdmittedNow(
    admission: StoredAdmission,
    failure: RunToolCompletionFailureV1,
    dispatchDisposition: "dispatched" | "rejected_before_dispatch",
    fallbackReason: SafeToolErrorReason = "malformed_proposal",
  ): Promise<void> {
    if (this.#completed.has(admission.providerCallId)) return;
    if (!this.#feedback.has(admission.providerCallId)) {
      this.#feedback.set(admission.providerCallId, safeToolErrorFeedback(fallbackReason));
    }
    await this.#emitStartedIfNeeded(admission, "proposal rejected before a safe tool result was available");
    this.#completed.add(admission.providerCallId);
    this.#failedToolProposals += 1;
    if (admission.toolName === null) return;
    await this.#emitCompleted(admission, {
      tool: admission.toolName,
      dispatchDisposition,
      success: false,
      failure,
      resultSummary: "Safe tool proposal was rejected or failed; bounded feedback was returned to the model.",
    });
  }

  execute(providerCallId: string, _proposal: unknown, providerSignal: AbortSignal): Promise<string> {
    const admission = this.#requireAdmission(providerCallId);
    if (this.#completed.has(providerCallId)) throw terminalError("provider_protocol_error", "Tool call was already completed", "agent.tool");
    const run = async () => {
      try {
        this.assertTargetEvidenceAvailable();
      } catch (error) {
        const failure = isRejectedAdmission(admission)
          ? syntheticCompletionFailure("provider_protocol_error", "model_provider", "proposal_admission")
          : completionFailureFromError(error, "pre_dispatch_validation");
        await this.#failAdmittedNow(admission, failure, "rejected_before_dispatch", "tool_failed");
        throw error;
      }
      if (isRejectedAdmission(admission)) {
        return this.#completeRecoverable(
          admission,
          admission.rejection,
          "rejected_before_dispatch",
          syntheticCompletionFailure("provider_protocol_error", "model_provider", "proposal_admission"),
        );
      }
      const parent = AbortSignal.any([this.#signal, providerSignal]);
      const originalDispatch: OriginalDispatchState = { disposition: "rejected_before_dispatch" };
      const inFlight: { operation: Promise<string> | null } = { operation: null };
      try {
        return await this.#ledger.withToolTimeout(
          (timeoutSignal) => {
            const operation = this.#executeNow(admission, AbortSignal.any([parent, timeoutSignal]), originalDispatch);
            inFlight.operation = operation;
            return operation;
          },
          parent,
        );
      } catch (caught) {
        const toolTimedOut = isTraceGateError(caught) && caught.safe.code === "budget_exhausted" && caught.safe.phase === "agent.tool";
        let settledFailure: unknown = caught;
        if (toolTimedOut && inFlight.operation !== null) {
          const settlement = await this.#awaitInFlightSettlement(inFlight.operation, parent);
          if (settlement?.status === "fulfilled" && typeof settlement.value === "string") return settlement.value;
          if (settlement?.status === "rejected" && MUTATING_ACTIONS.has(admission.toolName)) settledFailure = settlement.error;
          if (settlement?.status === "unsettled") {
            const dispatchDisposition = originalDispatch.disposition;
            const completionFailure = completionFailureFromError(caught, completionFailurePhase(null, dispatchDisposition));
            const terminalFailure = dispatchDisposition === "dispatched"
              ? this.#loseTargetEvidence(caught)
              : caught;
            await this.#failAdmittedNow(admission, completionFailure, dispatchDisposition, "tool_failed");
            throw terminalFailure;
          }
        }
        const staged = settledFailure instanceof StagedExecutionFailure ? settledFailure : null;
        const error = toolTimedOut && staged?.stage === "pre_dispatch" ? caught : staged?.cause ?? settledFailure;
        const dispatchDisposition = originalDispatch.disposition;
        const completionFailure = toolTimedOut
          ? completionFailureFromError(caught, completionFailurePhase(null, dispatchDisposition))
          : staged?.cause instanceof EquivalentSemanticFailure
            ? syntheticCompletionFailure("stale_element_exhausted", "tool_error", "pre_dispatch_validation")
            : staged?.malformedProposal
              ? syntheticCompletionFailure("provider_protocol_error", "model_provider", "pre_dispatch_validation")
              : completionFailureFromError(error, completionFailurePhase(staged?.stage ?? null, dispatchDisposition));
        if (parent.aborted || (!toolTimedOut && isTraceGateError(error) && error.safe.code === "operation_aborted")) {
          await this.#failAdmittedNow(admission, completionFailure, dispatchDisposition, "tool_failed");
          throw error;
        }
        if (staged?.cause instanceof EquivalentSemanticFailure) {
          return this.#completeRecoverable(admission, "tool_failed", dispatchDisposition, completionFailure, false, staged.cause.policy);
        }
        if (staged?.stage === "pre_dispatch") {
          const reason = feedbackReason(error, "pre_dispatch", staged.malformedProposal);
          if (isRecoverableError(error)) return this.#completeRecoverable(admission, reason, dispatchDisposition, completionFailure);
          await this.#failAdmittedNow(admission, completionFailure, dispatchDisposition, reason);
          throw error;
        }
        if (!MUTATING_ACTIONS.has(admission.toolName)) {
          if (isRecoverableError(error)) return this.#completeRecoverable(admission, "tool_failed", dispatchDisposition, completionFailure);
          await this.#failAdmittedNow(admission, completionFailure, dispatchDisposition, "tool_failed");
          throw error;
        }
        if (staged && canRecoverWithoutTargetUncertainty(staged.stage, admission.toolName, error)) {
          const reason = feedbackReason(error, "pre_dispatch");
          if (reason === "stale_proposal") {
            const resynchronized = await this.#tryResynchronize(admission, parent);
            return this.#completeRecoverable(admission, "stale_proposal", dispatchDisposition, completionFailure, resynchronized);
          }
          return this.#completeRecoverable(admission, reason, dispatchDisposition, completionFailure);
        }
        const resynchronized = await this.#tryResynchronize(admission, parent);
        if (resynchronized) {
          const runtimePolicy = staged?.semanticFailureFingerprint
            ? this.#recordEquivalentFailure(staged.semanticFailureFingerprint)
            : null;
          return this.#completeRecoverable(admission, "tool_failed", dispatchDisposition, completionFailure, true, runtimePolicy);
        }
        const terminalFailure = this.#loseTargetEvidence(error);
        await this.#failAdmittedNow(admission, completionFailure, dispatchDisposition, "tool_failed");
        throw terminalFailure;
      }
    };
    const result = this.#tail.then(run, run);
    this.#tail = result.then(() => {}, () => {});
    return result;
  }

  async #executeNow(
    admission: Admission,
    linked: AbortSignal,
    originalDispatch: OriginalDispatchState,
  ): Promise<string> {
    let action: SafeAgentAction;
    let surface: SafeAgentToolSurface;
    let completionDisposition: AgentCompletionDisposition | null = null;
    try {
      if (this.#finished && admission.providerCallId !== this.#policyRefusalProviderCallId) {
        throw terminalError("provider_protocol_error", "Tool proposal arrived after finish", "agent.tool");
      }
      surface = await this.refreshSurface(linked);
      const argumentsValue = JSON.parse(admission.rawArguments) as unknown;
      const rawArguments = argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue)
        ? { ...argumentsValue as Record<string, unknown> }
        : {};
      if (admission.toolName === "finish") {
        const parsedDisposition = AgentCompletionDispositionSchema.safeParse(rawArguments.completionDisposition);
        if (!parsedDisposition.success || typeof rawArguments.completed !== "boolean" ||
            ((parsedDisposition.data === "completed") !== rawArguments.completed)) {
          throw new MalformedProposalFailure(terminalError("provider_protocol_error", "Finish requires a matching explicit completion disposition", "agent.tool"));
        }
        completionDisposition = parsedDisposition.data;
        delete rawArguments.completionDisposition;
      }
      const actionCandidate = SafeAgentActionSchema.safeParse({
        ...rawArguments,
        kind: admission.toolName,
        toolCallId: admission.normalizedId,
        observationRevision: admission.observationRevision,
      });
      if (!actionCandidate.success) {
        throw new MalformedProposalFailure(terminalError("provider_protocol_error", "Tool arguments do not match the admitted schema", "agent.tool"));
      }
      action = actionCandidate.data;
      if (action.kind !== admission.toolName) {
        throw new MalformedProposalFailure(terminalError("provider_protocol_error", "Tool identity changed after admission", "agent.tool"));
      }
      this.#policy.assertAction(action, this.#observation, surface);
      if (action.kind === "finish" && completionDisposition === "policy_refused") {
        this.#finished = { completed: false, completionDisposition, summary: action.summary };
      }
      const fingerprint = semanticActionFailureFingerprint(action, this.#observation);
      if (fingerprint !== null) {
        const previousFailureCount = this.#semanticFailures.get(fingerprint);
        if (previousFailureCount !== undefined) {
          throw new EquivalentSemanticFailure(this.#recordEquivalentFailure(fingerprint));
        }
      }
      await this.#emitStartedIfNeeded(admission, `validated ${action.kind} proposal at observation revision ${action.observationRevision}`);
      if (action.kind !== "finish") this.#ledger.startBrowserAction(linked);
    } catch (error) {
      const malformed = error instanceof MalformedProposalFailure;
      throw new StagedExecutionFailure("pre_dispatch", malformed ? error.cause : error, null, malformed);
    }

    const semanticFailureFingerprint = semanticActionFailureFingerprint(action, this.#observation);
    const previousDocumentLocation = this.#documentLocation(this.#observation.url);
    let rawResult: unknown;
    try {
      originalDispatch.disposition = "dispatched";
      rawResult = await this.#tools.execute(action, linked);
      throwIfAborted(linked, "agent.tool");
    } catch (error) {
      throw new StagedExecutionFailure("port_entered", error, semanticFailureFingerprint);
    }

    let result;
    try {
      result = SafeAgentToolResultSchema.parse(rawResult);
      SafeAgentToolExchangeSchema.parse({ action, result });
      if (result.decision.decision === "allow" && MUTATING_ACTIONS.has(action.kind) &&
          (result.observation === null || result.observation.revision <= action.observationRevision)) {
        throw terminalError("target_evidence_lost", "State-changing tool did not return a fresh observation", "agent.tool");
      }
      if (result.observation !== null) {
        const observation = UntrustedAgentObservationSchema.parse(result.observation);
        this.#policy.assertObservation(observation);
        this.#observation = observation;
        if (action.kind === "navigate" || this.#documentLocation(observation.url) !== previousDocumentLocation) {
          this.#documentTransitions += 1;
        }
      }
      if (action.kind === "finish" && (result.tool !== "finish" || result.finishedBelief !== action.completed)) {
        throw terminalError("target_evidence_lost", "Finish result did not preserve the explicit completion declaration", "agent.tool");
      }
    } catch (error) {
      throw new StagedExecutionFailure("post_dispatch_validation", error, semanticFailureFingerprint);
    }

    if (result.decision.decision === "deny") {
      return this.#completeRecoverable(
        admission,
        "policy_denied",
        "dispatched",
        syntheticCompletionFailure("unsafe_action_blocked", "policy", "runtime_dispatch"),
      );
    }
    if (result.tool === "finish" && result.finishedBelief !== null) {
      if (completionDisposition === null) {
        throw new StagedExecutionFailure("post_dispatch_validation", terminalError("provider_protocol_error", "Finish disposition was lost after validation", "agent.tool"));
      }
      this.#finished = { completed: result.finishedBelief, completionDisposition, summary: result.summary };
    }
    this.#successfulToolCalls += 1;
    this.#completed.add(admission.providerCallId);
    await this.#emitCompleted(admission, {
      tool: action.kind,
      dispatchDisposition: "dispatched",
      success: true,
      resultSummary: String(redactJson(result.summary, { maxStringLength: 2_000 })),
    });
    return JSON.stringify({ schemaVersion: 2, trust: "untrusted_page_or_tool_content", kind: "safe_tool_result", result });
  }

  async #awaitInFlightSettlement(operation: Promise<unknown>, parent: AbortSignal): Promise<OperationSettlement | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: OperationSettlement | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        parent.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = () => finish(null);
      operation.then(
        (value) => finish({ status: "fulfilled", value }),
        (error) => finish({ status: "rejected", error }),
      );
      const timer = setTimeout(() => finish({ status: "unsettled" }), POST_TIMEOUT_SETTLEMENT_GRACE_MS);
      parent.addEventListener("abort", onAbort, { once: true });
      if (parent.aborted) onAbort();
    });
  }

  async #tryResynchronize(admission: Admission, parent: AbortSignal): Promise<boolean> {
    if (parent.aborted) return false;
    const inFlight: { operation: Promise<boolean> | null } = { operation: null };
    try {
      return await this.#ledger.withToolTimeout((timeoutSignal) => {
        const operation = (async () => {
          const linked = AbortSignal.any([parent, timeoutSignal]);
          this.#ledger.startBrowserAction(linked);
          const action = SafeAgentActionSchema.parse({
            kind: "inspect",
            toolCallId: admission.normalizedId,
            observationRevision: this.#observation.revision,
          });
          const rawResult = await this.#tools.execute(action, linked);
          throwIfAborted(linked, "agent.tool");
          const result = SafeAgentToolResultSchema.parse(rawResult);
          SafeAgentToolExchangeSchema.parse({ action, result });
          if (result.tool !== "inspect" || result.decision.decision !== "allow" || result.observation === null ||
              result.observation.revision <= this.#observation.revision) return false;
          const observation = UntrustedAgentObservationSchema.parse(result.observation);
          this.#policy.assertObservation(observation);
          this.#observation = observation;
          this.#surface = null;
          return true;
        })();
        inFlight.operation = operation;
        return operation;
      }, parent);
    } catch {
      if (inFlight.operation !== null) await this.#awaitInFlightSettlement(inFlight.operation, parent);
      return false;
    }
  }

  #documentLocation(url: string): string {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  }

  #recordEquivalentFailure(fingerprint: string): TrustedRuntimeFailurePolicy {
    const count = Math.min(MAX_EQUIVALENT_FAILURE_COUNT, (this.#semanticFailures.get(fingerprint) ?? 0) + 1);
    this.#semanticFailures.delete(fingerprint);
    if (this.#semanticFailures.size >= MAX_TRACKED_SEMANTIC_FAILURES) {
      const oldest = this.#semanticFailures.keys().next().value as string | undefined;
      if (oldest !== undefined) this.#semanticFailures.delete(oldest);
    }
    this.#semanticFailures.set(fingerprint, count);
    return {
      trust: "trusted_agent_runtime",
      equivalentFailureCount: count,
      retryAllowed: false,
      requiredAdaptation: true,
    };
  }

  async #completeRecoverable(
    admission: StoredAdmission,
    reason: SafeToolErrorReason,
    dispatchDisposition: "dispatched" | "rejected_before_dispatch",
    failure: RunToolCompletionFailureV1,
    resynchronized = false,
    runtimePolicy: TrustedRuntimeFailurePolicy | null = null,
  ): Promise<string> {
    const feedback = safeToolErrorFeedback(reason, resynchronized, runtimePolicy);
    this.#feedback.set(admission.providerCallId, feedback);
    await this.#failAdmittedNow(admission, failure, dispatchDisposition);
    return feedback;
  }

  async #emitCompleted(admission: StoredAdmission, completion: FailureAwareCompletion): Promise<void> {
    const event = FailureAwareRunToolCompletedEventSchema.parse({
      type: "run.tool.completed",
      payload: {
        toolCallId: ToolCallIdSchema.parse(admission.normalizedId),
        tool: completion.tool,
        interfaceSource: interfaceSource(completion.tool),
        interfaceMode: this.#policy.interfaceMode,
        dispatchDisposition: completion.dispatchDisposition,
        success: completion.success,
        ...(completion.success ? {} : { failure: completion.failure }),
        durationMs: Math.max(0, Math.floor(this.#now() - admission.admittedAt)),
        resultSummary: completion.resultSummary,
      },
    });
    await emitMilestone(this.#sink, event);
  }

  async #emitStartedIfNeeded(admission: StoredAdmission, argumentSummary: string): Promise<void> {
    if (admission.toolName === null || this.#started.has(admission.providerCallId)) return;
    this.#started.add(admission.providerCallId);
    await emitMilestone(this.#sink, {
      type: "run.tool.started",
      payload: {
        toolCallId: ToolCallIdSchema.parse(admission.normalizedId),
        tool: admission.toolName,
        interfaceSource: interfaceSource(admission.toolName),
        interfaceMode: this.#policy.interfaceMode,
        argumentSummary,
      },
    });
  }

  #loseTargetEvidence(cause: unknown): ReturnType<typeof terminalError> {
    if (this.#terminalUncertainty) return this.#terminalUncertainty;
    this.#terminalUncertainty = isTraceGateError(cause) && cause.safe.code === "target_evidence_lost"
      ? cause
      : terminalError("target_evidence_lost", "A dispatched state-changing tool failed and fresh admitted-origin evidence could not be re-established", "agent.tool", { cause });
    return this.#terminalUncertainty;
  }

  #requireAdmission(providerCallId: string): StoredAdmission {
    const admission = this.#admissions.get(providerCallId);
    if (!admission) throw terminalError("provider_protocol_error", "Tool execution was not admitted", "agent.tool");
    return admission;
  }
}
