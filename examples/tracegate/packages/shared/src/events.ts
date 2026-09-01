import { z } from "zod";

import { DiscoveryEvidenceSchema } from "./discovery.ts";
import { ControlErrorSchema, FailureRecordSchema, RunWarningSchema } from "./errors.ts";
import { GradeResultSchema } from "./grading.ts";
import {
  EventCursorSchema,
  EvaluationIdSchema,
  EventIdSchema,
  DemoMutationRevisionSchema,
  RunIdSchema,
  RunSequenceSchema,
  ToolCallIdSchema,
  UtcDateTimeSchema,
} from "./ids.ts";
import { JsonObjectSchema } from "./json.ts";
import { RuntimeCapabilitySchema } from "./capabilities.ts";
import { RunOutcomeSchema, RunStatusSchema, TransitionModeSchema } from "./states.ts";

export const EVENT_TYPES = [
  "evaluation.created",
  "evaluation.started",
  "evaluation.cancel_requested",
  "evaluation.completed",
  "evaluation.cancelled",
  "evaluation.failed",
  "run.queued",
  "run.started",
  "run.status_changed",
  "run.browser.ready",
  "run.discovery.completed",
  "run.agent.iteration",
  "run.agent.message",
  "run.tool.started",
  "run.tool.completed",
  "run.usage.updated",
  "run.grade.started",
  "run.grade.completed",
  "run.passed",
  "run.failed",
  "run.inconclusive",
  "run.cancelled",
  "run.replay.ready",
  "run.replay.status_changed",
  "run.warning",
  "system.capability.changed",
  "recovery.performed",
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

const event = <T extends EventType, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ type: z.literal(type), payload });

const countSummary = z.object({
  requested: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});

export const RunEventSchema = z.discriminatedUnion("type", [
  event("evaluation.created", z.object({ requestedRuns: z.number().int().positive() })),
  event("evaluation.started", z.object({ startedAt: UtcDateTimeSchema })),
  event("evaluation.cancel_requested", z.object({ reason: z.string().min(1).max(500).nullable() })),
  event("evaluation.completed", countSummary),
  event("evaluation.cancelled", countSummary),
  event("evaluation.failed", z.object({ error: ControlErrorSchema })),
  event("run.queued", z.object({ runIndex: z.number().int().nonnegative() })),
  event("run.started", z.object({ startedAt: UtcDateTimeSchema })),
  event(
    "run.status_changed",
    z.object({
      previous: RunStatusSchema,
      next: RunStatusSchema,
      mode: TransitionModeSchema,
    }),
  ),
  event(
    "run.browser.ready",
    z.object({
      region: z.string().min(1).max(100).nullable(),
      recordingRequested: z.boolean(),
    }),
  ),
  event("run.discovery.completed", DiscoveryEvidenceSchema),
  event(
    "run.agent.iteration",
    z.object({
      iteration: z.number().int().positive(),
      summary: z.string().max(2_000),
      historyBytes: z.number().int().nonnegative(),
    }),
  ),
  event(
    "run.agent.message",
    z.object({ role: z.enum(["assistant", "tool"]), summary: z.string().max(4_000) }),
  ),
  event(
    "run.tool.started",
    z.object({
      toolCallId: ToolCallIdSchema,
      tool: z.string().min(1).max(100),
      arguments: JsonObjectSchema,
    }),
  ),
  event(
    "run.tool.completed",
    z.object({
      toolCallId: ToolCallIdSchema,
      tool: z.string().min(1).max(100),
      success: z.boolean(),
      durationMs: z.number().int().nonnegative(),
      result: JsonObjectSchema,
    }),
  ),
  event(
    "run.usage.updated",
    z.object({
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }),
  ),
  event("run.grade.started", z.object({ evidenceRevision: DemoMutationRevisionSchema })),
  event("run.grade.completed", GradeResultSchema),
  event("run.passed", z.object({ outcome: z.literal("passed") })),
  event(
    "run.failed",
    z.object({ outcome: z.literal("failed"), failure: FailureRecordSchema }),
  ),
  event(
    "run.inconclusive",
    z.object({ outcome: z.literal("inconclusive"), failure: FailureRecordSchema }),
  ),
  event("run.cancelled", z.object({ reason: ControlErrorSchema.nullable() })),
  event("run.replay.ready", z.object({ status: z.literal("ready") })),
  event(
    "run.replay.status_changed",
    z.object({ previous: z.enum(["not_requested", "unsupported", "recording", "pending", "ready", "failed"]), next: z.enum(["not_requested", "unsupported", "recording", "pending", "ready", "failed"]) }),
  ),
  event("run.warning", RunWarningSchema),
  event("system.capability.changed", RuntimeCapabilitySchema),
  event(
    "recovery.performed",
    z.object({ action: z.string().min(1).max(200), details: JsonObjectSchema }),
  ),
]);

export type RunEvent = z.infer<typeof RunEventSchema>;

const EventIdentitySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  eventId: EventIdSchema,
  evaluationId: EvaluationIdSchema,
  runId: RunIdSchema.nullable(),
  runSequence: RunSequenceSchema.nullable(),
  occurredAt: UtcDateTimeSchema,
});

const withEventScopeRules = <S extends z.ZodType>(schema: S) =>
  schema.superRefine((value, context) => {
    const candidate = value as z.infer<typeof EventIdentitySchema> & RunEvent;
    const isRunEvent = candidate.type.startsWith("run.");
    const hasRunId = candidate.runId !== null;
    const hasRunSequence = candidate.runSequence !== null;
    if (hasRunId !== hasRunSequence) {
      context.addIssue({ code: "custom", path: [hasRunId ? "runSequence" : "runId"], message: "runId and runSequence must be present or null together" });
    }
    if (isRunEvent && (candidate.runId === null || candidate.runSequence === null)) {
      context.addIssue({
        code: "custom",
        path: [candidate.runId === null ? "runId" : "runSequence"],
        message: "run events require runId and runSequence",
      });
    }
    if ((candidate.type.startsWith("evaluation.") || candidate.type.startsWith("system.")) && (candidate.runId !== null || candidate.runSequence !== null)) {
      context.addIssue({
        code: "custom",
        path: [candidate.runId !== null ? "runId" : "runSequence"],
        message: "evaluation events cannot carry run scope",
      });
    }
  });

export const EventAppendInputSchema = withEventScopeRules(
  EventIdentitySchema.and(RunEventSchema),
);
export type EventAppendInput = z.infer<typeof EventAppendInputSchema>;

export const EventEnvelopeSchema = withEventScopeRules(
  EventIdentitySchema.extend({ cursor: EventCursorSchema, recordedAt: UtcDateTimeSchema }).and(RunEventSchema),
);
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const outcomeForTerminalEvent = (eventType: EventType): z.infer<typeof RunOutcomeSchema> | null => {
  switch (eventType) {
    case "run.passed":
      return "passed";
    case "run.failed":
      return "failed";
    case "run.inconclusive":
      return "inconclusive";
    default:
      return null;
  }
};
