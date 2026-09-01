import {
  SafeAgentActionSchema,
  SafeAgentToolExchangeSchema,
  SafeAgentToolNameSchema,
  SafeAgentToolResultSchema,
  SafeAgentToolSurfaceSchema,
  ToolCallIdSchema,
  UntrustedAgentObservationSchema,
  isTraceGateError,
  redactJson,
  type SafeAgentAction,
  type SafeAgentToolName,
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

interface RejectedAdmission extends ToolAdmission {
  readonly providerCallId: string;
  readonly toolName: SafeAgentToolName | null;
  readonly admittedAt: number;
  readonly rejection: SafeToolErrorReason;
}

type StoredAdmission = Admission | RejectedAdmission;
type ExecutionStage = "pre_dispatch" | "port_entered" | "post_dispatch_validation";
type OperationSettlement =
  | { readonly status: "fulfilled"; readonly value: unknown }
  | { readonly status: "rejected"; readonly error: unknown };

class StagedExecutionFailure {
  constructor(
    readonly stage: ExecutionStage,
    readonly cause: unknown,
  ) {}
}

const MUTATING_ACTIONS = new Set<SafeAgentToolName>(["navigate", "click", "type", "select", "pressKey"]);
const RECOVERABLE_ERROR_CODES = new Set([
  "provider_protocol_error",
  "unsafe_action_blocked",
  "stale_element_exhausted",
  "stale_element",
  "ambiguous_element",
]);
const PRE_DISPATCH_POLICY_CODES = new Set([
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

function interfaceSource(tool: SafeAgentToolName): ToolInterfaceSource {
  if (tool === "invokeWebMcpReadOnly") return "page_webmcp";
  if (tool === "invokeConfiguredMcpReadOnly") return "configured_mcp";
  if (["navigate", "wait", "finish"].includes(tool)) return "orchestration";
  return "semantic_ui";
}

function isRejectedAdmission(admission: StoredAdmission): admission is RejectedAdmission {
  return "rejection" in admission;
}

function feedbackReason(error: unknown): SafeToolErrorReason {
  if (!isTraceGateError(error)) return "malformed_proposal";
  if (error.safe.code === "unsafe_action_blocked") return "policy_denied";
  if (["stale_element_exhausted", "stale_element", "ambiguous_element"].includes(error.safe.code)) return "stale_proposal";
  if (error.safe.code === "provider_protocol_error") return "malformed_proposal";
  return "tool_failed";
}

function safeToolErrorFeedback(reason: SafeToolErrorReason, resynchronized = false): string {
  const message = reason === "policy_denied"
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
    error: { reason, recoverable: true, browserSurfaceResynchronized: resynchronized, message },
  });
  if (Buffer.byteLength(serialized, "utf8") > MAX_SAFE_TOOL_FEEDBACK_BYTES) {
    return '{"schemaVersion":2,"trust":"untrusted_page_or_tool_content","kind":"safe_tool_error","error":{"reason":"tool_failed","recoverable":true,"browserSurfaceResynchronized":false,"message":"The safe tool proposal was rejected."}}';
  }
  return serialized;
}

function isRecoverableError(error: unknown): boolean {
  return !isTraceGateError(error) || RECOVERABLE_ERROR_CODES.has(error.safe.code);
}

function definitelyNotDispatched(stage: ExecutionStage, tool: SafeAgentToolName, error: unknown): boolean {
  if (stage === "pre_dispatch") return true;
  if (!isTraceGateError(error)) return false;
  if (stage !== "port_entered") return false;
  if (error.safe.phase === "agent.policy") return true;
  if ("policyCode" in error.safe && error.safe.policyCode !== null && PRE_DISPATCH_POLICY_CODES.has(error.safe.policyCode)) return true;
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
  #tail: Promise<void> = Promise.resolve();
  #observation: UntrustedAgentObservation;
  #surface: SafeAgentToolSurface | null = null;
  #finished: { completed: boolean; summary: string } | null = null;
  #terminalUncertainty: ReturnType<typeof terminalError> | null = null;

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
  get finishBelief(): { completed: boolean; summary: string } | null { return this.#finished; }

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
    if (Buffer.byteLength(rawArguments, "utf8") > 8_192) rejection = "malformed_proposal";
    else {
      try { JSON.parse(rawArguments); }
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

  async failAdmitted(providerCallId: string, error: unknown): Promise<void> {
    const admission = this.#requireAdmission(providerCallId);
    if (this.#completed.has(providerCallId)) return;
    const run = () => this.#failAdmittedNow(admission, error);
    const result = this.#tail.then(run, run);
    this.#tail = result.then(() => {}, () => {});
    return result;
  }

  async #failAdmittedNow(admission: StoredAdmission, error: unknown): Promise<void> {
    if (this.#completed.has(admission.providerCallId)) return;
    if (!this.#feedback.has(admission.providerCallId)) {
      this.#feedback.set(admission.providerCallId, safeToolErrorFeedback(feedbackReason(error)));
    }
    await this.#emitStartedIfNeeded(admission, "proposal rejected before a safe tool result was available");
    this.#completed.add(admission.providerCallId);
    if (admission.toolName === null) return;
    await emitMilestone(this.#sink, {
      type: "run.tool.completed",
      payload: {
        toolCallId: ToolCallIdSchema.parse(admission.normalizedId),
        tool: admission.toolName,
        interfaceSource: interfaceSource(admission.toolName),
        interfaceMode: this.#policy.interfaceMode,
        success: false,
        durationMs: Math.max(0, Math.floor(this.#now() - admission.admittedAt)),
        resultSummary: "Safe tool proposal was rejected or failed; bounded feedback was returned to the model.",
      },
    });
  }

  execute(providerCallId: string, _proposal: unknown, providerSignal: AbortSignal): Promise<string> {
    const admission = this.#requireAdmission(providerCallId);
    if (this.#completed.has(providerCallId)) throw terminalError("provider_protocol_error", "Tool call was already completed", "agent.tool");
    const run = async () => {
      this.assertTargetEvidenceAvailable();
      if (isRejectedAdmission(admission)) return this.#completeRecoverable(admission, admission.rejection);
      const parent = AbortSignal.any([this.#signal, providerSignal]);
      const inFlight: { operation: Promise<string> | null } = { operation: null };
      try {
        return await this.#ledger.withToolTimeout(
          (timeoutSignal) => {
            const operation = this.#executeNow(admission, AbortSignal.any([parent, timeoutSignal]));
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
        }
        const staged = settledFailure instanceof StagedExecutionFailure ? settledFailure : null;
        const error = toolTimedOut && staged?.stage === "pre_dispatch" ? caught : staged?.cause ?? settledFailure;
        if (parent.aborted || (!toolTimedOut && isTraceGateError(error) && error.safe.code === "operation_aborted")) {
          await this.#failAdmittedNow(admission, error);
          throw error;
        }
        if (staged?.stage === "pre_dispatch") {
          if (isRecoverableError(error)) return this.#completeRecoverable(admission, feedbackReason(error));
          await this.#failAdmittedNow(admission, error);
          throw error;
        }
        if (!MUTATING_ACTIONS.has(admission.toolName)) {
          if (isRecoverableError(error)) return this.#completeRecoverable(admission, feedbackReason(error));
          await this.#failAdmittedNow(admission, error);
          throw error;
        }
        if (staged && definitelyNotDispatched(staged.stage, admission.toolName, error)) {
          if (feedbackReason(error) === "stale_proposal") {
            const resynchronized = await this.#tryResynchronize(admission, parent);
            return this.#completeRecoverable(admission, "stale_proposal", resynchronized);
          }
          return this.#completeRecoverable(admission, feedbackReason(error));
        }
        const resynchronized = await this.#tryResynchronize(admission, parent);
        if (resynchronized) return this.#completeRecoverable(admission, feedbackReason(error), true);
        const failure = this.#loseTargetEvidence(error);
        await this.#failAdmittedNow(admission, failure);
        throw failure;
      }
    };
    const result = this.#tail.then(run, run);
    this.#tail = result.then(() => {}, () => {});
    return result;
  }

  async #executeNow(admission: Admission, linked: AbortSignal): Promise<string> {
    let action: SafeAgentAction;
    let surface: SafeAgentToolSurface;
    try {
      if (this.#finished) throw terminalError("provider_protocol_error", "Tool proposal arrived after finish", "agent.tool");
      surface = await this.refreshSurface(linked);
      const argumentsValue = JSON.parse(admission.rawArguments) as unknown;
      const actionCandidate = SafeAgentActionSchema.safeParse({
        ...(argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue) ? argumentsValue : {}),
        kind: admission.toolName,
        toolCallId: admission.normalizedId,
        observationRevision: admission.observationRevision,
      });
      if (!actionCandidate.success) throw terminalError("provider_protocol_error", "Tool arguments do not match the admitted schema", "agent.tool");
      action = actionCandidate.data;
      if (action.kind !== admission.toolName) throw terminalError("provider_protocol_error", "Tool identity changed after admission", "agent.tool");
      this.#policy.assertAction(action, this.#observation, surface);
      await this.#emitStartedIfNeeded(admission, `validated ${action.kind} proposal at observation revision ${action.observationRevision}`);
      if (action.kind !== "finish") this.#ledger.startBrowserAction(linked);
    } catch (error) {
      throw new StagedExecutionFailure("pre_dispatch", error);
    }

    let rawResult: unknown;
    try {
      rawResult = await this.#tools.execute(action, linked);
      throwIfAborted(linked, "agent.tool");
    } catch (error) {
      throw new StagedExecutionFailure("port_entered", error);
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
      }
    } catch (error) {
      throw new StagedExecutionFailure("post_dispatch_validation", error);
    }

    if (result.decision.decision === "deny") {
      return this.#completeRecoverable(admission, "policy_denied");
    }
    if (result.tool === "finish" && result.finishedBelief !== null) {
      this.#finished = { completed: result.finishedBelief, summary: result.summary };
    }
    this.#completed.add(admission.providerCallId);
    await emitMilestone(this.#sink, {
      type: "run.tool.completed",
      payload: {
        toolCallId: ToolCallIdSchema.parse(admission.normalizedId),
        tool: action.kind,
        interfaceSource: interfaceSource(action.kind),
        interfaceMode: this.#policy.interfaceMode,
        success: result.decision.decision === "allow",
        durationMs: Math.max(0, Math.floor(this.#now() - admission.admittedAt)),
        resultSummary: String(redactJson(result.summary, { maxStringLength: 2_000 })),
      },
    });
    return JSON.stringify({ schemaVersion: 2, trust: "untrusted_page_or_tool_content", kind: "safe_tool_result", result });
  }

  async #awaitInFlightSettlement(operation: Promise<unknown>, parent: AbortSignal): Promise<OperationSettlement | null> {
    if (parent.aborted) return null;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: OperationSettlement | null) => {
        if (settled) return;
        settled = true;
        parent.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = () => finish(null);
      parent.addEventListener("abort", onAbort, { once: true });
      if (parent.aborted) onAbort();
      operation.then(
        (value) => finish({ status: "fulfilled", value }),
        (error) => finish({ status: "rejected", error }),
      );
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

  async #completeRecoverable(
    admission: StoredAdmission,
    reason: SafeToolErrorReason,
    resynchronized = false,
  ): Promise<string> {
    const feedback = safeToolErrorFeedback(reason, resynchronized);
    this.#feedback.set(admission.providerCallId, feedback);
    await this.#failAdmittedNow(admission, new Error("recoverable safe-tool rejection"));
    return feedback;
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
