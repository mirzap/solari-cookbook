import { z } from "zod";
import { AssertionSetV1Schema, validateAssertionOrigins } from "./assertions.ts";
import { ModelIdSchema } from "./models.ts";
import { PublicEvaluationTargetV2Schema } from "./targets.ts";

export const InterfaceModeSchema = z.enum(["auto", "semantic-only"]);
export const SafetyPolicyVersionSchema = z.literal("public-safe-v1");

export const ProviderRoutingSchema = z.object({
  allowProviders: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  order: z.enum(["price", "latency", "throughput"]).nullable().default(null),
}).strict();

export const SamplingConfigSchema = z.object({
  temperature: z.number().finite().min(0).max(2).default(0.2),
  topP: z.number().finite().gt(0).max(1).default(1),
  providerRouting: ProviderRoutingSchema.nullable().default(null),
}).strict();

export const RuntimeBudgetsSchema = z.object({
  wallClockMs: z.number().int().min(15_000).max(300_000).default(120_000),
  maxModelTurns: z.number().int().min(1).max(30).default(15),
  maxToolCalls: z.number().int().min(1).max(100).default(40),
  maxBrowserActions: z.number().int().min(1).max(60).default(25),
  toolTimeoutMs: z.number().int().min(1_000).max(30_000).default(15_000),
  maxObservationBytes: z.number().int().min(2_048).max(32_768).default(12_288),
  maxHistoryBytes: z.number().int().min(16_384).max(262_144).default(96_000),
  maxTotalTokens: z.number().int().safe().positive().max(1_000_000).default(100_000),
}).strict();

export const PublicEvaluationConfigV2Schema = z.object({
  schemaVersion: z.literal(2),
  target: PublicEvaluationTargetV2Schema,
  prompt: z.string().trim().min(1).max(1_000),
  assertions: AssertionSetV1Schema,
  safetyPolicyVersion: SafetyPolicyVersionSchema,
  modelIds: z.array(ModelIdSchema).min(1).max(3),
  requestedRunsPerModel: z.number().int().min(1).max(5).default(3),
  requestedConcurrency: z.number().int().min(1).max(5).default(3),
  interfaceMode: InterfaceModeSchema.default("auto"),
  webMcpReadOnlyEnabled: z.boolean().default(false),
  recordingRequested: z.boolean().default(false),
  sampling: SamplingConfigSchema.default({ temperature: 0.2, topP: 1, providerRouting: null }),
  budgets: RuntimeBudgetsSchema.default({
    wallClockMs: 120_000,
    maxModelTurns: 15,
    maxToolCalls: 40,
    maxBrowserActions: 25,
    toolTimeoutMs: 15_000,
    maxObservationBytes: 12_288,
    maxHistoryBytes: 96_000,
    maxTotalTokens: 100_000,
  }),
}).strict().superRefine((value, context) => {
  if (new Set(value.modelIds).size !== value.modelIds.length) {
    context.addIssue({ code: "custom", path: ["modelIds"], message: "model IDs must be unique" });
  }
  if (value.modelIds.length * value.requestedRunsPerModel > 15) {
    context.addIssue({ code: "custom", path: ["requestedRunsPerModel"], message: "total requested runs cannot exceed 15" });
  }
  if (value.budgets.toolTimeoutMs > value.budgets.wallClockMs) {
    context.addIssue({ code: "custom", path: ["budgets", "toolTimeoutMs"], message: "tool timeout cannot exceed wall clock budget" });
  }
  validateAssertionOrigins(value.assertions, value.target.allowedNavigationOrigins, context);
});

// Compatibility aliases intentionally point to V2. V1 input is unsupported and will fail schemaVersion/shape checks.
export const EvaluationConfigSchema = PublicEvaluationConfigV2Schema;
export const PublicEvaluationConfigInputSchema = PublicEvaluationConfigV2Schema;

export type InterfaceMode = z.infer<typeof InterfaceModeSchema>;
export type SafetyPolicyVersion = z.infer<typeof SafetyPolicyVersionSchema>;
export type PublicEvaluationConfigV2 = z.infer<typeof PublicEvaluationConfigV2Schema>;
export type EvaluationConfig = PublicEvaluationConfigV2;
export type PublicEvaluationConfigInput = PublicEvaluationConfigV2;
export type RuntimeBudgets = z.infer<typeof RuntimeBudgetsSchema>;
