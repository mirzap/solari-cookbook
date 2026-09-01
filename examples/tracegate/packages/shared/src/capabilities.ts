import { z } from "zod";
import { ControlErrorSchema } from "./errors.ts";
import { UtcDateTimeSchema } from "./ids.ts";
import { JsonObjectSchema } from "./json.ts";

export const CapabilityKindSchema = z.enum([
  "runtime",
  "database",
  "demo_connectivity",
  "solari",
  "model",
  "recording",
  "replay",
  "webmcp",
]);

export const CapabilityStatusSchema = z.enum([
  "pending",
  "verified",
  "failed",
  "unsupported",
  "not_configured",
]);

export const RuntimeCapabilitySchema = z.object({
  schemaVersion: z.literal(1),
  kind: CapabilityKindSchema,
  subject: z.string().trim().min(1).max(200),
  status: CapabilityStatusSchema,
  details: JsonObjectSchema,
  checkedAt: UtcDateTimeSchema,
  error: ControlErrorSchema.nullable(),
});

export const RuntimeCapabilitiesSchema = z.object({
  schemaVersion: z.literal(1),
  checks: z.array(RuntimeCapabilitySchema).max(100),
  blockerCodes: z.array(z.string().min(1).max(128)).max(100),
  checkedAt: UtcDateTimeSchema,
});

export type CapabilityKind = z.infer<typeof CapabilityKindSchema>;
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;
export type RuntimeCapability = z.infer<typeof RuntimeCapabilitySchema>;
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>;
