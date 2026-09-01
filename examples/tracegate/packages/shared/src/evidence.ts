import { z } from "zod";
import { AssertionIdSchema } from "./assertions.ts";
import {
  DocumentIdentityHashSchema,
  EvidenceHashSchema,
  UtcDateTimeSchema,
} from "./ids.ts";
import { PolicyActivitySummarySchema } from "./policy.ts";
import { PublicHttpsUrlSchema } from "./targets.ts";

export const AssertionUnverifiableCodeSchema = z.enum([
  "capture_timeout",
  "page_unstable",
  "observation_truncated",
  "semantic_match_ambiguous",
  "semantic_data_unavailable",
  "unsupported_state",
  "cross_origin_frame",
  "sensitive_control",
  "policy_blocked",
  "target_unreachable",
  "evidence_invalid",
]);

export const CanonicalAssertionObservationSchema = z.object({
  assertionId: AssertionIdSchema,
  status: z.enum(["observed", "unverifiable"]),
  observedResult: z.boolean().nullable(),
  expectedSummary: z.string().max(1_000),
  actualSummary: z.string().max(1_000),
  reasonCode: AssertionUnverifiableCodeSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === "observed" && (value.observedResult === null || value.reasonCode !== null)) {
    context.addIssue({ code: "custom", message: "observed evidence requires a boolean result and no reason code" });
  }
  if (value.status === "unverifiable" && (value.observedResult !== null || value.reasonCode === null)) {
    context.addIssue({ code: "custom", message: "unverifiable evidence requires no boolean and a closed reason code" });
  }
});

export const TransientCanonicalCaptureV1Schema = z.object({
  schemaVersion: z.literal(1),
  canonicalFinalUrl: PublicHttpsUrlSchema.nullable(),
  documentId: z.string().min(1).max(512),
  loaderId: z.string().min(1).max(512),
  capturedAt: UtcDateTimeSchema,
  assertionObservations: z.array(CanonicalAssertionObservationSchema).min(1).max(20),
  evidenceHash: EvidenceHashSchema,
}).strict();

export const BrowserAssertionEvidenceV1Schema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: UtcDateTimeSchema,
  redactedDisplayUrl: z.string().max(2_048).nullable(),
  documentIdHash: DocumentIdentityHashSchema,
  loaderIdHash: DocumentIdentityHashSchema,
  quietIntervalMs: z.literal(750),
  requiredIdenticalCaptures: z.literal(2),
  captureAttempts: z.number().int().min(2).max(3),
  evidenceHash: EvidenceHashSchema,
  policyActivity: PolicyActivitySummarySchema,
  assertions: z.array(CanonicalAssertionObservationSchema).min(1).max(20),
}).strict();

export const AssertionCaptureResultSchema = z.object({
  transient: TransientCanonicalCaptureV1Schema,
  evidence: BrowserAssertionEvidenceV1Schema,
}).strict().superRefine((value, context) => {
  if (value.transient.evidenceHash !== value.evidence.evidenceHash) {
    context.addIssue({ code: "custom", path: ["evidence", "evidenceHash"], message: "transient and persisted evidence hashes must match" });
  }
  if (value.transient.capturedAt !== value.evidence.capturedAt) {
    context.addIssue({ code: "custom", path: ["evidence", "capturedAt"], message: "capture timestamps must match" });
  }
  if (JSON.stringify(value.transient.assertionObservations) !== JSON.stringify(value.evidence.assertions)) {
    context.addIssue({ code: "custom", path: ["evidence", "assertions"], message: "durable evidence must exactly project transient assertion observations" });
  }
});

export type AssertionUnverifiableCode = z.infer<typeof AssertionUnverifiableCodeSchema>;
export type CanonicalAssertionObservation = z.infer<typeof CanonicalAssertionObservationSchema>;
export type TransientCanonicalCaptureV1 = z.infer<typeof TransientCanonicalCaptureV1Schema>;
export type BrowserAssertionEvidenceV1 = z.infer<typeof BrowserAssertionEvidenceV1Schema>;
export type AssertionCaptureResult = z.infer<typeof AssertionCaptureResultSchema>;
