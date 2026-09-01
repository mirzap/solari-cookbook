import { z } from "zod";
import { TokenUsageSchema } from "./agent.ts";
import { EvaluationConfigSchema } from "./config.ts";
import { ControlErrorSchema, FailureRecordSchema, RunWarningSchema } from "./errors.ts";
import { GradeResultSchema } from "./grading.ts";
import {
  BrowserSessionIdSchema,
  EvaluationIdSchema,
  ObservationRevisionSchema,
  RunIdSchema,
  RunSequenceSchema,
  UtcDateTimeSchema,
} from "./ids.ts";
import { JsonObjectSchema } from "./json.ts";
import { InterfaceUsageSummarySchema } from "./mcp.ts";
import { ModelIdSchema } from "./models.ts";
import {
  EvaluationStatusSchema,
  ReleaseStatusSchema,
  ReplayStatusSchema,
  RunOutcomeSchema,
  RunStatusSchema,
} from "./states.ts";

export const EvaluationSchema = z.object({
  schemaVersion: z.literal(2),
  id: EvaluationIdSchema,
  config: EvaluationConfigSchema,
  status: EvaluationStatusSchema,
  createdAt: UtcDateTimeSchema,
  startedAt: UtcDateTimeSchema.nullable(),
  finishedAt: UtcDateTimeSchema.nullable(),
  failure: ControlErrorSchema.nullable(),
}).superRefine((value, context) => {
  const terminal = value.status === "completed" || value.status === "cancelled" || value.status === "failed";
  if (terminal !== (value.finishedAt !== null)) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: "finishedAt must match terminal status" });
  }
});

export const RunSchema = z.object({
  schemaVersion: z.literal(2),
  id: RunIdSchema,
  evaluationId: EvaluationIdSchema,
  runIndex: z.number().int().nonnegative(),
  modelId: ModelIdSchema,
  resolvedProvider: z.string().min(1).max(200).nullable(),
  status: RunStatusSchema,
  outcome: RunOutcomeSchema.nullable(),
  createdAt: UtcDateTimeSchema,
  startedAt: UtcDateTimeSchema.nullable(),
  finishedAt: UtcDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  iterations: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  browserActions: z.number().int().nonnegative(),
  interfaceUsage: InterfaceUsageSummarySchema.optional(),
  usage: TokenUsageSchema,
  failure: FailureRecordSchema.nullable(),
  grade: GradeResultSchema.nullable(),
  replayStatus: ReplayStatusSchema,
  releaseStatus: ReleaseStatusSchema,
  warnings: z.array(RunWarningSchema).max(50),
  potentialSessionLeak: z.boolean(),
}).superRefine((value, context) => {
  if (value.status === "completed" && value.outcome === null) {
    context.addIssue({ code: "custom", path: ["outcome"], message: "completed run requires outcome" });
  }
  if (value.status !== "completed" && value.outcome !== null) {
    context.addIssue({ code: "custom", path: ["outcome"], message: "only completed runs may have outcome" });
  }
  if (value.status === "completed" && value.grade === null) {
    context.addIssue({ code: "custom", path: ["grade"], message: "completed run requires a grade" });
  }
  if (value.grade !== null && value.outcome !== value.grade.outcome) {
    context.addIssue({ code: "custom", path: ["grade", "outcome"], message: "grade outcome must match run outcome" });
  }
  if (value.outcome === "passed" && value.failure !== null) {
    context.addIssue({ code: "custom", path: ["failure"], message: "passed run cannot carry terminal failure" });
  }
  if ((value.outcome === "failed" || value.outcome === "inconclusive") && value.failure?.outcome !== value.outcome) {
    context.addIssue({ code: "custom", path: ["failure"], message: "non-passing outcome requires matching terminal failure" });
  }
  if (value.grade !== null && JSON.stringify(value.grade.failure) !== JSON.stringify(value.failure)) {
    context.addIssue({ code: "custom", path: ["failure"], message: "run and grade must share the authoritative terminal failure" });
  }
  if (value.status === "cancelled" && (value.grade !== null || value.failure !== null)) {
    context.addIssue({ code: "custom", path: ["grade"], message: "cancelled run has no grade or terminal failure" });
  }
  const terminal = value.status === "completed" || value.status === "cancelled";
  if (terminal !== (value.finishedAt !== null)) {
    context.addIssue({ code: "custom", path: ["finishedAt"], message: "finishedAt must match terminal status" });
  }
});

export const RunStepSchema = z.object({
  schemaVersion: z.literal(2),
  runId: RunIdSchema,
  sequence: RunSequenceSchema,
  kind: z.enum(["browser_action", "tool", "model", "discovery", "grading", "warning"]),
  payload: JsonObjectSchema,
  interactionMode: z.enum(["semantic", "safe_tool", "system"]),
  observationRevision: ObservationRevisionSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  occurredAt: UtcDateTimeSchema,
});

export const BrowserSessionSummarySchema = z.object({
  schemaVersion: z.literal(2),
  runId: RunIdSchema,
  providerSessionId: BrowserSessionIdSchema,
  region: z.string().min(1).max(100).nullable(),
  acquiredAt: UtcDateTimeSchema,
  releasedAt: UtcDateTimeSchema.nullable(),
  releaseStatus: ReleaseStatusSchema,
  releaseConfirmed: z.boolean(),
  replayStatus: ReplayStatusSchema,
  recordingRequested: z.boolean(),
}).superRefine((value, context) => {
  if ((value.releaseStatus === "released") !== value.releaseConfirmed) {
    context.addIssue({ code: "custom", path: ["releaseConfirmed"], message: "only explicitly confirmed release may use released status" });
  }
  if (value.releaseConfirmed !== (value.releasedAt !== null)) {
    context.addIssue({ code: "custom", path: ["releasedAt"], message: "releasedAt exists exactly for confirmed release" });
  }
});

export type Evaluation = z.infer<typeof EvaluationSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunStep = z.infer<typeof RunStepSchema>;
export type BrowserSessionSummary = z.infer<typeof BrowserSessionSummarySchema>;
export type { AgentObservation } from "./agent.ts";
