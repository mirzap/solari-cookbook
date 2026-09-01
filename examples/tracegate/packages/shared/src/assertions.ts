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

export const UrlAssertionSchema = z.object({
  ...assertionBase,
  kind: z.literal("url"),
  operator: z.enum(["equals", "origin_and_path_equals"]),
  expectedUrl: PublicHttpsUrlSchema,
}).strict();

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
