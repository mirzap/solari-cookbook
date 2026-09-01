import { z } from "zod";
import { SafeAgentToolNameSchema } from "./agent.ts";
import { InterfaceModeSchema } from "./config.ts";
import { DiscoveryEvidenceSchema } from "./discovery.ts";
import { ControlErrorSchema, FailureRecordSchema, RunWarningSchema } from "./errors.ts";
import { GradeResultV2Schema } from "./grading.ts";
import {
  EventCursorSchema,
  EvaluationIdSchema,
  EventIdSchema,
  EvidenceHashSchema,
  RunIdSchema,
  RunSequenceSchema,
  ToolCallIdSchema,
  UtcDateTimeSchema,
} from "./ids.ts";
import { ToolInterfaceSourceSchema } from "./mcp.ts";
import { PolicyActivitySchema, PolicyDenyCodeSchema } from "./policy.ts";
import { ModelIdSchema } from "./models.ts";
import { AdmissionReasonCodeSchema } from "./targets.ts";
import { RunOutcomeSchema, RunStatusSchema, TransitionModeSchema } from "./states.ts";

export const EVENT_TYPES = [
  "evaluation.created", "evaluation.started", "evaluation.cancel_requested", "evaluation.completed", "evaluation.cancelled", "evaluation.failed",
  "run.queued", "run.started", "run.status_changed", "run.environment.recorded", "run.admission.completed", "run.browser.ready", "run.discovery.completed",
  "run.policy.warning", "run.policy.blocked", "run.agent.iteration", "run.agent.message", "run.tool.started", "run.tool.completed", "run.usage.updated",
  "run.evidence.capture_started", "run.evidence.captured", "run.grade.started", "run.grade.completed",
  "run.passed", "run.failed", "run.inconclusive", "run.cancelled", "run.release.status_changed", "run.replay.status_changed", "run.warning",
  "system.capability.changed", "recovery.performed",
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;
const event = <T extends EventType, S extends z.ZodType>(type: T, payload: S) => z.object({ type: z.literal(type), payload });

export const RunQueuedEventPayloadSchema = z.object({ runIndex: z.number().int().nonnegative() }).strict();
export const RunStatusChangedEventPayloadSchema = z.object({ previous: RunStatusSchema, next: RunStatusSchema, mode: TransitionModeSchema }).strict();

export const RunEnvironmentEvidenceSchema = z.object({
  nodeVersion: z.string().min(1).max(50),
  pnpmVersion: z.string().min(1).max(50),
  browserProvider: z.string().min(1).max(100),
  browserRegion: z.string().min(1).max(100).nullable(),
  modelId: ModelIdSchema,
  resolvedProvider: z.string().min(1).max(200).nullable(),
  safetyPolicyVersion: z.literal("public-safe-v1"),
}).strict();

const countSummary = z.object({
  requested: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  nonterminal: z.number().int().nonnegative(),
  potentialLeaks: z.number().int().nonnegative(),
}).strict();

const agentEvents = [
  event("run.agent.iteration", z.object({ iteration: z.number().int().positive(), summary: z.string().max(2_000), historyBytes: z.number().int().nonnegative() }).strict()),
  event("run.agent.message", z.object({ role: z.enum(["assistant", "tool"]), summary: z.string().max(4_000) }).strict()),
  event("run.tool.started", z.object({
    toolCallId: ToolCallIdSchema,
    tool: SafeAgentToolNameSchema,
    interfaceSource: ToolInterfaceSourceSchema,
    interfaceMode: InterfaceModeSchema,
    argumentSummary: z.string().max(2_000),
  }).strict()),
  event("run.tool.completed", z.object({
    toolCallId: ToolCallIdSchema,
    tool: SafeAgentToolNameSchema,
    interfaceSource: ToolInterfaceSourceSchema,
    interfaceMode: InterfaceModeSchema,
    success: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    resultSummary: z.string().max(2_000),
  }).strict()),
  event("run.usage.updated", z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }).strict()),
] as const;

export const AgentTraceEventSchema = z.discriminatedUnion("type", agentEvents);

export const RunEventSchema = z.discriminatedUnion("type", [
  event("evaluation.created", z.object({ requestedRuns: z.number().int().positive() }).strict()),
  event("evaluation.started", z.object({ startedAt: UtcDateTimeSchema }).strict()),
  event("evaluation.cancel_requested", z.object({ reason: z.string().min(1).max(500).nullable() }).strict()),
  event("evaluation.completed", countSummary), event("evaluation.cancelled", countSummary),
  event("evaluation.failed", z.object({ error: ControlErrorSchema }).strict()),
  event("run.queued", RunQueuedEventPayloadSchema),
  event("run.started", z.object({ startedAt: UtcDateTimeSchema }).strict()),
  event("run.status_changed", RunStatusChangedEventPayloadSchema),
  event("run.environment.recorded", RunEnvironmentEvidenceSchema),
  event("run.admission.completed", z.discriminatedUnion("status", [
    z.object({ status: z.literal("admitted"), reason: z.literal("admitted"), enforcement: z.enum(["provider_preconnect", "forced_proxy_preconnect", "practical_best_effort"]) }).strict(),
    z.object({ status: z.literal("rejected"), reason: AdmissionReasonCodeSchema.exclude(["admitted"]), enforcement: z.null() }).strict(),
  ])),
  event("run.browser.ready", z.object({ region: z.string().min(1).max(100).nullable(), recordingRequested: z.boolean() }).strict()),
  event("run.discovery.completed", DiscoveryEvidenceSchema),
  event("run.policy.warning", PolicyActivitySchema),
  event("run.policy.blocked", z.object({ code: PolicyDenyCodeSchema, actionSequence: z.number().int().nonnegative().nullable() }).strict()),
  ...agentEvents,
  event("run.evidence.capture_started", z.object({ attempt: z.number().int().min(1).max(3) }).strict()),
  event("run.evidence.captured", z.object({ evidenceHash: EvidenceHashSchema, captureAttempts: z.number().int().min(2).max(3), unverifiableCount: z.number().int().min(0).max(20) }).strict()),
  event("run.grade.started", z.object({ evidenceHash: EvidenceHashSchema }).strict()),
  event("run.grade.completed", GradeResultV2Schema),
  event("run.passed", z.object({ outcome: z.literal("passed") }).strict()),
  event("run.failed", z.object({ outcome: z.literal("failed"), failure: FailureRecordSchema }).strict()),
  event("run.inconclusive", z.object({ outcome: z.literal("inconclusive"), failure: FailureRecordSchema }).strict()),
  event("run.cancelled", z.object({ reason: ControlErrorSchema.nullable() }).strict()),
  event("run.release.status_changed", z.union([
    z.object({ previous: z.enum(["not_started", "releasing", "released", "failed", "unknown"]), next: z.literal("released"), confirmed: z.literal(true) }).strict(),
    z.object({ previous: z.enum(["not_started", "releasing", "released", "failed", "unknown"]), next: z.enum(["not_started", "releasing", "failed", "unknown"]), confirmed: z.literal(false) }).strict(),
  ])),
  event("run.replay.status_changed", z.object({ previous: z.enum(["not_requested", "unsupported", "recording", "pending", "ready", "failed"]), next: z.enum(["not_requested", "unsupported", "recording", "pending", "ready", "failed"]) }).strict()),
  event("run.warning", RunWarningSchema),
  event("system.capability.changed", z.object({ capability: z.string().min(1).max(100), available: z.boolean() }).strict()),
  event("recovery.performed", z.object({ action: z.string().min(1).max(200), details: z.string().max(2_000) }).strict()),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;

const EventIdentitySchema = z.object({
  schemaVersion: z.literal(1).default(1), eventId: EventIdSchema, evaluationId: EvaluationIdSchema,
  runId: RunIdSchema.nullable(), runSequence: RunSequenceSchema.nullable(), occurredAt: UtcDateTimeSchema,
});

const withEventScopeRules = <S extends z.ZodType>(schema: S) => schema.superRefine((value, context) => {
  const candidate = value as z.infer<typeof EventIdentitySchema> & RunEvent;
  const isRunEvent = candidate.type.startsWith("run.");
  const hasRunId = candidate.runId !== null;
  const hasRunSequence = candidate.runSequence !== null;
  if (hasRunId !== hasRunSequence) context.addIssue({ code: "custom", message: "runId and runSequence must be present or null together" });
  if (isRunEvent && (!hasRunId || !hasRunSequence)) context.addIssue({ code: "custom", message: "run events require run scope" });
  if (!isRunEvent && (hasRunId || hasRunSequence)) context.addIssue({ code: "custom", message: "non-run events cannot carry run scope" });
});

export const MAX_PERSISTED_EVENT_BYTES = 16 * 1_024;
const withEventByteLimit = <S extends z.ZodType>(schema: S) => schema.superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_PERSISTED_EVENT_BYTES) {
    context.addIssue({ code: "custom", message: "persisted event exceeds 16 KiB UTF-8 limit" });
  }
});
export const EventAppendInputSchema = withEventByteLimit(withEventScopeRules(EventIdentitySchema.and(RunEventSchema)));
export const EventEnvelopeSchema = withEventByteLimit(withEventScopeRules(EventIdentitySchema.extend({ cursor: EventCursorSchema, recordedAt: UtcDateTimeSchema }).and(RunEventSchema)));
export type EventAppendInput = z.infer<typeof EventAppendInputSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

const RunScopedEventIdentitySchema = EventIdentitySchema.extend({ runId: RunIdSchema, runSequence: RunSequenceSchema });
const RunScopedEventEnvelopeIdentitySchema = RunScopedEventIdentitySchema.extend({ cursor: EventCursorSchema, recordedAt: UtcDateTimeSchema });
export const RunQueuedEventAppendInputSchema = withEventScopeRules(RunScopedEventIdentitySchema.and(event("run.queued", RunQueuedEventPayloadSchema)));
export const RunQueuedEventEnvelopeSchema = withEventScopeRules(RunScopedEventEnvelopeIdentitySchema.and(event("run.queued", RunQueuedEventPayloadSchema)));
export const RunStatusChangedEventAppendInputSchema = withEventScopeRules(RunScopedEventIdentitySchema.and(event("run.status_changed", RunStatusChangedEventPayloadSchema)));
export const RunStatusChangedEventEnvelopeSchema = withEventScopeRules(RunScopedEventEnvelopeIdentitySchema.and(event("run.status_changed", RunStatusChangedEventPayloadSchema)));
export type RunQueuedEventAppendInput = z.infer<typeof RunQueuedEventAppendInputSchema>;
export type RunQueuedEventEnvelope = z.infer<typeof RunQueuedEventEnvelopeSchema>;
export type RunStatusChangedEventAppendInput = z.infer<typeof RunStatusChangedEventAppendInputSchema>;
export type RunStatusChangedEventEnvelope = z.infer<typeof RunStatusChangedEventEnvelopeSchema>;

export const outcomeForTerminalEvent = (eventType: EventType): z.infer<typeof RunOutcomeSchema> | null => {
  if (eventType === "run.passed") return "passed";
  if (eventType === "run.failed") return "failed";
  if (eventType === "run.inconclusive") return "inconclusive";
  return null;
};
