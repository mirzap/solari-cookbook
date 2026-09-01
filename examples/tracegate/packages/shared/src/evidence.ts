import { z } from "zod";
import {
  AssertionIdSchema,
  evaluateUrlAssertion,
  summarizeAssertionExpectation,
  type AssertionV1,
} from "./assertions.ts";
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
  "title_truncated",
  "document_text_truncated",
  "semantic_matches_truncated",
  "state_value_truncated",
  "text_data_unavailable",
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

const UrlFieldUnavailableReasonSchema = z.enum([
  "capture_timeout",
  "policy_blocked",
  "target_unreachable",
  "evidence_invalid",
]);
const TextFieldUnavailableReasonSchema = z.enum([
  "capture_timeout",
  "text_data_unavailable",
  "policy_blocked",
  "target_unreachable",
  "evidence_invalid",
]);
const SemanticUnavailableReasonSchema = z.enum([
  "capture_timeout",
  "semantic_data_unavailable",
  "cross_origin_frame",
  "sensitive_control",
  "policy_blocked",
  "target_unreachable",
  "evidence_invalid",
]);

const TransientFinalUrlFieldV1Schema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("captured"), value: PublicHttpsUrlSchema }).strict(),
  z.object({ status: z.literal("unavailable"), reasonCode: UrlFieldUnavailableReasonSchema }).strict(),
]);

const TransientTitleFieldV1Schema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("captured"),
    value: z.string().max(16_384),
    truncated: z.boolean(),
  }).strict().superRefine((value, context) => {
    if (value.truncated && value.value.length <= 500) {
      context.addIssue({ code: "custom", path: ["value"], message: "a truncated title capture must retain enough text to decide bounded equality honestly" });
    }
  }),
  z.object({ status: z.literal("unavailable"), reasonCode: TextFieldUnavailableReasonSchema }).strict(),
]);

const TransientDocumentTextFieldV1Schema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("captured"),
    value: z.string().max(262_144),
    truncated: z.boolean(),
  }).strict().superRefine((value, context) => {
    if (value.truncated && value.value.length <= 500) {
      context.addIssue({ code: "custom", path: ["value"], message: "a truncated document-text capture must retain enough text to decide bounded equality honestly" });
    }
  }),
  z.object({ status: z.literal("unavailable"), reasonCode: TextFieldUnavailableReasonSchema }).strict(),
]);

const assertionCaptureBase = {
  assertionId: AssertionIdSchema,
};

const CapturedSemanticAssertionValueV1Schema = z.object({
  ...assertionCaptureBase,
  kind: z.literal("semantic"),
  status: z.literal("captured"),
  matchedCount: z.number().int().min(0).max(21),
  truncated: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.truncated && value.matchedCount !== 21) {
    context.addIssue({ code: "custom", path: ["matchedCount"], message: "truncated semantic counts must retain the supported assertion ceiling plus one" });
  }
});

const CapturedStateAssertionValueV1Schema = z.object({
  ...assertionCaptureBase,
  kind: z.literal("state"),
  status: z.literal("captured"),
  property: z.enum(["checked", "selected", "expanded", "disabled", "value"]),
  matchedCount: z.number().int().min(0).max(2),
  matchesTruncated: z.boolean(),
  actualValue: z.union([z.boolean(), z.string().max(500)]).nullable(),
  valueTruncated: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.matchesTruncated && value.matchedCount !== 2) {
    context.addIssue({ code: "custom", path: ["matchedCount"], message: "truncated state matches must retain enough matches to prove ambiguity" });
  }
  if (value.matchedCount !== 1 && value.actualValue !== null) {
    context.addIssue({ code: "custom", path: ["actualValue"], message: "state is captured only for exactly one semantic match" });
  }
  if (value.valueTruncated && (typeof value.actualValue !== "string" || value.actualValue.length !== 500)) {
    context.addIssue({ code: "custom", path: ["valueTruncated"], message: "truncated state values must retain the complete bounded prefix" });
  }
  if (typeof value.actualValue === "boolean" && value.valueTruncated) {
    context.addIssue({ code: "custom", path: ["valueTruncated"], message: "boolean state cannot be truncated" });
  }
});

const UnavailableSemanticAssertionValueV1Schema = z.object({
  ...assertionCaptureBase,
  kind: z.literal("semantic"),
  status: z.literal("unavailable"),
  reasonCode: SemanticUnavailableReasonSchema,
}).strict();

const UnavailableStateAssertionValueV1Schema = z.object({
  ...assertionCaptureBase,
  kind: z.literal("state"),
  status: z.literal("unavailable"),
  reasonCode: SemanticUnavailableReasonSchema,
}).strict();

export const TransientSemanticStateAssertionValueV1Schema = z.union([
  CapturedSemanticAssertionValueV1Schema,
  CapturedStateAssertionValueV1Schema,
  UnavailableSemanticAssertionValueV1Schema,
  UnavailableStateAssertionValueV1Schema,
]);

/**
 * Assertion-only browser state. This larger bounded envelope is transient and
 * must never enter agent prompts, tool results, traces, events, or durable
 * storage. Title and document text are captured once under independent bounds;
 * semantic names are matched in-page and leave only per-assertion count/state.
 */
export const TransientAssertionSnapshotV1Schema = z.object({
  schemaVersion: z.literal(1),
  finalUrl: TransientFinalUrlFieldV1Schema,
  title: TransientTitleFieldV1Schema.nullable(),
  documentVisibleText: TransientDocumentTextFieldV1Schema.nullable(),
  documentId: z.string().min(1).max(512),
  loaderId: z.string().min(1).max(512),
  policyActivity: PolicyActivitySummarySchema,
  semanticStateValues: z.array(TransientSemanticStateAssertionValueV1Schema).max(20),
}).strict().superRefine((value, context) => {
  const ids = value.semanticStateValues.map((item) => item.assertionId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["semanticStateValues"], message: "assertion snapshot IDs must be unique" });
  }
});

function unverifiable(
  assertion: AssertionV1,
  reasonCode: z.infer<typeof AssertionUnverifiableCodeSchema>,
  actualSummary: string,
): z.infer<typeof CanonicalAssertionObservationSchema> {
  return CanonicalAssertionObservationSchema.parse({
    assertionId: assertion.id,
    status: "unverifiable",
    observedResult: null,
    expectedSummary: summarizeAssertionExpectation(assertion),
    actualSummary,
    reasonCode,
  });
}

function observed(
  assertion: AssertionV1,
  observedResult: boolean,
  expectedSummary: string,
  actualSummary: string,
): z.infer<typeof CanonicalAssertionObservationSchema> {
  return CanonicalAssertionObservationSchema.parse({
    assertionId: assertion.id,
    status: "observed",
    observedResult,
    expectedSummary,
    actualSummary,
    reasonCode: null,
  });
}

function comparable(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase("en-US");
}

function unavailableSummary(reasonCode: z.infer<typeof AssertionUnverifiableCodeSchema>): string {
  const summaries: Partial<Record<z.infer<typeof AssertionUnverifiableCodeSchema>, string>> = {
    capture_timeout: "The assertion-specific browser capture timed out.",
    page_unstable: "Assertion-relevant browser state did not stabilize.",
    title_truncated: "The title capture was truncated before the predicate could be decided.",
    document_text_truncated: "The visible document text capture was truncated before the predicate could be decided.",
    semantic_matches_truncated: "The assertion-specific semantic match set was truncated before the count could be decided.",
    state_value_truncated: "The requested state value was truncated before equality could be decided.",
    text_data_unavailable: "The requested browser text field was unavailable.",
    semantic_data_unavailable: "Assertion-specific semantic data was unavailable.",
    cross_origin_frame: "The assertion target was inside an unsupported cross-origin frame.",
    sensitive_control: "The assertion target was a sensitive control whose state cannot be captured.",
    policy_blocked: "Browser policy prevented assertion capture.",
    target_unreachable: "The target was unreachable during assertion capture.",
    evidence_invalid: "The assertion-specific browser evidence was invalid.",
    observation_truncated: "Legacy model-observation evidence was truncated.",
    semantic_match_ambiguous: "More than one semantic element matched the state assertion.",
    unsupported_state: "The requested element state was unavailable.",
  };
  return summaries[reasonCode] ?? "The assertion could not be verified.";
}

/**
 * Projects one assertion from the dedicated transient capture into the exact
 * bounded record that may be persisted and graded. URL operators, including
 * query-parameter equality, have one authoritative evaluator here.
 */
export function evaluateCapturedAssertion(
  assertion: AssertionV1,
  snapshot: z.infer<typeof TransientAssertionSnapshotV1Schema>,
): z.infer<typeof CanonicalAssertionObservationSchema> {
  if (assertion.kind === "url") {
    if (snapshot.finalUrl.status === "unavailable") {
      return unverifiable(assertion, snapshot.finalUrl.reasonCode, unavailableSummary(snapshot.finalUrl.reasonCode));
    }
    const result = evaluateUrlAssertion(assertion, snapshot.finalUrl.value);
    return observed(assertion, result.matches, result.expectedSummary, result.actualSummary);
  }

  if (assertion.kind === "text") {
    const captured = assertion.scope === "title" ? snapshot.title : snapshot.documentVisibleText;
    if (captured === null) {
      return unverifiable(assertion, "evidence_invalid", "The requested text field was missing from assertion capture.");
    }
    if (captured.status === "unavailable") {
      return unverifiable(assertion, captured.reasonCode, unavailableSummary(captured.reasonCode));
    }
    const actual = comparable(captured.value, assertion.caseSensitive);
    const expected = comparable(assertion.expected, assertion.caseSensitive);
    const contains = actual.includes(expected);
    if (captured.truncated) {
      if (assertion.operator === "contains" && contains) {
        return observed(assertion, true, summarizeAssertionExpectation(assertion), "The text predicate matched within the captured prefix.");
      }
      if (assertion.operator === "not_contains" && contains) {
        return observed(assertion, false, summarizeAssertionExpectation(assertion), "The excluded text was present within the captured prefix.");
      }
      if (assertion.operator === "equals") {
        return observed(assertion, false, summarizeAssertionExpectation(assertion), "The captured field exceeded the maximum expected-value length and could not be equal.");
      }
      const code = assertion.scope === "title" ? "title_truncated" : "document_text_truncated";
      return unverifiable(assertion, code, unavailableSummary(code));
    }
    const result = assertion.operator === "equals"
      ? actual === expected
      : assertion.operator === "contains"
        ? contains
        : !contains;
    return observed(
      assertion,
      result,
      summarizeAssertionExpectation(assertion),
      result ? "The text predicate matched." : "The text predicate did not match.",
    );
  }

  const captured = snapshot.semanticStateValues.find((item) => item.assertionId === assertion.id);
  if (captured === undefined || captured.kind !== assertion.kind) {
    return unverifiable(assertion, "evidence_invalid", "Assertion-specific semantic browser evidence was missing or mismatched.");
  }
  if (captured.status === "unavailable") {
    return unverifiable(assertion, captured.reasonCode, unavailableSummary(captured.reasonCode));
  }

  if (assertion.kind === "semantic") {
    if (captured.kind !== "semantic") {
      return unverifiable(assertion, "evidence_invalid", "Semantic count evidence did not match the assertion.");
    }
    const count = captured.matchedCount;
    const result = assertion.count.operator === "equals"
      ? count === assertion.count.value
      : assertion.count.operator === "at_least"
        ? count >= assertion.count.value
        : count <= assertion.count.value;
    const decidedDespiteTruncation = assertion.count.operator === "equals"
      ? count > assertion.count.value
      : assertion.count.operator === "at_least"
        ? count >= assertion.count.value
        : count > assertion.count.value;
    if (captured.truncated && !decidedDespiteTruncation) {
      return unverifiable(assertion, "semantic_matches_truncated", unavailableSummary("semantic_matches_truncated"));
    }
    const qualifier = captured.truncated ? "at least " : "";
    return observed(
      assertion,
      result,
      summarizeAssertionExpectation(assertion),
      `Observed ${qualifier}${count} assertion-specific semantic matches.`,
    );
  }

  if (captured.kind !== "state" || captured.property !== assertion.property) {
    return unverifiable(assertion, "evidence_invalid", "State evidence did not match the assertion property.");
  }
  if (captured.matchesTruncated || captured.matchedCount > 1) {
    return unverifiable(assertion, "semantic_match_ambiguous", unavailableSummary("semantic_match_ambiguous"));
  }
  if (captured.matchedCount === 0) {
    return observed(assertion, false, summarizeAssertionExpectation(assertion), "No semantic element matched the state assertion.");
  }
  if (captured.actualValue === null) {
    return unverifiable(assertion, "unsupported_state", unavailableSummary("unsupported_state"));
  }
  if (typeof captured.actualValue !== typeof assertion.expected) {
    return unverifiable(assertion, "evidence_invalid", "The captured state value had an incompatible type.");
  }
  if (captured.valueTruncated) {
    return observed(
      assertion,
      false,
      summarizeAssertionExpectation(assertion),
      "The complete state value exceeded the maximum expected-value length and could not be equal.",
    );
  }
  const result = captured.actualValue === assertion.expected;
  return observed(
    assertion,
    result,
    summarizeAssertionExpectation(assertion),
    result ? "The element state matched." : "The element state did not match.",
  );
}

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
export type TransientSemanticStateAssertionValueV1 = z.infer<typeof TransientSemanticStateAssertionValueV1Schema>;
export type TransientAssertionSnapshotV1 = z.infer<typeof TransientAssertionSnapshotV1Schema>;
export type TransientCanonicalCaptureV1 = z.infer<typeof TransientCanonicalCaptureV1Schema>;
export type BrowserAssertionEvidenceV1 = z.infer<typeof BrowserAssertionEvidenceV1Schema>;
export type AssertionCaptureResult = z.infer<typeof AssertionCaptureResultSchema>;
