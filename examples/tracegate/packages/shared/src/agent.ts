import { z } from "zod";
import { InterfaceModeSchema, RuntimeBudgetsSchema, SafetyPolicyVersionSchema, type PublicEvaluationConfigV2 } from "./config.ts";
import { ElementRefSchema, ObservationRevisionSchema, ToolCallIdSchema } from "./ids.ts";
import { PublicHttpsOriginSchema, PublicHttpsUrlSchema } from "./targets.ts";
import { EffectDecisionSchema } from "./policy.ts";
import { RunWarningSchema } from "./errors.ts";
import {
  ConfiguredMcpEndpointIdSchema,
  ConfiguredMcpInvocationRequestSchema,
  ConfiguredMcpToolCatalogV1Schema,
  ConfiguredMcpToolIdSchema,
  InterfaceUsageSummarySchema,
  UntrustedConfiguredMcpResultV1Schema,
} from "./mcp.ts";
import {
  UntrustedWebMcpResultV1Schema,
  WebMcpInvocationInputSchema,
  WebMcpToolCatalogV1Schema,
  WebMcpToolIdSchema,
} from "./webmcp.ts";

const boundedText = z.string().max(4_000);

export const SafeAgentToolNameSchema = z.enum([
  "navigate",
  "inspect",
  "click",
  "type",
  "select",
  "pressKey",
  "scroll",
  "wait",
  "invokeWebMcpReadOnly",
  "invokeConfiguredMcpReadOnly",
  "finish",
]);

export const RestrictedKeySchema = z.enum([
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

const proposalBase = {
  toolCallId: ToolCallIdSchema,
  observationRevision: ObservationRevisionSchema,
};

export const SafeAgentActionSchema = z.discriminatedUnion("kind", [
  z.object({ ...proposalBase, kind: z.literal("navigate"), url: PublicHttpsUrlSchema }).strict(),
  z.object({ ...proposalBase, kind: z.literal("inspect") }).strict(),
  z.object({ ...proposalBase, kind: z.literal("click"), ref: ElementRefSchema }).strict(),
  z.object({ ...proposalBase, kind: z.literal("type"), ref: ElementRefSchema, text: boundedText, clearFirst: z.boolean().default(true) }).strict(),
  z.object({ ...proposalBase, kind: z.literal("select"), ref: ElementRefSchema, value: z.string().max(500) }).strict(),
  z.object({ ...proposalBase, kind: z.literal("pressKey"), ref: ElementRefSchema, key: RestrictedKeySchema }).strict(),
  z.object({ ...proposalBase, kind: z.literal("scroll"), direction: z.enum(["up", "down"]), amount: z.number().int().min(1).max(5_000) }).strict(),
  z.object({ ...proposalBase, kind: z.literal("wait"), durationMs: z.number().int().min(0).max(15_000) }).strict(),
  z.object({ ...proposalBase, kind: z.literal("invokeWebMcpReadOnly"), toolId: WebMcpToolIdSchema, input: WebMcpInvocationInputSchema }).strict(),
  z.object({
    ...proposalBase,
    kind: z.literal("invokeConfiguredMcpReadOnly"),
    endpointId: ConfiguredMcpEndpointIdSchema,
    toolId: ConfiguredMcpToolIdSchema,
    input: ConfiguredMcpInvocationRequestSchema.shape.input,
  }).strict(),
  z.object({ ...proposalBase, kind: z.literal("finish"), completed: z.boolean(), summary: z.string().max(2_000) }).strict(),
]);

export const CompactElementSchema = z.object({
  ref: ElementRefSchema,
  role: z.string().trim().min(1).max(100),
  name: z.string().max(500),
  disabled: z.boolean().nullable(),
  checked: z.boolean().nullable(),
  selected: z.boolean().nullable(),
  expanded: z.boolean().nullable(),
  attributes: z.record(z.string().max(100), z.string().max(500)).default({}),
}).strict();

export const UntrustedAgentObservationSchema = z.object({
  schemaVersion: z.literal(2),
  trust: z.literal("untrusted_page_content"),
  revision: ObservationRevisionSchema,
  url: PublicHttpsUrlSchema,
  title: z.string().max(500),
  visibleText: z.string().max(20_000),
  elements: z.array(CompactElementSchema).max(100),
  discoverySummary: z.string().max(2_000),
  truncated: z.boolean(),
}).strict().superRefine((value, context) => {
  for (const [index, element] of value.elements.entries()) {
    const revision = Number(element.ref.split(":")[1]);
    if (revision !== value.revision) context.addIssue({ code: "custom", path: ["elements", index, "ref"], message: "element ref revision must match observation" });
  }
});

// Compatibility alias remains explicitly untrusted in V2.
export const AgentObservationSchema = UntrustedAgentObservationSchema;

export const PublicCapabilitySummarySchema = z.object({
  startOrigin: PublicHttpsOriginSchema,
  allowedNavigationOrigins: z.array(PublicHttpsOriginSchema).min(1).max(3),
  availableTools: z.array(SafeAgentToolNameSchema).max(11),
  interfaceMode: InterfaceModeSchema,
  safetySummary: z.literal("anonymous public observable-state tasks only; unknown effects are denied"),
}).strict().superRefine((value, context) => {
  if (new Set(value.availableTools).size !== value.availableTools.length) context.addIssue({ code: "custom", path: ["availableTools"], message: "available tools must be unique" });
  if (!value.allowedNavigationOrigins.includes(value.startOrigin)) context.addIssue({ code: "custom", path: ["startOrigin"], message: "start origin must be admitted" });
});

export const AgentExecutionInputV2Schema = z.object({
  schemaVersion: z.literal(2),
  systemPolicyVersion: SafetyPolicyVersionSchema,
  userTask: z.string().trim().min(1).max(1_000),
  capabilities: PublicCapabilitySummarySchema,
  initialObservation: UntrustedAgentObservationSchema,
  budgets: RuntimeBudgetsSchema,
}).strict().superRefine((value, context) => {
  const observedOrigin = new URL(value.initialObservation.url).origin;
  if (!value.capabilities.allowedNavigationOrigins.includes(observedOrigin as z.infer<typeof PublicHttpsOriginSchema>)) {
    context.addIssue({ code: "custom", path: ["initialObservation", "url"], message: "initial observation origin must be admitted" });
  }
});

export const AgentPromptLayersV2Schema = z.object({
  fixedSystemPolicy: z.object({ version: SafetyPolicyVersionSchema, text: z.string().min(1).max(8_000) }).strict(),
  userTask: z.object({ trust: z.literal("untrusted_user_task"), text: z.string().min(1).max(1_000) }).strict(),
  capabilitySummary: PublicCapabilitySummarySchema,
  untrustedConversation: z.array(z.object({ trust: z.literal("untrusted_page_or_tool_content"), text: z.string().max(20_000) }).strict()).max(200),
}).strict();

export const SafeAgentToolSurfaceSchema = z.object({
  observationRevision: ObservationRevisionSchema,
  tools: z.array(SafeAgentToolNameSchema).max(11),
  webMcpTools: WebMcpToolCatalogV1Schema.default([]),
  configuredMcpTools: ConfiguredMcpToolCatalogV1Schema.default([]),
}).strict().superRefine((value, context) => {
  if (new Set(value.tools).size !== value.tools.length) context.addIssue({ code: "custom", path: ["tools"], message: "tool surface must not contain duplicates" });
  const hasInvocationTool = value.tools.includes("invokeWebMcpReadOnly");
  if (hasInvocationTool !== (value.webMcpTools.length > 0)) {
    context.addIssue({ code: "custom", path: ["webMcpTools"], message: "the WebMCP invocation tool and admitted descriptor catalog must be exposed together" });
  }
  const hasConfiguredMcpInvocation = value.tools.includes("invokeConfiguredMcpReadOnly");
  if (hasConfiguredMcpInvocation !== (value.configuredMcpTools.length > 0)) {
    context.addIssue({ code: "custom", path: ["configuredMcpTools"], message: "the configured MCP invocation tool and admitted descriptor catalog must be exposed together" });
  }
});

const toolResultBase = {
  schemaVersion: z.literal(1),
  toolCallId: ToolCallIdSchema,
  decision: EffectDecisionSchema,
  observation: UntrustedAgentObservationSchema.nullable(),
  finishedBelief: z.null(),
  summary: z.string().max(2_000),
};

export const SafeAgentToolResultSchema = z.discriminatedUnion("tool", [
  z.object({ ...toolResultBase, tool: z.literal("navigate") }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("inspect") }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("click") }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("type") }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("select") }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("pressKey") }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("scroll") }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("wait") }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("invokeWebMcpReadOnly"), webMcpResult: UntrustedWebMcpResultV1Schema.nullable() }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("invokeConfiguredMcpReadOnly"), configuredMcpResult: UntrustedConfiguredMcpResultV1Schema.nullable() }).strict(),
  z.object({ ...toolResultBase, tool: z.literal("finish"), observation: z.null(), finishedBelief: z.boolean() }).strict(),
]).superRefine((value, context) => {
  if (value.tool === "invokeWebMcpReadOnly") {
    const requiresResult = value.decision.decision === "allow";
    if (requiresResult !== (value.webMcpResult !== null)) {
      context.addIssue({ code: "custom", path: ["webMcpResult"], message: "allowed WebMCP calls require a result; denied calls must not fabricate one" });
    }
  }
  if (value.tool === "invokeConfiguredMcpReadOnly") {
    const requiresResult = value.decision.decision === "allow";
    if (requiresResult !== (value.configuredMcpResult !== null)) {
      context.addIssue({ code: "custom", path: ["configuredMcpResult"], message: "allowed configured MCP calls require a result; denied calls must not fabricate one" });
    }
  }
  if (value.decision.decision !== "allow") return;
  const allowedEffects = {
    navigate: ["admitted_get_navigation"],
    inspect: ["inspect"],
    click: ["admitted_get_navigation", "disclosure_toggle", "local_filter_select"],
    type: ["non_sensitive_filter_input"],
    select: ["local_filter_select"],
    pressKey: ["restricted_key_navigation"],
    scroll: ["viewport_scroll"],
    wait: ["passive_wait"],
    invokeWebMcpReadOnly: ["admitted_read_only_webmcp"],
    invokeConfiguredMcpReadOnly: ["admitted_read_only_configured_mcp"],
    finish: ["finish_declaration"],
  } as const;
  if (!(allowedEffects[value.tool] as readonly string[]).includes(value.decision.effect)) {
    context.addIssue({ code: "custom", path: ["decision", "effect"], message: `effect is incompatible with ${value.tool}` });
  }
});

export const SafeAgentToolExchangeSchema = z.object({
  action: SafeAgentActionSchema,
  result: SafeAgentToolResultSchema,
}).strict().superRefine((value, context) => {
  if (value.action.toolCallId !== value.result.toolCallId || value.action.kind !== value.result.tool) {
    context.addIssue({ code: "custom", path: ["result"], message: "tool result identity must match its action" });
  }
  if (value.result.decision.observationRevision !== null && value.result.decision.observationRevision !== value.action.observationRevision) {
    context.addIssue({ code: "custom", path: ["result", "decision", "observationRevision"], message: "effect decision must use the proposal revision when a revision is available" });
  }
  if (value.action.kind === "invokeWebMcpReadOnly" && value.result.tool === "invokeWebMcpReadOnly" && value.result.webMcpResult !== null && value.action.toolId !== value.result.webMcpResult.toolId) {
    context.addIssue({ code: "custom", path: ["result", "webMcpResult", "toolId"], message: "WebMCP result tool ID must match its action" });
  }
  if (value.action.kind === "invokeConfiguredMcpReadOnly" && value.result.tool === "invokeConfiguredMcpReadOnly" && value.result.configuredMcpResult !== null) {
    if (value.action.endpointId !== value.result.configuredMcpResult.endpointId || value.action.toolId !== value.result.configuredMcpResult.toolId) {
      context.addIssue({ code: "custom", path: ["result", "configuredMcpResult"], message: "configured MCP result identity must match its action" });
    }
  }
});

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
}).strict();

export const AgentRunResultSchema = z.object({
  schemaVersion: z.literal(2),
  completedBelief: z.boolean(),
  summary: z.string().max(2_000),
  iterations: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  browserActions: z.number().int().nonnegative(),
  interfaceUsage: InterfaceUsageSummarySchema.optional(),
  usage: TokenUsageSchema,
  resolvedProvider: z.string().min(1).max(200).nullable(),
  warnings: z.array(RunWarningSchema).max(50),
}).strict();

export type SafeAgentToolName = z.infer<typeof SafeAgentToolNameSchema>;
export type SafeAgentAction = z.infer<typeof SafeAgentActionSchema>;
export type CompactElement = z.infer<typeof CompactElementSchema>;
export type UntrustedAgentObservation = z.infer<typeof UntrustedAgentObservationSchema>;
export type AgentObservation = UntrustedAgentObservation;
export type PublicCapabilitySummary = z.infer<typeof PublicCapabilitySummarySchema>;
export type AgentExecutionInputV2 = z.infer<typeof AgentExecutionInputV2Schema>;
export type AgentPromptLayersV2 = z.infer<typeof AgentPromptLayersV2Schema>;
export type SafeAgentToolSurface = z.infer<typeof SafeAgentToolSurfaceSchema>;
export type SafeAgentToolResult = z.infer<typeof SafeAgentToolResultSchema>;
export type SafeAgentToolExchange = z.infer<typeof SafeAgentToolExchangeSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;

export function buildAgentExecutionInputV2(
  config: PublicEvaluationConfigV2,
  initialObservation: UntrustedAgentObservation,
  availableTools: readonly SafeAgentToolName[],
): AgentExecutionInputV2 {
  return AgentExecutionInputV2Schema.parse({
    schemaVersion: 2,
    systemPolicyVersion: config.safetyPolicyVersion,
    userTask: config.prompt,
    capabilities: {
      startOrigin: new URL(config.target.startUrl).origin,
      allowedNavigationOrigins: config.target.allowedNavigationOrigins,
      availableTools,
      interfaceMode: config.interfaceMode,
      safetySummary: "anonymous public observable-state tasks only; unknown effects are denied",
    },
    initialObservation,
    budgets: config.budgets,
  });
}
