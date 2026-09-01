import { z } from "zod";
import { UtcDateTimeSchema } from "./ids.ts";

const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[?[0-9a-f:]+\]?)$/i;

export const PublicHttpsUrlSchema = z.url().max(2_048).superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:") context.addIssue({ code: "custom", message: "must use HTTPS" });
  if (url.username || url.password) context.addIssue({ code: "custom", message: "credentials are forbidden" });
  if (IP_LITERAL.test(url.hostname)) context.addIssue({ code: "custom", message: "IP-literal targets require admission rejection" });
}).brand<"PublicHttpsUrl">();

export const PublicHttpsOriginSchema = z.string().max(300).superRefine((value, context) => {
  let url: URL;
  try { url = new URL(value); } catch {
    context.addIssue({ code: "custom", message: "must be an absolute URL origin" });
    return;
  }
  if (url.protocol !== "https:") context.addIssue({ code: "custom", message: "origin must use HTTPS" });
  if (url.username || url.password) context.addIssue({ code: "custom", message: "origin credentials are forbidden" });
  if (url.origin !== value || url.pathname !== "/" || url.search || url.hash) {
    context.addIssue({ code: "custom", message: "must be a canonical exact origin" });
  }
  if (IP_LITERAL.test(url.hostname)) context.addIssue({ code: "custom", message: "IP-literal origins are forbidden" });
}).brand<"PublicHttpsOrigin">();

export const PublicEvaluationTargetV2Schema = z.object({
  kind: z.literal("public-web"),
  startUrl: PublicHttpsUrlSchema,
  allowedNavigationOrigins: z.array(PublicHttpsOriginSchema).min(1).max(3),
}).strict().superRefine((value, context) => {
  if (new Set(value.allowedNavigationOrigins).size !== value.allowedNavigationOrigins.length) {
    context.addIssue({ code: "custom", path: ["allowedNavigationOrigins"], message: "origins must be unique" });
  }
  const startOrigin = new URL(value.startUrl).origin;
  if (!value.allowedNavigationOrigins.includes(startOrigin as z.infer<typeof PublicHttpsOriginSchema>)) {
    context.addIssue({ code: "custom", path: ["allowedNavigationOrigins"], message: "must include the start URL origin" });
  }
});

export const AdmissionReasonCodeSchema = z.enum([
  "admitted",
  "invalid_target",
  "unsupported_port",
  "ip_literal",
  "private_or_reserved_address",
  "mixed_address_set",
  "unsafe_redirect",
  "target_unreachable",
  "destination_unobservable",
  "protocol_unenforceable",
  "admission_expired",
  "operation_aborted",
]);

export const AdmittedPublicTargetSchema = z.object({
  schemaVersion: z.literal(1),
  startUrl: PublicHttpsUrlSchema,
  allowedNavigationOrigins: z.array(PublicHttpsOriginSchema).min(1).max(3),
  admittedAt: UtcDateTimeSchema,
  expiresAt: UtcDateTimeSchema,
  policyVersion: z.literal("public-safe-v1"),
  enforcement: z.enum(["provider_preconnect", "forced_proxy_preconnect"]),
}).strict().superRefine((value, context) => {
  if (new Set(value.allowedNavigationOrigins).size !== value.allowedNavigationOrigins.length) {
    context.addIssue({ code: "custom", path: ["allowedNavigationOrigins"], message: "admitted origins must be unique" });
  }
  if (!value.allowedNavigationOrigins.includes(new URL(value.startUrl).origin as z.infer<typeof PublicHttpsOriginSchema>)) {
    context.addIssue({ code: "custom", path: ["allowedNavigationOrigins"], message: "admitted origins must include the start origin" });
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.admittedAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "admission expiry must follow admission time" });
  }
});

export const TargetAdmissionResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("admitted"), target: AdmittedPublicTargetSchema }).strict(),
  z.object({
    status: z.literal("rejected"),
    reason: AdmissionReasonCodeSchema.exclude(["admitted"]),
    message: z.string().trim().min(1).max(500),
  }).strict(),
]);

export type PublicHttpsUrl = z.infer<typeof PublicHttpsUrlSchema>;
export type PublicHttpsOrigin = z.infer<typeof PublicHttpsOriginSchema>;
export type PublicEvaluationTargetV2 = z.infer<typeof PublicEvaluationTargetV2Schema>;
export type AdmissionReasonCode = z.infer<typeof AdmissionReasonCodeSchema>;
export type AdmittedPublicTarget = z.infer<typeof AdmittedPublicTargetSchema>;
export type TargetAdmissionResult = z.infer<typeof TargetAdmissionResultSchema>;
