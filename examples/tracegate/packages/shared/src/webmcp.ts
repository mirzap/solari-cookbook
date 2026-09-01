import { z } from "zod";
import { JsonObjectSchema } from "./json.ts";
import { PublicHttpsOriginSchema } from "./targets.ts";

const MAX_WEBMCP_FIELDS = 16;
const MAX_WEBMCP_PAYLOAD_BYTES = 16_384;
const boundedName = z.string().trim().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/);

export const WebMcpToolIdSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/).brand<"WebMcpToolId">();

const StringInputPropertySchema = z.object({
  type: z.literal("string"),
  description: z.string().max(500).optional(),
  enum: z.array(z.string().max(1_000)).min(1).max(50).optional(),
  minLength: z.number().int().min(0).max(2_000).optional(),
  maxLength: z.number().int().min(1).max(2_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.minLength !== undefined && value.maxLength !== undefined && value.minLength > value.maxLength) {
    context.addIssue({ code: "custom", path: ["minLength"], message: "minLength cannot exceed maxLength" });
  }
});

const NumericInputPropertySchema = z.object({
  type: z.enum(["number", "integer"]),
  description: z.string().max(500).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
}).strict().superRefine((value, context) => {
  if (value.minimum !== undefined && value.maximum !== undefined && value.minimum > value.maximum) {
    context.addIssue({ code: "custom", path: ["minimum"], message: "minimum cannot exceed maximum" });
  }
});

const BooleanInputPropertySchema = z.object({
  type: z.literal("boolean"),
  description: z.string().max(500).optional(),
}).strict();

export const WebMcpInputPropertySchema = z.union([
  StringInputPropertySchema,
  NumericInputPropertySchema,
  BooleanInputPropertySchema,
]);

export const WebMcpClosedInputSchema = z.object({
  type: z.literal("object"),
  properties: z.record(boundedName, WebMcpInputPropertySchema),
  required: z.array(boundedName).max(MAX_WEBMCP_FIELDS).default([]),
  additionalProperties: z.literal(false),
}).strict().superRefine((value, context) => {
  const keys = Object.keys(value.properties);
  if (keys.length > MAX_WEBMCP_FIELDS) context.addIssue({ code: "custom", path: ["properties"], message: `at most ${MAX_WEBMCP_FIELDS} input fields are supported` });
  if (new Set(value.required).size !== value.required.length) context.addIssue({ code: "custom", path: ["required"], message: "required fields must be unique" });
  for (const [index, key] of value.required.entries()) {
    if (!(key in value.properties)) context.addIssue({ code: "custom", path: ["required", index], message: "required field must exist in properties" });
  }
});

const unsafeCapabilityText = /(?:auth|credential|password|token|secret|payment|purchase|checkout|message|publish|post|delete|destroy|upload|download|submit)/i;
const unsafeInputField = /(?:url|uri|origin|host|endpoint|destination|auth|credential|password|token|secret|payment|card|purchase|message|recipient|publish|file|upload|download|submit)/i;

export const WebMcpToolDescriptorV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: WebMcpToolIdSchema,
  name: boundedName,
  description: z.string().trim().min(1).max(1_000),
  inputSchema: WebMcpClosedInputSchema,
  currentOrigin: PublicHttpsOriginSchema,
  trust: z.literal("untrusted_page_capability"),
  declaredReadOnly: z.literal(true),
}).strict().superRefine((value, context) => {
  if (unsafeCapabilityText.test(`${value.name} ${value.description}`)) {
    context.addIssue({ code: "custom", path: ["description"], message: "tool name or description declares a prohibited capability" });
  }
  for (const key of Object.keys(value.inputSchema.properties)) {
    if (unsafeInputField.test(key)) context.addIssue({ code: "custom", path: ["inputSchema", "properties", key], message: "input field may carry a destination, credential, or prohibited effect" });
  }
});

export const WebMcpToolCatalogV1Schema = z.array(WebMcpToolDescriptorV1Schema).max(10).superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, descriptor] of value.entries()) {
    if (ids.has(descriptor.id)) context.addIssue({ code: "custom", path: [index, "id"], message: "WebMCP tool IDs must be unique" });
    ids.add(descriptor.id);
  }
});

export const WebMcpInvocationInputSchema = z.record(boundedName, z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
])).superRefine((value, context) => {
  if (Object.keys(value).length > MAX_WEBMCP_FIELDS) context.addIssue({ code: "custom", message: `at most ${MAX_WEBMCP_FIELDS} input fields are supported` });
  if (JSON.stringify(value).length > 8_192) context.addIssue({ code: "custom", message: "WebMCP input exceeds the serialized size limit" });
});

export const WebMcpInvocationRequestSchema = z.object({
  toolId: WebMcpToolIdSchema,
  input: WebMcpInvocationInputSchema,
  currentOrigin: PublicHttpsOriginSchema,
}).strict();

export const UntrustedWebMcpResultV1Schema = z.object({
  schemaVersion: z.literal(1),
  toolId: WebMcpToolIdSchema,
  trust: z.literal("untrusted_page_tool_result"),
  summary: z.string().max(2_000),
  output: JsonObjectSchema,
  truncated: z.boolean(),
  redacted: z.literal(true),
}).strict().superRefine((value, context) => {
  if (JSON.stringify(value.output).length > MAX_WEBMCP_PAYLOAD_BYTES) {
    context.addIssue({ code: "custom", path: ["output"], message: "WebMCP output exceeds the serialized size limit" });
  }
});

export const WebMcpAdmissionDenyCodeSchema = z.enum([
  "unavailable",
  "origin_mismatch",
  "missing_read_only_declaration",
  "unsupported_input_schema",
  "sensitive_or_unsafe_field",
  "arbitrary_destination_field",
  "malformed_descriptor",
  "tool_limit_exceeded",
]);

export type WebMcpToolId = z.infer<typeof WebMcpToolIdSchema>;
export type WebMcpInputProperty = z.infer<typeof WebMcpInputPropertySchema>;
export type WebMcpClosedInput = z.infer<typeof WebMcpClosedInputSchema>;
export type WebMcpToolDescriptorV1 = z.infer<typeof WebMcpToolDescriptorV1Schema>;
export type WebMcpInvocationInput = z.infer<typeof WebMcpInvocationInputSchema>;
export type WebMcpInvocationRequest = z.infer<typeof WebMcpInvocationRequestSchema>;
export type UntrustedWebMcpResultV1 = z.infer<typeof UntrustedWebMcpResultV1Schema>;
export type WebMcpAdmissionDenyCode = z.infer<typeof WebMcpAdmissionDenyCodeSchema>;
