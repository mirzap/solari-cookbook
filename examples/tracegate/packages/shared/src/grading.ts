import { z } from "zod";
import { FailureRecordSchema } from "./errors.ts";
import { ObservationRevisionSchema, UtcDateTimeSchema } from "./ids.ts";
import { RunOutcomeSchema } from "./states.ts";
import { ScenarioIdSchema } from "./config.ts";
import { ChallengeIdSchema } from "./ids.ts";

export const GradePredicateNameSchema = z.enum([
  "exactly_one_line_item",
  "product_is_classic_tee",
  "size_is_m",
  "quantity_is_one",
]);

export const GradePredicateSchema = z.object({
  name: GradePredicateNameSchema,
  passed: z.boolean(),
  expected: z.string().max(1_000),
  actual: z.string().max(1_000),
});

export const DemoCartLineSchema = z.object({
  productSlug: z.string().trim().min(1).max(200),
  productName: z.string().trim().min(1).max(500),
  variant: z.record(z.string().max(100), z.string().max(500)),
  quantity: z.number().int().positive().max(100),
});

export const DemoGradeEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  challengeId: ChallengeIdSchema,
  revision: ObservationRevisionSchema,
  cart: z.array(DemoCartLineSchema).max(100),
  capturedAt: UtcDateTimeSchema,
});

const requiredPredicates = new Set(GradePredicateNameSchema.options);

export const GradeResultSchema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: ScenarioIdSchema,
  evidenceRevision: ObservationRevisionSchema.nullable(),
  outcome: RunOutcomeSchema,
  predicates: z.array(GradePredicateSchema).max(4),
  failure: FailureRecordSchema.nullable(),
  gradedAt: UtcDateTimeSchema,
}).superRefine((value, context) => {
  const names = value.predicates.map((predicate) => predicate.name);
  const complete = names.length === 4 && new Set(names).size === 4 && names.every((name) => requiredPredicates.has(name));
  if (value.outcome === "passed" || value.outcome === "failed") {
    if (!complete) context.addIssue({ code: "custom", path: ["predicates"], message: "gradeable outcomes require all four unique predicates" });
    if (value.failure !== null) context.addIssue({ code: "custom", path: ["failure"], message: "gradeable outcomes cannot carry infrastructure failure" });
  }
  if (value.outcome === "passed" && value.predicates.some((predicate) => !predicate.passed)) {
    context.addIssue({ code: "custom", path: ["predicates"], message: "passed outcome requires every predicate to pass" });
  }
  if (value.outcome === "failed" && value.predicates.every((predicate) => predicate.passed)) {
    context.addIssue({ code: "custom", path: ["predicates"], message: "failed outcome requires a failed predicate" });
  }
  if (value.outcome === "inconclusive" && value.failure === null) {
    context.addIssue({ code: "custom", path: ["failure"], message: "inconclusive outcome requires a safe failure" });
  }
});

export const FailureAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  summary: z.string().min(1).max(2_000),
  suggestedCategory: z.string().min(1).max(128).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  caveats: z.array(z.string().max(500)).max(10),
});

export type GradePredicateName = z.infer<typeof GradePredicateNameSchema>;
export type GradePredicate = z.infer<typeof GradePredicateSchema>;
export type DemoCartLine = z.infer<typeof DemoCartLineSchema>;
export type DemoGradeEvidence = z.infer<typeof DemoGradeEvidenceSchema>;
export type GradeResult = z.infer<typeof GradeResultSchema>;
export type FailureAnalysis = z.infer<typeof FailureAnalysisSchema>;
