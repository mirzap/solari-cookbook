import { z } from "zod";
import { AssertionSetV1Schema } from "./assertions.ts";
import { PublicEvaluationConfigV2Schema } from "./config.ts";
import { ControlErrorSchema, FailureRecordSchema, RunWarningSchema } from "./errors.ts";
import { AgentTraceEventSchema, EventEnvelopeSchema } from "./events.ts";
import { GradeResultV2Schema } from "./grading.ts";
import { EventCursorSchema, EvaluationIdSchema, RunIdSchema, UtcDateTimeSchema } from "./ids.ts";
import { ModelIdSchema } from "./models.ts";
import { PublicHttpsOriginSchema } from "./targets.ts";
import { EvaluationStatusSchema, RunOutcomeSchema, RunStatusSchema } from "./states.ts";

export const CreateEvaluationRequestSchema = PublicEvaluationConfigV2Schema;
export type CreateEvaluationRequest = z.infer<typeof CreateEvaluationRequestSchema>;

export const CreateEvaluationResponseSchema = z.object({
  evaluationId: EvaluationIdSchema, status: EvaluationStatusSchema,
  runIds: z.array(RunIdSchema).min(1).max(15), latestCursor: EventCursorSchema.nullable(),
}).strict();
export type CreateEvaluationResponse = z.infer<typeof CreateEvaluationResponseSchema>;

export const RunSnapshotSchema = z.object({
  id: RunIdSchema, runIndex: z.number().int().nonnegative(), modelId: ModelIdSchema,
  status: RunStatusSchema, outcome: RunOutcomeSchema.nullable(), startedAt: UtcDateTimeSchema.nullable(), finishedAt: UtcDateTimeSchema.nullable(),
  iterations: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), browserActions: z.number().int().nonnegative(),
  failure: FailureRecordSchema.nullable(), grade: GradeResultV2Schema.nullable(), warnings: z.array(RunWarningSchema).max(50), potentialSessionLeak: z.boolean(),
}).strict();
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

export const AggregateRateSchema = z.object({
  numerator: z.number().int().nonnegative(), denominator: z.number().int().nonnegative(), value: z.number().min(0).max(1).nullable(),
}).strict().superRefine((rate, context) => {
  if ((rate.denominator === 0) !== (rate.value === null)) context.addIssue({ code: "custom", path: ["value"], message: "value must be null exactly for zero denominator" });
  if (rate.numerator > rate.denominator) context.addIssue({ code: "custom", path: ["numerator"], message: "numerator cannot exceed denominator" });
  if (rate.denominator > 0 && rate.value !== null && Math.abs(rate.value - rate.numerator / rate.denominator) > 1e-12) context.addIssue({ code: "custom", path: ["value"], message: "value must equal numerator / denominator" });
});

export const EvaluationAggregateV2Schema = z.object({
  requested: z.number().int().nonnegative(), started: z.number().int().nonnegative(), passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(), inconclusive: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative(),
  nonterminal: z.number().int().nonnegative(), potentialLeaks: z.number().int().nonnegative(),
  endToEndPassRate: AggregateRateSchema, gradeableObservableStateSuccess: AggregateRateSchema,
}).strict().superRefine((value, context) => {
  if (value.requested !== value.passed + value.failed + value.inconclusive + value.cancelled + value.nonterminal) context.addIssue({ code: "custom", path: ["requested"], message: "requested must equal terminal outcomes plus nonterminal" });
  if (value.started > value.requested || value.potentialLeaks > value.requested) context.addIssue({ code: "custom", message: "started and potential leaks cannot exceed requested" });
  if (value.started < value.passed + value.failed + value.inconclusive + value.cancelled) context.addIssue({ code: "custom", path: ["started"], message: "every terminal run must have transitioned out of queued" });
  if (value.endToEndPassRate.numerator !== value.passed || value.endToEndPassRate.denominator !== value.requested) context.addIssue({ code: "custom", path: ["endToEndPassRate"], message: "end-to-end rate must be passed/requested" });
  if (value.gradeableObservableStateSuccess.numerator !== value.passed || value.gradeableObservableStateSuccess.denominator !== value.passed + value.failed) context.addIssue({ code: "custom", path: ["gradeableObservableStateSuccess"], message: "gradeable rate must be passed/(passed+failed)" });
});
export const EvaluationAggregateSchema = EvaluationAggregateV2Schema;
export type EvaluationAggregateV2 = z.infer<typeof EvaluationAggregateV2Schema>;
export type EvaluationAggregate = EvaluationAggregateV2;

export const EvaluationSnapshotSchema = z.object({
  schemaVersion: z.literal(2), evaluationId: EvaluationIdSchema, status: EvaluationStatusSchema,
  config: PublicEvaluationConfigV2Schema, createdAt: UtcDateTimeSchema, startedAt: UtcDateTimeSchema.nullable(), finishedAt: UtcDateTimeSchema.nullable(),
  aggregate: EvaluationAggregateV2Schema, runs: z.array(RunSnapshotSchema).max(15), latestCursor: EventCursorSchema.nullable(),
}).strict();
export type EvaluationSnapshot = z.infer<typeof EvaluationSnapshotSchema>;

export const MAX_BOUNDED_RESPONSE_BYTES = 512 * 1_024;
const withBoundedResponseBytes = <S extends z.ZodType>(schema: S) => schema.superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BOUNDED_RESPONSE_BYTES) context.addIssue({ code: "custom", message: "response projection exceeds 512 KiB UTF-8 limit" });
});

export const EvaluationReportProjectionSchema = withBoundedResponseBytes(z.object({
  schemaVersion: z.literal(2), evaluationId: EvaluationIdSchema, prompt: z.string().min(1).max(1_000),
  target: z.object({ redactedDisplayUrl: z.string().max(2_048), allowedNavigationOrigins: z.array(PublicHttpsOriginSchema).min(1).max(3) }).strict(),
  assertions: AssertionSetV1Schema, aggregate: EvaluationAggregateV2Schema, runs: z.array(RunSnapshotSchema).max(15),
  observableStateLimitation: z.literal("PASS proves declared browser-observable assertions only, not arbitrary backend business truth."),
}).strict());
export type EvaluationReportProjection = z.infer<typeof EvaluationReportProjectionSchema>;

export const AgentTraceItemSchema = z.object({
  cursor: EventCursorSchema, runId: RunIdSchema, runSequence: z.number().int().nonnegative(), occurredAt: UtcDateTimeSchema,
  event: AgentTraceEventSchema,
}).strict();
export const AgentTraceProjectionSchema = withBoundedResponseBytes(z.object({
  schemaVersion: z.literal(1), evaluationId: EvaluationIdSchema, items: z.array(AgentTraceItemSchema).max(200),
  truncated: z.boolean(), nextCursor: EventCursorSchema.nullable(),
}).strict());
export type AgentTraceProjection = z.infer<typeof AgentTraceProjectionSchema>;

export const EventListResponseSchema = withBoundedResponseBytes(z.object({
  events: z.array(EventEnvelopeSchema).max(200), earliestCursor: EventCursorSchema.nullable(), latestCursor: EventCursorSchema.nullable(),
  truncated: z.boolean().default(false), nextCursor: EventCursorSchema.nullable().default(null),
}).strict());
export type EventListResponse = z.infer<typeof EventListResponseSchema>;

export const ApiErrorSchema = z.object({ error: ControlErrorSchema }).strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;
export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]), checkedAt: UtcDateTimeSchema,
  dependencies: z.record(z.string(), z.enum(["ok", "degraded", "unavailable"])),
}).strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
