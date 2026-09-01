import { z } from "zod";
import { JsonObjectSchema } from "./json.ts";
import { WebMcpClosedInputSchema, WebMcpInvocationInputSchema } from "./webmcp.ts";

export const ConfiguredMcpEndpointIdSchema = z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_-]*$/).brand<"ConfiguredMcpEndpointId">();
const toolName = z.string().trim().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/);
const unsafeCapabilityWord = /\b(?:auth|credential|password|token|secret|payment|purchase|checkout|message|publish|post|delete|destroy|upload|download|submit)\b/i;
const normalizedCapabilityText = (value: string) => value
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[^A-Za-z0-9]+/g, " ")
  .toLowerCase();
const unsafeInputField = /(?:url|uri|origin|host|endpoint|destination|auth|credential|password|token|secret|payment|card|purchase|message|recipient|publish|file|upload|download|submit)/i;

export const ConfiguredMcpEndpointUrlSchema = z.url().superRefine((raw, context) => {
  const url = new URL(raw);
  const loopbackHttp = url.protocol === "http:"
    && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname === "::1" ? "[::1]" : url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    context.addIssue({ code: "custom", message: "MCP endpoint must use HTTPS or loopback HTTP" });
  }
  if (url.username || url.password || url.hash || url.search) {
    context.addIssue({ code: "custom", message: "MCP endpoint URL cannot contain credentials, query parameters, or a fragment" });
  }
});

export const ConfiguredMcpEndpointV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: ConfiguredMcpEndpointIdSchema,
  label: z.string().trim().min(1).max(100),
  endpointUrl: ConfiguredMcpEndpointUrlSchema,
  transport: z.literal("streamable-http"),
  authentication: z.literal("none"),
  selectedTools: z.array(toolName).min(1).max(20),
}).strict().superRefine((value, context) => {
  if (new Set(value.selectedTools).size !== value.selectedTools.length) {
    context.addIssue({ code: "custom", path: ["selectedTools"], message: "selected MCP tool names must be unique" });
  }
});

export const ConfiguredMcpToolIdSchema = z.string().trim().min(1).max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
  .brand<"ConfiguredMcpToolId">();

export const ConfiguredMcpToolDescriptorV1Schema = z.object({
  schemaVersion: z.literal(1),
  endpointId: ConfiguredMcpEndpointIdSchema,
  id: ConfiguredMcpToolIdSchema,
  name: toolName,
  description: z.string().trim().min(1).max(1_000),
  inputSchema: WebMcpClosedInputSchema,
  trust: z.literal("untrusted_configured_mcp_capability"),
  serverDeclaredReadOnly: z.literal(true),
  admission: z.literal("locally_admitted_read_only"),
}).strict().superRefine((value, context) => {
  const capabilityText = normalizedCapabilityText(`${value.name} ${value.description}`);
  if (unsafeCapabilityWord.test(capabilityText)) {
    context.addIssue({ code: "custom", path: ["description"], message: "tool name or description declares a prohibited capability" });
  }
  for (const key of Object.keys(value.inputSchema.properties)) {
    if (unsafeInputField.test(key)) context.addIssue({ code: "custom", path: ["inputSchema", "properties", key], message: "input field may carry a destination, credential, or prohibited effect" });
  }
});

export const ConfiguredMcpToolCatalogV1Schema = z.array(ConfiguredMcpToolDescriptorV1Schema).max(50)
  .superRefine((value, context) => {
    const identities = new Set<string>();
    const names = new Set<string>();
    for (const [index, descriptor] of value.entries()) {
      const identity = `${descriptor.endpointId}:${descriptor.id}`;
      const name = `${descriptor.endpointId}:${descriptor.name}`;
      if (identities.has(identity)) {
        context.addIssue({ code: "custom", path: [index, "id"], message: "configured MCP tool identities must be unique" });
      }
      if (names.has(name)) {
        context.addIssue({ code: "custom", path: [index, "name"], message: "configured MCP tool names must be unique within an endpoint" });
      }
      identities.add(identity);
      names.add(name);
    }
  });

export const ConfiguredMcpAdmissionDenyCodeSchema = z.enum([
  "not_found",
  "malformed_descriptor",
  "unsupported_input_schema",
  "missing_read_only_declaration",
  "sensitive_or_unsafe_capability",
  "tool_limit_exceeded",
]);

export const ConfiguredMcpToolDenialV1Schema = z.object({
  name: toolName,
  code: ConfiguredMcpAdmissionDenyCodeSchema,
}).strict();

export const ConfiguredMcpReadinessV1Schema = z.object({
  schemaVersion: z.literal(1),
  endpointId: ConfiguredMcpEndpointIdSchema,
  label: z.string().trim().min(1).max(100),
  transport: z.literal("streamable-http"),
  selectedTools: z.array(toolName).min(1).max(20),
  admittedTools: z.array(toolName).max(20),
  deniedTools: z.array(ConfiguredMcpToolDenialV1Schema).max(20),
}).strict().superRefine((value, context) => {
  const selected = new Set(value.selectedTools);
  const admitted = new Set(value.admittedTools);
  const denied = new Set(value.deniedTools.map((tool) => tool.name));
  if (selected.size !== value.selectedTools.length) {
    context.addIssue({ code: "custom", path: ["selectedTools"], message: "selected MCP tool names must be unique" });
  }
  if (admitted.size !== value.admittedTools.length) {
    context.addIssue({ code: "custom", path: ["admittedTools"], message: "admitted MCP tool names must be unique" });
  }
  if (denied.size !== value.deniedTools.length) {
    context.addIssue({ code: "custom", path: ["deniedTools"], message: "denied MCP tool names must be unique" });
  }
  for (const [index, name] of value.admittedTools.entries()) {
    if (!selected.has(name)) context.addIssue({ code: "custom", path: ["admittedTools", index], message: "admitted MCP tools must have been selected" });
    if (denied.has(name)) context.addIssue({ code: "custom", path: ["admittedTools", index], message: "an MCP tool cannot be both admitted and denied" });
  }
  for (const [index, tool] of value.deniedTools.entries()) {
    if (!selected.has(tool.name)) context.addIssue({ code: "custom", path: ["deniedTools", index, "name"], message: "denied MCP tools must have been selected" });
  }
  if (admitted.size + denied.size !== selected.size) {
    context.addIssue({ code: "custom", message: "every selected MCP tool must have one admitted or denied decision" });
  }
});

export const ConfiguredMcpDiscoveryResultV1Schema = z.object({
  schemaVersion: z.literal(1),
  readiness: ConfiguredMcpReadinessV1Schema,
  admittedTools: ConfiguredMcpToolCatalogV1Schema,
}).strict().superRefine((value, context) => {
  const expected = new Set(value.readiness.admittedTools);
  const actual = new Set(value.admittedTools.map((tool) => tool.name));
  if (value.admittedTools.some((tool) => tool.endpointId !== value.readiness.endpointId)) {
    context.addIssue({ code: "custom", path: ["admittedTools"], message: "admitted MCP descriptors must belong to the readiness endpoint" });
  }
  if (expected.size !== actual.size || [...expected].some((name) => !actual.has(name))) {
    context.addIssue({ code: "custom", path: ["admittedTools"], message: "admitted MCP descriptors must exactly match readiness names" });
  }
});

export const ConfiguredMcpInvocationRequestSchema = z.object({
  endpointId: ConfiguredMcpEndpointIdSchema,
  toolId: ConfiguredMcpToolIdSchema,
  input: WebMcpInvocationInputSchema,
}).strict();

export const UntrustedConfiguredMcpResultV1Schema = z.object({
  schemaVersion: z.literal(1),
  endpointId: ConfiguredMcpEndpointIdSchema,
  toolId: ConfiguredMcpToolIdSchema,
  trust: z.literal("untrusted_configured_mcp_result"),
  summary: z.string().max(2_000),
  output: JsonObjectSchema,
  truncated: z.boolean(),
  redacted: z.literal(true),
}).strict().superRefine((value, context) => {
  if (JSON.stringify(value.output).length > 16_384) {
    context.addIssue({ code: "custom", path: ["output"], message: "configured MCP output exceeds the serialized size limit" });
  }
});

export const InterfaceChannelSchema = z.enum([
  "semantic_ui",
  "page_webmcp",
  "configured_mcp",
  "llms_txt",
  "json_ld",
  "visual_fallback",
]);

export const ToolInterfaceSourceSchema = z.union([InterfaceChannelSchema, z.literal("orchestration")]);

export const InterfaceUsageMetricSchema = z.object({
  channel: InterfaceChannelSchema,
  discovered: z.number().int().nonnegative().max(10_000),
  admitted: z.number().int().nonnegative().max(10_000),
  invoked: z.number().int().nonnegative().max(10_000),
  succeeded: z.number().int().nonnegative().max(10_000),
  failed: z.number().int().nonnegative().max(10_000),
}).strict().superRefine((value, context) => {
  if (value.admitted > value.discovered) {
    context.addIssue({ code: "custom", path: ["admitted"], message: "admitted interfaces cannot exceed discovered interfaces" });
  }
  if (value.invoked > 0 && value.admitted === 0) {
    context.addIssue({ code: "custom", path: ["invoked"], message: "an interface cannot be invoked without an admitted capability" });
  }
  if (value.succeeded + value.failed !== value.invoked) {
    context.addIssue({ code: "custom", path: ["succeeded"], message: "terminal interface call outcomes must equal invoked calls" });
  }
});

export const InterfaceUsageSummarySchema = z.object({
  schemaVersion: z.literal(1),
  metrics: z.array(InterfaceUsageMetricSchema).max(6),
}).strict().superRefine((value, context) => {
  const channels = value.metrics.map((metric) => metric.channel);
  if (new Set(channels).size !== channels.length) {
    context.addIssue({ code: "custom", path: ["metrics"], message: "interface usage channels must be unique" });
  }
});

export interface ConfiguredMcpClientPort {
  discover(endpoint: ConfiguredMcpEndpointV1, signal: AbortSignal): Promise<ConfiguredMcpDiscoveryResultV1>;
  invoke(
    endpoint: ConfiguredMcpEndpointV1,
    request: ConfiguredMcpInvocationRequest,
    signal: AbortSignal,
  ): Promise<UntrustedConfiguredMcpResultV1>;
  close(signal: AbortSignal): Promise<void>;
}

export type ConfiguredMcpEndpointId = z.infer<typeof ConfiguredMcpEndpointIdSchema>;
export type ConfiguredMcpEndpointV1 = z.infer<typeof ConfiguredMcpEndpointV1Schema>;
export type ConfiguredMcpToolId = z.infer<typeof ConfiguredMcpToolIdSchema>;
export type ConfiguredMcpToolDescriptorV1 = z.infer<typeof ConfiguredMcpToolDescriptorV1Schema>;
export type ConfiguredMcpAdmissionDenyCode = z.infer<typeof ConfiguredMcpAdmissionDenyCodeSchema>;
export type ConfiguredMcpToolDenialV1 = z.infer<typeof ConfiguredMcpToolDenialV1Schema>;
export type ConfiguredMcpReadinessV1 = z.infer<typeof ConfiguredMcpReadinessV1Schema>;
export type ConfiguredMcpDiscoveryResultV1 = z.infer<typeof ConfiguredMcpDiscoveryResultV1Schema>;
export type ConfiguredMcpInvocationRequest = z.infer<typeof ConfiguredMcpInvocationRequestSchema>;
export type UntrustedConfiguredMcpResultV1 = z.infer<typeof UntrustedConfiguredMcpResultV1Schema>;
export type InterfaceChannel = z.infer<typeof InterfaceChannelSchema>;
export type ToolInterfaceSource = z.infer<typeof ToolInterfaceSourceSchema>;
export type InterfaceUsageMetric = z.infer<typeof InterfaceUsageMetricSchema>;
export type InterfaceUsageSummary = z.infer<typeof InterfaceUsageSummarySchema>;
