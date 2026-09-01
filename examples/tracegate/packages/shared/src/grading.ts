import { z } from "zod";
import { AssertionIdSchema, AssertionSetV1Schema } from "./assertions.ts";
import { AssertionUnverifiableCodeSchema, BrowserAssertionEvidenceV1Schema } from "./evidence.ts";
import { FailureRecordSchema } from "./errors.ts";
import { EvidenceHashSchema, UtcDateTimeSchema } from "./ids.ts";
import { SafetyPolicyVersionV1Schema } from "./policy.ts";
import { RunOutcomeSchema } from "./states.ts";

export const GradeAssertionStatusSchema = z.enum(["passed", "failed", "unverifiable"]);

export const GradeAssertionResultSchema = z.object({
  assertionId: AssertionIdSchema,
  status: GradeAssertionStatusSchema,
  expectedSummary: z.string().max(1_000),
  actualSummary: z.string().max(1_000),
  code: AssertionUnverifiableCodeSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.status === "unverifiable") !== (value.code !== null)) {
    context.addIssue({ code: "custom", path: ["code"], message: "only unverifiable results require a reason code" });
  }
});

export const GradeResultV2Schema = z.object({
  schemaVersion: z.literal(2),
  evidenceHash: EvidenceHashSchema,
  safetyPolicyVersion: SafetyPolicyVersionV1Schema,
  outcome: RunOutcomeSchema,
  assertions: z.array(GradeAssertionResultSchema).min(1).max(20),
  failure: FailureRecordSchema.nullable(),
  gradedAt: UtcDateTimeSchema,
}).strict().superRefine((value, context) => {
  const ids = value.assertions.map((result) => result.assertionId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["assertions"], message: "grade assertion IDs must be unique" });
  const hasUnverifiable = value.assertions.some((result) => result.status === "unverifiable");
  const hasFailed = value.assertions.some((result) => result.status === "failed");
  if (hasUnverifiable && value.outcome !== "inconclusive") context.addIssue({ code: "custom", path: ["outcome"], message: "unverifiable assertion evidence requires inconclusive" });
  if (value.outcome === "passed" && (hasFailed || hasUnverifiable || value.failure !== null)) context.addIssue({ code: "custom", path: ["outcome"], message: "pass requires all assertions passed and no failure" });
  if (value.outcome === "failed" && (hasUnverifiable || !hasFailed || value.failure?.code !== "assertion_failed")) context.addIssue({ code: "custom", path: ["failure"], message: "failed grade requires a false assertion and assertion_failed" });
  if (value.outcome === "inconclusive" && value.failure?.outcome !== "inconclusive") context.addIssue({ code: "custom", path: ["failure"], message: "inconclusive grade requires its authoritative inconclusive failure" });
});

export const GradeInputV2Schema = z.object({
  assertions: AssertionSetV1Schema,
  evidence: BrowserAssertionEvidenceV1Schema,
}).strict().superRefine((value, context) => {
  const expected = value.assertions.map((assertion) => assertion.id);
  const actual = value.evidence.assertions.map((item) => item.assertionId);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    context.addIssue({ code: "custom", path: ["evidence", "assertions"], message: "evidence must match submitted assertion IDs exactly and in order" });
  }
});

export const UniversalDispositionSchema = z.enum(["cancelled", "passed", "failed", "inconclusive"]);
export const UniversalPrecedenceInputSchema = z.object({
  cancellationCommitted: z.boolean(),
  prohibitedActivity: z.boolean(),
  evidenceValid: z.boolean(),
  assertionStatuses: z.array(GradeAssertionStatusSchema).min(1).max(20),
}).strict();

export function resolveUniversalDisposition(input: z.input<typeof UniversalPrecedenceInputSchema>): z.infer<typeof UniversalDispositionSchema> {
  const value = UniversalPrecedenceInputSchema.parse(input);
  if (value.cancellationCommitted) return "cancelled";
  if (value.prohibitedActivity) return "inconclusive";
  if (!value.evidenceValid || value.assertionStatuses.includes("unverifiable")) return "inconclusive";
  if (value.assertionStatuses.includes("failed")) return "failed";
  return "passed";
}

// Compatibility alias is V2-only; V1 Demo grade shapes no longer parse.
export const GradeResultSchema = GradeResultV2Schema;

export const FailureAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  summary: z.string().min(1).max(2_000),
  suggestedCategory: z.string().min(1).max(128).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  caveats: z.array(z.string().max(500)).max(10),
}).strict();

export type GradeAssertionStatus = z.infer<typeof GradeAssertionStatusSchema>;
export type GradeAssertionResult = z.infer<typeof GradeAssertionResultSchema>;
export type GradeResultV2 = z.infer<typeof GradeResultV2Schema>;
export type GradeResult = GradeResultV2;
export type GradeInputV2 = z.infer<typeof GradeInputV2Schema>;
export type UniversalDisposition = z.infer<typeof UniversalDispositionSchema>;
export type FailureAnalysis = z.infer<typeof FailureAnalysisSchema>;
