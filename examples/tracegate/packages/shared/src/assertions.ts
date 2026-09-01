import { z } from "zod";
import { PublicHttpsUrlSchema, type PublicHttpsOrigin } from "./targets.ts";

export const AssertionIdSchema = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "assertion ID must be a stable identifier")
  .brand<"AssertionId">();

const assertionBase = {
  schemaVersion: z.literal(1),
  id: AssertionIdSchema,
  label: z.string().trim().min(1).max(200).optional(),
};

const urlAssertionBase = {
  ...assertionBase,
  kind: z.literal("url"),
  expectedUrl: PublicHttpsUrlSchema,
};

export const UrlQueryParameterSchema = z.object({
  name: z.string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_.~-]+$/, "query parameter name must use URL-safe characters"),
  value: z.string().max(500),
}).strict();

const ExactUrlAssertionSchema = z.object({
  ...urlAssertionBase,
  operator: z.literal("equals"),
}).strict();

const OriginAndPathUrlAssertionSchema = z.object({
  ...urlAssertionBase,
  operator: z.literal("origin_and_path_equals"),
}).strict();

const OriginPathQueryParameterUrlAssertionSchema = z.object({
  ...urlAssertionBase,
  operator: z.literal("origin_path_and_query_parameter_equals"),
  expectedUrl: PublicHttpsUrlSchema.refine((value) => {
    const expected = new URL(value);
    return expected.search === "" && expected.hash === "";
  }, "query-parameter URL assertions require an expected URL without query or fragment"),
  queryParameter: UrlQueryParameterSchema,
}).strict();

export const UrlAssertionSchema = z.discriminatedUnion("operator", [
  ExactUrlAssertionSchema,
  OriginAndPathUrlAssertionSchema,
  OriginPathQueryParameterUrlAssertionSchema,
]);

export const TextAssertionSchema = z.object({
  ...assertionBase,
  kind: z.literal("text"),
  scope: z.enum(["document_visible_text", "title"]),
  operator: z.enum(["contains", "not_contains", "equals"]),
  expected: z.string().min(1).max(500),
  caseSensitive: z.boolean(),
}).strict();

export const AccessibleNameMatcherSchema = z.object({
  operator: z.enum(["equals", "contains"]),
  value: z.string().min(1).max(500),
  caseSensitive: z.boolean(),
}).strict();

export const SemanticLocatorSchema = z.object({
  role: z.string().trim().min(1).max(100),
  accessibleName: AccessibleNameMatcherSchema,
}).strict();

export const SemanticCountMatcherSchema = z.object({
  operator: z.enum(["equals", "at_least", "at_most"]),
  value: z.number().int().min(0).max(20),
}).strict();

export const SemanticAssertionSchema = z.object({
  ...assertionBase,
  kind: z.literal("semantic"),
  locator: SemanticLocatorSchema,
  count: SemanticCountMatcherSchema,
}).strict();

const stateBase = {
  ...assertionBase,
  kind: z.literal("state"),
  locator: SemanticLocatorSchema,
};

export const StateAssertionSchema = z.discriminatedUnion("property", [
  z.object({ ...stateBase, property: z.literal("checked"), expected: z.boolean() }).strict(),
  z.object({ ...stateBase, property: z.literal("selected"), expected: z.boolean() }).strict(),
  z.object({ ...stateBase, property: z.literal("expanded"), expected: z.boolean() }).strict(),
  z.object({ ...stateBase, property: z.literal("disabled"), expected: z.boolean() }).strict(),
  z.object({ ...stateBase, property: z.literal("value"), expected: z.string().max(500) }).strict(),
]);

export const AssertionV1Schema = z.union([
  UrlAssertionSchema,
  TextAssertionSchema,
  SemanticAssertionSchema,
  StateAssertionSchema,
]);

export const AssertionSetV1Schema = z.array(AssertionV1Schema).min(1).max(20).superRefine((assertions, context) => {
  const ids = new Set<string>();
  assertions.forEach((assertion, index) => {
    if (ids.has(assertion.id)) context.addIssue({ code: "custom", path: [index, "id"], message: "assertion IDs must be unique" });
    ids.add(assertion.id);
  });
});

export interface UrlAssertionEvaluation {
  readonly matches: boolean;
  readonly expectedSummary: string;
  readonly actualSummary: string;
}

export function evaluateUrlAssertion(
  assertion: z.infer<typeof UrlAssertionSchema>,
  actualUrl: z.infer<typeof PublicHttpsUrlSchema>,
): UrlAssertionEvaluation {
  const actual = new URL(actualUrl);
  const expected = new URL(assertion.expectedUrl);
  if (assertion.operator === "equals") {
    const matches = actual.href === expected.href;
    return {
      matches,
      expectedSummary: "Final URL must exactly match the configured URL.",
      actualSummary: matches ? "Final URL exactly matched." : "Final URL did not exactly match.",
    };
  }

  const originAndPathMatch = actual.origin === expected.origin && actual.pathname === expected.pathname;
  if (assertion.operator === "origin_and_path_equals") {
    return {
      matches: originAndPathMatch,
      expectedSummary: "Final URL origin and path must match the configured URL.",
      actualSummary: originAndPathMatch
        ? "Final URL origin and path matched."
        : "Final URL origin and path did not match.",
    };
  }

  const values = actual.searchParams.getAll(assertion.queryParameter.name);
  const queryMatches = values.length === 1 && values[0] === assertion.queryParameter.value;
  const querySummary = values.length === 0
    ? "was missing"
    : values.length > 1
      ? "appeared more than once, so its value was ambiguous"
      : queryMatches
        ? "was present once and its value matched"
        : "was present once but its value did not match";
  return {
    matches: originAndPathMatch && queryMatches,
    expectedSummary: `Final URL origin/path and query parameter ${assertion.queryParameter.name} must match the configured values.`,
    actualSummary: `Final URL origin/path ${originAndPathMatch ? "matched" : "did not match"}; query parameter ${assertion.queryParameter.name} ${querySummary}.`,
  };
}

export function summarizeAssertionExpectation(assertion: z.infer<typeof AssertionV1Schema>): string {
  if (assertion.kind !== "url") return `${assertion.kind} assertion`;
  return evaluateUrlAssertion(assertion, assertion.expectedUrl).expectedSummary;
}

export function validateAssertionOrigins(
  assertions: readonly z.infer<typeof AssertionV1Schema>[],
  allowedOrigins: readonly PublicHttpsOrigin[],
  context: z.RefinementCtx,
): void {
  assertions.forEach((assertion, index) => {
    if (assertion.kind === "url" && !allowedOrigins.includes(new URL(assertion.expectedUrl).origin as PublicHttpsOrigin)) {
      context.addIssue({ code: "custom", path: ["assertions", index, "expectedUrl"], message: "expected URL origin must be declared" });
    }
  });
}

export type AssertionId = z.infer<typeof AssertionIdSchema>;
export type UrlAssertion = z.infer<typeof UrlAssertionSchema>;
export type TextAssertion = z.infer<typeof TextAssertionSchema>;
export type SemanticLocator = z.infer<typeof SemanticLocatorSchema>;
export type SemanticAssertion = z.infer<typeof SemanticAssertionSchema>;
export type StateAssertion = z.infer<typeof StateAssertionSchema>;
export type AssertionV1 = z.infer<typeof AssertionV1Schema>;
