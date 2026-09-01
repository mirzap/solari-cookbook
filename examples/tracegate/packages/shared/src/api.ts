import { z } from "zod";

import { PublicEvaluationConfigInputSchema } from "./config.ts";
import { ControlErrorSchema, FailureRecordSchema, RunWarningSchema } from "./errors.ts";
import { EventEnvelopeSchema } from "./events.ts";
import { EvaluationIdSchema, RunIdSchema, UtcDateTimeSchema, EventCursorSchema } from "./ids.ts";
import { ModelIdSchema } from "./models.ts";
import { EvaluationStatusSchema, RunOutcomeSchema, RunStatusSchema } from "./states.ts";

export const CreateEvaluationRequestSchema = PublicEvaluationConfigInputSchema;
export type CreateEvaluationRequest = z.infer<typeof CreateEvaluationRequestSchema>;

export const CreateEvaluationResponseSchema = z.object({
  evaluationId: EvaluationIdSchema,
  status: EvaluationStatusSchema,
  runIds: z.array(RunIdSchema).min(1).max(15),
  latestCursor: EventCursorSchema.nullable(),
});
export type CreateEvaluationResponse = z.infer<typeof CreateEvaluationResponseSchema>;

export const RunSnapshotSchema = z.object({
  id: RunIdSchema,
  runIndex: z.number().int().nonnegative(),
  modelId: ModelIdSchema,
  status: RunStatusSchema,
  outcome: RunOutcomeSchema.nullable(),
  startedAt: UtcDateTimeSchema.nullable(),
  finishedAt: UtcDateTimeSchema.nullable(),
  iterations: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  browserActions: z.number().int().nonnegative(),
  failure: FailureRecordSchema.nullable(),
  warnings: z.array(RunWarningSchema),
  potentialSessionLeak: z.boolean(),
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

const AggregateRateSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  value: z.number().min(0).max(1).nullable(),
}).superRefine((rate, context) => {
  if ((rate.denominator === 0) !== (rate.value === null)) {
    context.addIssue({ code: "custom", path: ["value"], message: "value must be null exactly when denominator is zero" });
  }
  if (rate.numerator > rate.denominator) {
    context.addIssue({ code: "custom", path: ["numerator"], message: "numerator cannot exceed denominator" });
  }
});

export const EvaluationAggregateSchema = z.object({
  requested: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  passRate: AggregateRateSchema,
});
export type EvaluationAggregate = z.infer<typeof EvaluationAggregateSchema>;

export const EvaluationSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  evaluationId: EvaluationIdSchema,
  status: EvaluationStatusSchema,
  config: PublicEvaluationConfigInputSchema,
  createdAt: UtcDateTimeSchema,
  startedAt: UtcDateTimeSchema.nullable(),
  finishedAt: UtcDateTimeSchema.nullable(),
  aggregate: EvaluationAggregateSchema,
  runs: z.array(RunSnapshotSchema).max(15),
  latestCursor: EventCursorSchema.nullable(),
});
export type EvaluationSnapshot = z.infer<typeof EvaluationSnapshotSchema>;

export const EventListResponseSchema = z.object({
  events: z.array(EventEnvelopeSchema),
  earliestCursor: EventCursorSchema.nullable(),
  latestCursor: EventCursorSchema.nullable(),
});
export type EventListResponse = z.infer<typeof EventListResponseSchema>;

export const ApiErrorSchema = z.object({ error: ControlErrorSchema });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]),
  checkedAt: UtcDateTimeSchema,
  dependencies: z.record(z.string(), z.enum(["ok", "degraded", "unavailable"])),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
