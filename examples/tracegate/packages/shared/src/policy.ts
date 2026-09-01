import { z } from "zod";
import { ObservationRevisionSchema, UtcDateTimeSchema } from "./ids.ts";

export const SafetyPolicyVersionV1Schema = z.literal("public-safe-v1");

export const SafeActionEffectSchema = z.enum([
  "inspect",
  "passive_wait",
  "viewport_scroll",
  "admitted_get_navigation",
  "disclosure_toggle",
  "local_filter_select",
  "non_sensitive_filter_input",
  "restricted_key_navigation",
  "admitted_read_only_webmcp",
  "admitted_read_only_configured_mcp",
  "finish_declaration",
]);

export const PolicyDenyCodeSchema = z.enum([
  "unknown_effect",
  "unobservable_effect",
  "stale_observation",
  "semantic_identity_changed",
  "origin_not_admitted",
  "non_idempotent_request",
  "request_body_forbidden",
  "credential_forbidden",
  "sensitive_control",
  "authentication_forbidden",
  "financial_action_forbidden",
  "messaging_or_publication_forbidden",
  "destructive_action_forbidden",
  "upload_or_download_forbidden",
  "permission_forbidden",
  "submit_activation_forbidden",
  "popup_forbidden",
  "cross_origin_frame_forbidden",
  "alternate_protocol_forbidden",
  "network_destination_unobservable",
  "private_destination_forbidden",
  "service_worker_forbidden",
  "native_tool_forbidden",
  "press_key_forbidden",
  "operation_cancelled",
  "budget_exhausted",
]);

export const BrowserPolicyActionScopeSchema = z.enum([
  "navigation",
  "direct_interaction",
  "webmcp",
]);

export const PolicyDiagnosticMethodClassSchema = z.enum([
  "get",
  "head",
  "other",
  "not_applicable",
]);

export const PolicyDiagnosticResourceTypeSchema = z.enum([
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "texttrack",
  "xhr",
  "fetch",
  "eventsource",
  "websocket",
  "manifest",
  "other",
  "ping",
  "beacon",
  "cspviolationreport",
  "prefetch",
  "dialog",
  "download",
  "filechooser",
  "popup",
  "unknown",
  "not_applicable",
]);

export const BrowserPolicyDiagnosticV1Schema = z.object({
  schemaVersion: z.literal(1),
  policyCode: PolicyDenyCodeSchema,
  actionScope: BrowserPolicyActionScopeSchema.nullable(),
  methodClass: PolicyDiagnosticMethodClassSchema,
  resourceType: PolicyDiagnosticResourceTypeSchema,
  mainFrame: z.boolean().nullable(),
  sameOrigin: z.boolean().nullable(),
}).strict();

export const EffectDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("allow"),
    effect: SafeActionEffectSchema,
    observationRevision: ObservationRevisionSchema,
  }).strict(),
  z.object({
    decision: z.literal("deny"),
    code: PolicyDenyCodeSchema,
    observationRevision: ObservationRevisionSchema.nullable(),
  }).strict(),
]);

export const PolicyActivityDispositionSchema = z.enum(["passive_warning", "agent_blocked"]);
export const PolicyActivitySchema = z.object({
  schemaVersion: z.literal(1),
  disposition: PolicyActivityDispositionSchema,
  code: PolicyDenyCodeSchema,
  occurredAt: UtcDateTimeSchema,
  actionSequence: z.number().int().nonnegative().nullable(),
  causality: z.enum(["baseline", "agent_caused", "unclassifiable"]),
}).strict().superRefine((value, context) => {
  if ((value.disposition === "passive_warning") !== (value.causality === "baseline")) {
    context.addIssue({ code: "custom", path: ["disposition"], message: "only baseline activity may be a passive warning" });
  }
  if (value.causality !== "baseline" && value.actionSequence === null) {
    context.addIssue({ code: "custom", path: ["actionSequence"], message: "post-action activity requires action sequence" });
  }
});

export const PolicyActivitySummarySchema = z.object({
  passiveWarningCount: z.number().int().nonnegative().max(1_000),
  agentBlockedCount: z.number().int().nonnegative().max(1_000),
  codes: z.array(PolicyDenyCodeSchema).max(50),
}).strict().superRefine((value, context) => {
  if (new Set(value.codes).size !== value.codes.length) {
    context.addIssue({ code: "custom", path: ["codes"], message: "policy codes must be unique" });
  }
});

export type SafetyPolicyVersionV1 = z.infer<typeof SafetyPolicyVersionV1Schema>;
export type SafeActionEffect = z.infer<typeof SafeActionEffectSchema>;
export type PolicyDenyCode = z.infer<typeof PolicyDenyCodeSchema>;
export type BrowserPolicyActionScope = z.infer<typeof BrowserPolicyActionScopeSchema>;
export type PolicyDiagnosticMethodClass = z.infer<typeof PolicyDiagnosticMethodClassSchema>;
export type PolicyDiagnosticResourceType = z.infer<typeof PolicyDiagnosticResourceTypeSchema>;
export type BrowserPolicyDiagnosticV1 = z.infer<typeof BrowserPolicyDiagnosticV1Schema>;
export type EffectDecision = z.infer<typeof EffectDecisionSchema>;
export type PolicyActivity = z.infer<typeof PolicyActivitySchema>;
export type PolicyActivitySummary = z.infer<typeof PolicyActivitySummarySchema>;
