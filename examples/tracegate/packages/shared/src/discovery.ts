import { z } from "zod";
import { ObservationRevisionSchema, UtcDateTimeSchema } from "./ids.ts";
import { JsonObjectSchema } from "./json.ts";
import { RunWarningSchema } from "./errors.ts";

export const DiscoveredInterfaceKindSchema = z.enum(["semantic", "llms_txt", "json_ld", "webmcp"]);
export const WebMcpGateStateSchema = z.enum([
  "unavailable",
  "available_disabled",
  "discover_only",
  "admitted_read_only",
]);

export const DiscoveredInterfaceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: DiscoveredInterfaceKindSchema,
  name: z.string().trim().min(1).max(200),
  metadata: JsonObjectSchema,
  discoveredAt: UtcDateTimeSchema,
});

export const LlmsTxtEvidenceSchema = z.object({
  status: z.enum(["not_found", "available", "invalid", "blocked"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  sizeBytes: z.number().int().nonnegative().max(65_536).nullable(),
  preview: z.string().max(4_096).nullable(),
  truncated: z.boolean(),
});

export const DiscoveryEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  observationRevision: ObservationRevisionSchema,
  semanticControlCount: z.number().int().nonnegative().max(10_000),
  llmsTxt: LlmsTxtEvidenceSchema,
  jsonLdTypes: z.array(z.string().trim().min(1).max(200)).max(100),
  webMcpGate: WebMcpGateStateSchema,
  interfaces: z.array(DiscoveredInterfaceSchema).max(200),
  warnings: z.array(RunWarningSchema).max(50),
  truncated: z.boolean(),
});

export type DiscoveredInterfaceKind = z.infer<typeof DiscoveredInterfaceKindSchema>;
export type WebMcpGateState = z.infer<typeof WebMcpGateStateSchema>;
export type DiscoveredInterface = z.infer<typeof DiscoveredInterfaceSchema>;
export type DiscoveryEvidence = z.infer<typeof DiscoveryEvidenceSchema>;
