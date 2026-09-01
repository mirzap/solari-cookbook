import type {
  PublicCapabilitySummary,
  SafeAgentAction,
  SafeAgentToolSurface,
  UntrustedAgentObservation,
  WebMcpInputProperty,
  WebMcpToolDescriptorV1,
} from "@tracegate/shared";
import { terminalError } from "./errors.ts";

function webMcpValueMatches(value: string | number | boolean | null, property: WebMcpInputProperty): boolean {
  if (property.type === "string") {
    return typeof value === "string" &&
      (property.enum === undefined || property.enum.includes(value)) &&
      (property.minLength === undefined || value.length >= property.minLength) &&
      (property.maxLength === undefined || value.length <= property.maxLength);
  }
  if (property.type === "boolean") return typeof value === "boolean";
  return typeof value === "number" && Number.isFinite(value) &&
    (property.type !== "integer" || Number.isInteger(value)) &&
    (property.minimum === undefined || value >= property.minimum) &&
    (property.maximum === undefined || value <= property.maximum);
}

function assertWebMcpInput(input: Readonly<Record<string, string | number | boolean | null>>, descriptor: WebMcpToolDescriptorV1): void {
  for (const required of descriptor.inputSchema.required) {
    if (!Object.hasOwn(input, required)) throw terminalError("unsafe_action_blocked", "WebMCP input omitted a required admitted field", "agent.policy", { policyCode: "unknown_effect" });
  }
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(descriptor.inputSchema.properties, key)) {
      throw terminalError("unsafe_action_blocked", "WebMCP input does not match the closed admitted schema", "agent.policy", { policyCode: "unknown_effect" });
    }
    const property = descriptor.inputSchema.properties[key]!;
    if (!webMcpValueMatches(value, property)) {
      throw terminalError("unsafe_action_blocked", "WebMCP input does not match the closed admitted schema", "agent.policy", { policyCode: "unknown_effect" });
    }
  }
}

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
    const currentOrigin = new URL(observation.url).origin;
    for (const descriptor of surface.webMcpTools) {
      if (descriptor.currentOrigin !== currentOrigin) {
        throw terminalError("unsafe_action_blocked", "Runtime exposed a WebMCP descriptor outside the current origin", "agent.policy", { policyCode: "origin_not_admitted" });
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
      assertWebMcpInput(action.input, descriptor);
    }
    if ("ref" in action) {
      const revision = Number(action.ref.split(":")[1]);
      if (revision !== observation.revision || !observation.elements.some((element) => element.ref === action.ref)) {
        throw terminalError("stale_element_exhausted", "Element reference is stale or unknown", "agent.policy");
      }
    }
  }
}
