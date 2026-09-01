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

const MUTATING_ACTIONS = new Set<SafeAgentToolName>(["navigate", "click", "type", "select", "pressKey"]);

export class SerializedSafeToolExecutor implements AgentToolExecutor {
  readonly #tools: SafeAgentToolPort;
  readonly #ledger: BudgetLedger;
  readonly #policy: AgentPolicy;
  readonly #sink: AgentMilestoneSink;
  readonly #now: () => number;
  readonly #signal: AbortSignal;
  readonly #admissions = new Map<string, Admission>();
  readonly #completed = new Set<string>();
  #tail: Promise<void> = Promise.resolve();
  #observation: UntrustedAgentObservation;
  #surface: SafeAgentToolSurface | null = null;
  #finished: { completed: boolean; summary: string } | null = null;
  #terminalUncertainty = false;

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

  async refreshSurface(signal: AbortSignal): Promise<SafeAgentToolSurface> {
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
    if (this.#terminalUncertainty) throw terminalError("target_evidence_lost", "A prior timed-out tool left browser state uncertain", "agent.tool");
    if (this.#admissions.has(providerCallId)) throw terminalError("provider_protocol_error", "Duplicate provider tool-call identifier", "agent.tool");
    if (Buffer.byteLength(rawArguments, "utf8") > 8_192) throw terminalError("provider_protocol_error", "Tool arguments exceed protocol bound", "agent.tool");
    const surface = this.#surface;
    if (surface === null) throw terminalError("provider_protocol_error", "Tool proposal arrived before capability refresh", "agent.tool");
    const ordinal = this.#ledger.admitTool(this.#signal);
    const toolName = SafeAgentToolNameSchema.parse(toolNameInput);
    if (!surface.tools.includes(toolName)) throw terminalError("provider_protocol_error", "Provider proposed an unavailable tool", "agent.tool");
    const admission: Admission = {
      normalizedId: ToolCallIdSchema.parse(`tool-${ordinal}`),
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

  async failAdmitted(providerCallId: string, error: unknown): Promise<void> {
    const admission = this.#requireAdmission(providerCallId);
    if (this.#completed.has(providerCallId)) return;
    this.#completed.add(providerCallId);
    const resultSummary = isTraceGateError(error) ? error.safe.message : "Safe tool failed or returned an invalid bounded result";
    await emitMilestone(this.#sink, {
      type: "run.tool.completed",
      payload: {
        toolCallId: ToolCallIdSchema.parse(admission.normalizedId),
        tool: admission.toolName,
        success: false,
        durationMs: Math.max(0, Math.floor(this.#now() - admission.admittedAt)),
        resultSummary: String(redactJson(resultSummary, { maxStringLength: 2_000 })),
      },
    });
  }

  execute(providerCallId: string, proposal: unknown, providerSignal: AbortSignal): Promise<string> {
    const admission = this.#requireAdmission(providerCallId);
    if (this.#completed.has(providerCallId)) throw terminalError("provider_protocol_error", "Tool call was already completed", "agent.tool");
    const run = async () => {
      if (this.#terminalUncertainty) throw terminalError("target_evidence_lost", "A prior timed-out tool left browser state uncertain", "agent.tool");
      const parent = AbortSignal.any([this.#signal, providerSignal]);
      try {
        return await this.#ledger.withToolTimeout(
          (timeoutSignal) => this.#executeNow(admission, proposal, AbortSignal.any([parent, timeoutSignal])),
          parent,
        );
      } catch (error) {
        if (isTraceGateError(error) && error.safe.code === "budget_exhausted" && error.safe.phase === "agent.tool") {
          this.#terminalUncertainty = true;
        }
        await this.failAdmitted(admission.providerCallId, error);
        throw error;
      }
    };
    const result = this.#tail.then(run, run);
    this.#tail = result.then(() => {}, () => {});
    return result;
  }

  async #executeNow(admission: Admission, _proposal: unknown, providerSignal: AbortSignal): Promise<string> {
    if (this.#finished) throw terminalError("provider_protocol_error", "Tool proposal arrived after finish", "agent.tool");
    const linked = AbortSignal.any([this.#signal, providerSignal]);
    const surface = await this.refreshSurface(linked);
    let argumentsValue: unknown;
    try { argumentsValue = JSON.parse(admission.rawArguments); }
    catch (error) { throw terminalError("provider_protocol_error", "Tool arguments are not valid JSON", "agent.tool", { cause: error }); }
    const actionCandidate = SafeAgentActionSchema.safeParse({
      ...(argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue) ? argumentsValue : {}),
      kind: admission.toolName,
      toolCallId: admission.normalizedId,
      observationRevision: admission.observationRevision,
    });
    if (!actionCandidate.success) throw terminalError("provider_protocol_error", "Tool arguments do not match the admitted schema", "agent.tool");
    const action = actionCandidate.data;
    if (action.kind !== admission.toolName) throw terminalError("provider_protocol_error", "Tool identity changed after admission", "agent.tool");
    this.#policy.assertAction(action, this.#observation, surface);
    await emitMilestone(this.#sink, {
      type: "run.tool.started",
      payload: {
        toolCallId: ToolCallIdSchema.parse(admission.normalizedId),
        tool: action.kind,
        argumentSummary: `validated ${action.kind} proposal at observation revision ${action.observationRevision}`,
      },
    });
    let dispatched = false;
    try {
      if (action.kind !== "finish") this.#ledger.startBrowserAction(linked);
      dispatched = true;
      const rawResult = await this.#tools.execute(action, linked);
      throwIfAborted(linked, "agent.tool");
      const result = SafeAgentToolResultSchema.parse(rawResult);
      SafeAgentToolExchangeSchema.parse({ action, result });
      if (result.decision.decision === "allow" && MUTATING_ACTIONS.has(action.kind) &&
          (result.observation === null || result.observation.revision <= action.observationRevision)) {
        throw terminalError("target_evidence_lost", "State-changing tool did not return a fresh observation", "agent.tool");
      }
      if (result.observation !== null) {
        this.#observation = UntrustedAgentObservationSchema.parse(result.observation);
        this.#policy.assertObservation(this.#observation);
      }
      if (result.tool === "finish" && result.decision.decision === "allow" && result.finishedBelief !== null) {
        this.#finished = { completed: result.finishedBelief, summary: result.summary };
      }
      this.#completed.add(admission.providerCallId);
      await emitMilestone(this.#sink, {
        type: "run.tool.completed",
        payload: {
          toolCallId: ToolCallIdSchema.parse(admission.normalizedId),
          tool: action.kind,
          success: result.decision.decision === "allow",
          durationMs: Math.max(0, Math.floor(this.#now() - admission.admittedAt)),
          resultSummary: String(redactJson(result.summary, { maxStringLength: 2_000 })),
        },
      });
      return JSON.stringify({ schemaVersion: 2, trust: "untrusted_page_or_tool_content", kind: "safe_tool_result", result });
    } catch (error) {
      await this.failAdmitted(admission.providerCallId, error);
      if (dispatched && MUTATING_ACTIONS.has(action.kind)) {
        this.#terminalUncertainty = true;
        if (isTraceGateError(error) && (error.safe.code === "operation_aborted" || error.safe.code === "target_evidence_lost")) throw error;
        throw terminalError("target_evidence_lost", "State-changing tool failed without trustworthy fresh evidence", "agent.tool", { cause: error });
      }
      if (isTraceGateError(error)) throw error;
      return JSON.stringify({ schemaVersion: 2, trust: "untrusted_page_or_tool_content", kind: "safe_tool_error", error: "Safe tool failed or returned an invalid bounded result" });
    }
  }

  #requireAdmission(providerCallId: string): Admission {
    const admission = this.#admissions.get(providerCallId);
    if (!admission) throw terminalError("provider_protocol_error", "Tool execution was not admitted", "agent.tool");
    return admission;
  }
}
