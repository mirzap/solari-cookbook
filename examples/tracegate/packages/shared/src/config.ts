import { z } from "zod";
import { ModelIdSchema } from "./models.ts";

export const ScenarioIdSchema = z.literal("classic-tee-size-m-v1");
export const InterfaceModeSchema = z.enum(["auto", "semantic-only", "native-allowed"]);

const httpsUrl = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:") context.addIssue({ code: "custom", message: "must use HTTPS" });
  if (url.username || url.password) context.addIssue({ code: "custom", message: "credentials are forbidden" });
});

const adminUrl = z.url().superRefine((value, context) => {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    context.addIssue({ code: "custom", message: "admin URL must use HTTPS or loopback HTTP" });
  }
  if (url.username || url.password) context.addIssue({ code: "custom", message: "credentials are forbidden" });
});

export const PublicEvaluationTargetSchema = z.object({
  kind: z.literal("tracegate-demo-store"),
  publicBaseUrl: httpsUrl,
  scenarioId: ScenarioIdSchema,
});

export const EvaluationTargetSchema = PublicEvaluationTargetSchema.extend({
  adminBaseUrl: adminUrl,
});

export const ProviderRoutingSchema = z.object({
  allowProviders: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  order: z.enum(["price", "latency", "throughput"]).nullable().default(null),
});

export const SamplingConfigSchema = z.object({
  temperature: z.number().finite().min(0).max(2).default(0.2),
  topP: z.number().finite().gt(0).max(1).default(1),
  providerRouting: ProviderRoutingSchema.nullable().default(null),
});

export const RuntimeBudgetsSchema = z.object({
  wallClockMs: z.number().int().min(15_000).max(300_000).default(120_000),
  maxModelTurns: z.number().int().min(1).max(30).default(15),
  maxToolCalls: z.number().int().min(1).max(100).default(40),
  maxBrowserActions: z.number().int().min(1).max(60).default(25),
  toolTimeoutMs: z.number().int().min(1_000).max(30_000).default(15_000),
  maxObservationBytes: z.number().int().min(2_048).max(32_768).default(12_288),
  maxHistoryBytes: z.number().int().min(16_384).max(262_144).default(96_000),
  maxTotalTokens: z.number().int().safe().positive().max(1_000_000).default(100_000),
});

const configFields = {
  schemaVersion: z.literal(1),
  goal: z.string().trim().min(1).max(1_000),
  successCriterion: z.string().trim().min(1).max(1_000),
  modelIds: z.array(ModelIdSchema).min(1).max(3),
  requestedRunsPerModel: z.number().int().min(1).max(5).default(3),
  requestedConcurrency: z.number().int().min(1).max(5).default(3),
  interfaceMode: InterfaceModeSchema.default("auto"),
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
  allowedOrigins: z.array(z.url()).min(1).max(5),
};

function validateConfig(value: {
  target: { publicBaseUrl: string };
  modelIds: readonly string[];
  requestedRunsPerModel: number;
  allowedOrigins: readonly string[];
  budgets: { toolTimeoutMs: number; wallClockMs: number };
}, context: z.RefinementCtx) {
  if (new Set(value.modelIds).size !== value.modelIds.length) {
    context.addIssue({ code: "custom", path: ["modelIds"], message: "model IDs must be unique" });
  }
  if (value.modelIds.length * value.requestedRunsPerModel > 15) {
    context.addIssue({ code: "custom", path: ["requestedRunsPerModel"], message: "total requested runs cannot exceed 15" });
  }
  if (value.budgets.toolTimeoutMs > value.budgets.wallClockMs) {
    context.addIssue({ code: "custom", path: ["budgets", "toolTimeoutMs"], message: "tool timeout cannot exceed wall clock budget" });
  }
  const expectedOrigin = new URL(value.target.publicBaseUrl).origin;
  const canonicalOrigins = value.allowedOrigins.map((origin, index) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      context.addIssue({ code: "custom", path: ["allowedOrigins", index], message: "must be an exact origin" });
    }
    return parsed.origin;
  });
  if (canonicalOrigins.length !== 1 || canonicalOrigins[0] !== expectedOrigin) {
    context.addIssue({ code: "custom", path: ["allowedOrigins"], message: "must contain only the target public origin" });
  }
}

export const EvaluationConfigSchema = z.object({
  ...configFields,
  target: EvaluationTargetSchema,
}).superRefine(validateConfig);

export const PublicEvaluationConfigInputSchema = z.object({
  ...configFields,
  target: PublicEvaluationTargetSchema,
}).superRefine(validateConfig);

export const ResolvedTargetRuntimeConfigSchema = z.object({
  publicBaseUrl: httpsUrl,
  adminBaseUrl: adminUrl,
  scenarioId: ScenarioIdSchema,
});

export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
export type InterfaceMode = z.infer<typeof InterfaceModeSchema>;
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>;
export type PublicEvaluationConfigInput = z.infer<typeof PublicEvaluationConfigInputSchema>;
export type RuntimeBudgets = z.infer<typeof RuntimeBudgetsSchema>;
export type ResolvedTargetRuntimeConfig = z.infer<typeof ResolvedTargetRuntimeConfigSchema>;
