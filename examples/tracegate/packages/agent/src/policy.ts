import type {
  PublicCapabilitySummary,
  SafeAgentAction,
  SafeAgentToolSurface,
  UntrustedAgentObservation,
} from "@tracegate/shared";
import { terminalError } from "./errors.ts";

export class AgentPolicy {
  readonly #capabilities: PublicCapabilitySummary;

  constructor(capabilities: PublicCapabilitySummary) {
    this.#capabilities = capabilities;
  }

  assertObservation(observation: UntrustedAgentObservation): void {
    let origin: string;
    try { origin = new URL(observation.url).origin; }
    catch { throw terminalError("target_evidence_lost", "Browser returned an invalid URL", "agent.policy"); }
    if (!this.#capabilities.allowedNavigationOrigins.includes(origin as never)) {
      throw terminalError("unsafe_action_blocked", "Browser left the exact admitted origins", "agent.policy", { policyCode: "origin_not_admitted" });
    }
  }

  assertSurface(surface: SafeAgentToolSurface, observation: UntrustedAgentObservation): void {
    if (surface.observationRevision !== observation.revision) {
      throw terminalError("stale_element_exhausted", "Tool surface revision is stale", "agent.policy");
    }
    for (const tool of surface.tools) {
      if (!this.#capabilities.availableTools.includes(tool)) {
        throw terminalError("unsafe_action_blocked", "Runtime exposed a tool outside the admitted capability bound", "agent.policy", { policyCode: "unknown_effect" });
      }
    }
  }

  assertAction(action: SafeAgentAction, observation: UntrustedAgentObservation, surface: SafeAgentToolSurface): void {
    this.assertObservation(observation);
    this.assertSurface(surface, observation);
    if (action.observationRevision !== observation.revision) {
      throw terminalError("stale_element_exhausted", "Tool proposal observation revision is stale", "agent.policy");
    }
    if (!surface.tools.includes(action.kind)) {
      throw terminalError("unsafe_action_blocked", "Tool is not available at the current revision", "agent.policy", { policyCode: "unknown_effect" });
    }
    if (action.kind === "navigate") {
      const target = new URL(action.url);
      if (target.username || target.password || !this.#capabilities.allowedNavigationOrigins.includes(target.origin as never)) {
        throw terminalError("unsafe_action_blocked", "Navigation outside exact admitted origins is forbidden", "agent.policy", { policyCode: "origin_not_admitted" });
      }
    }
    if (action.kind === "invokeWebMcpReadOnly") {
      const descriptor = surface.webMcpTools.find((tool) => tool.id === action.toolId);
      const currentOrigin = new URL(observation.url).origin;
      if (descriptor === undefined) {
        throw terminalError("unsafe_action_blocked", "WebMCP tool is no longer admitted at the current revision", "agent.policy", { policyCode: "native_tool_forbidden" });
      }
      if (descriptor.currentOrigin !== currentOrigin) {
        throw terminalError("unsafe_action_blocked", "WebMCP tool origin does not match the current document", "agent.policy", { policyCode: "origin_not_admitted" });
      }
    }
    if ("ref" in action) {
      const revision = Number(action.ref.split(":")[1]);
      if (revision !== observation.revision || !observation.elements.some((element) => element.ref === action.ref)) {
        throw terminalError("stale_element_exhausted", "Element reference is stale or unknown", "agent.policy");
      }
    }
  }
}
