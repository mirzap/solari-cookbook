import { z } from "zod";
import type {
  AgentExecutionInputV2, AgentRunResult, SafeAgentAction, SafeAgentToolResult, SafeAgentToolSurface,
  UntrustedAgentObservation,
} from "./agent.ts";
import { TokenUsageSchema } from "./agent.ts";
import { AssertionSetV1Schema } from "./assertions.ts";
import type { InterfaceMode } from "./config.ts";
import type { DiscoveryEvidence } from "./discovery.ts";
import { EvaluationSchema, RunSchema, type BrowserSessionSummary, type Evaluation, type Run } from "./entities.ts";
import { ControlErrorSchema, FailureRecordSchema, RunWarningSchema, type ControlError, type FailureRecord, type RunWarning } from "./errors.ts";
import type { AssertionCaptureResult } from "./evidence.ts";
import {
  EventAppendInputSchema, EventEnvelopeSchema, RunQueuedEventAppendInputSchema, RunQueuedEventEnvelopeSchema,
  RunStatusChangedEventAppendInputSchema, RunStatusChangedEventEnvelopeSchema,
  type EventAppendInput, type EventEnvelope,
} from "./events.ts";
import { GradeResultV2Schema, type FailureAnalysis, type GradeInputV2, type GradeResultV2 } from "./grading.ts";
import {
  BrowserSessionIdSchema, CreateAttemptCorrelationIdSchema, EvaluationIdSchema, RunIdSchema, UtcDateTimeSchema,
  type BrowserSessionId, type CreateAttemptCorrelationId, type EventCursor, type EvaluationId,
  type EventId, type ObservationRevision, type RunId, type UtcDateTime,
} from "./ids.ts";
import { InterfaceUsageSummarySchema } from "./mcp.ts";
import { ModelIdSchema, type ModelId } from "./models.ts";
import {
  EvaluationStatusSchema, ReleaseStatusSchema, RunOutcomeSchema, RunStatusSchema,
  type EvaluationStatus, type ReleaseStatus, type ReplayStatus, type RunOutcome, type RunStatus,
} from "./states.ts";
import type { AdmittedPublicTarget, PublicEvaluationTargetV2, TargetAdmissionResult } from "./targets.ts";
import type { PublicHttpsOrigin } from "./targets.ts";
import { RunTransitionContextSchema, validateRunTransition } from "./transitions.ts";
import type { UntrustedWebMcpResultV1, WebMcpInvocationRequest, WebMcpToolDescriptorV1 } from "./webmcp.ts";

export interface Clock { now(): Date; nowIso(): UtcDateTime; sleep(durationMs: number, signal: AbortSignal): Promise<void>; }
export interface IdGenerator { evaluationId(): EvaluationId; runId(): RunId; eventId(): EventId; createAttemptCorrelationId(): CreateAttemptCorrelationId; }

export interface TargetAdmissionPort {
  assess(target: PublicEvaluationTargetV2, signal: AbortSignal): Promise<TargetAdmissionResult>;
}

const validateSubmissionParts = (value: { evaluation: Evaluation; runs: readonly Run[]; queuedEvents: readonly { eventId: EventId; evaluationId: EvaluationId; runId: RunId; runSequence: number; type: "run.queued"; payload: { runIndex: number } }[] }, context: z.RefinementCtx) => {
  if (value.evaluation.status !== "queued" || value.evaluation.startedAt !== null || value.evaluation.finishedAt !== null || value.evaluation.failure !== null) context.addIssue({ code: "custom", path: ["evaluation"], message: "submitted evaluation must be clean and queued" });
  const expectedRuns = value.evaluation.config.modelIds.length * value.evaluation.config.requestedRunsPerModel;
  if (value.runs.length !== expectedRuns || value.queuedEvents.length !== expectedRuns) context.addIssue({ code: "custom", path: ["runs"], message: "complete configured run/event expansion is required" });
  const runIds = new Set<string>(); const eventIds = new Set<string>(); const modelCounts = new Map<string, number>();
  value.runs.forEach((run, index) => {
    if (runIds.has(run.id)) context.addIssue({ code: "custom", path: ["runs", index, "id"], message: "run IDs must be unique" });
    runIds.add(run.id); modelCounts.set(run.modelId, (modelCounts.get(run.modelId) ?? 0) + 1);
    if (run.runIndex !== index || run.evaluationId !== value.evaluation.id) context.addIssue({ code: "custom", path: ["runs", index], message: "runs must be contiguous and belong to evaluation" });
    const cleanUsage = run.usage.promptTokens === null && run.usage.completionTokens === null && run.usage.totalTokens === null;
    const cleanRun = run.status === "queued" && run.outcome === null && run.grade === null && run.failure === null
      && run.resolvedProvider === null && run.startedAt === null && run.finishedAt === null && run.durationMs === null
      && run.iterations === 0 && run.toolCalls === 0 && run.browserActions === 0 && cleanUsage
      && run.replayStatus === "not_requested" && run.releaseStatus === "not_started" && run.warnings.length === 0 && !run.potentialSessionLeak
      && run.createdAt === value.evaluation.createdAt;
    if (!cleanRun) context.addIssue({ code: "custom", path: ["runs", index], message: "submitted runs must use every canonical queued default" });
    const queued = value.queuedEvents[index];
    if (queued === undefined) return;
    if (eventIds.has(queued.eventId)) context.addIssue({ code: "custom", path: ["queuedEvents", index, "eventId"], message: "event IDs must be unique" });
    eventIds.add(queued.eventId);
    if (queued.evaluationId !== value.evaluation.id || queued.runId !== run.id || queued.runSequence !== 0 || queued.type !== "run.queued" || queued.payload.runIndex !== index) context.addIssue({ code: "custom", path: ["queuedEvents", index], message: "queued event must align with run at sequence zero" });
  });
  value.evaluation.config.modelIds.forEach((modelId) => {
    if ((modelCounts.get(modelId) ?? 0) !== value.evaluation.config.requestedRunsPerModel) context.addIssue({ code: "custom", path: ["runs"], message: "each model requires requested run count" });
  });
};

export const EvaluationSubmissionInputSchema = z.object({ evaluation: EvaluationSchema, runs: z.array(RunSchema).min(1).max(15), queuedEvents: z.array(RunQueuedEventAppendInputSchema).min(1).max(15) }).strict().superRefine(validateSubmissionParts);
export const EvaluationSubmissionResultSchema = z.object({ created: z.boolean(), evaluation: EvaluationSchema, runs: z.array(RunSchema).min(1).max(15), queuedEvents: z.array(RunQueuedEventEnvelopeSchema).min(1).max(15) }).strict().superRefine(validateSubmissionParts);
export type EvaluationSubmissionInput = z.infer<typeof EvaluationSubmissionInputSchema>;
export type EvaluationSubmissionResult = z.infer<typeof EvaluationSubmissionResultSchema>;
export interface EvaluationSubmissionRepository { transactionallyCreate(input: EvaluationSubmissionInput, signal: AbortSignal): Promise<EvaluationSubmissionResult>; }

export type SensitiveBrowserEndpoint = string & { readonly __sensitiveBrowserEndpoint: unique symbol };
export type SensitiveReplayUrl = string & { readonly __sensitiveReplayUrl: unique symbol };

export const BrowserAcquireRequestSchema = z.object({
  evaluationId: EvaluationIdSchema, runId: RunIdSchema, modelId: ModelIdSchema,
  attemptCorrelationId: CreateAttemptCorrelationIdSchema, recordingRequested: z.boolean(), region: z.string().min(1).max(100).optional(),
}).strict();
export type BrowserAcquireRequest = z.infer<typeof BrowserAcquireRequestSchema> & { readonly evaluationId: EvaluationId; readonly modelId: ModelId };

export const ReleaseResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("released"), confirmation: z.literal("confirmed_released"), releasedAt: UtcDateTimeSchema, warning: z.null() }).strict(),
  z.object({ status: z.literal("failed"), confirmation: z.literal("unconfirmed"), releasedAt: z.null(), warning: RunWarningSchema }).strict(),
]);
export type ReleaseResult = z.infer<typeof ReleaseResultSchema>;
export interface BrowserLease {
  readonly providerSessionId: BrowserSessionId;
  readonly connectEndpoint: SensitiveBrowserEndpoint;
  readonly region: string | null;
  readonly recordingRequested: boolean;
  release(reason: string, signal: AbortSignal): Promise<ReleaseResult>;
}
export interface BrowserProvider { acquire(request: BrowserAcquireRequest, signal: AbortSignal): Promise<BrowserLease>; }

export const ProviderCreateReconciliationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("no_session_created"), attemptCorrelationId: CreateAttemptCorrelationIdSchema }).strict(),
  z.object({ status: z.literal("session_found"), attemptCorrelationId: CreateAttemptCorrelationIdSchema, providerSessionId: BrowserSessionIdSchema }).strict(),
  z.object({ status: z.literal("unresolved"), attemptCorrelationId: CreateAttemptCorrelationIdSchema }).strict(),
]);
export type ProviderCreateReconciliationResult = z.infer<typeof ProviderCreateReconciliationResultSchema>;
export interface ProviderSessionReconciliationPort {
  reconcileCreate(attemptCorrelationId: CreateAttemptCorrelationId, signal: AbortSignal): Promise<ProviderCreateReconciliationResult>;
  releaseReconciled(providerSessionId: BrowserSessionId, reason: string, signal: AbortSignal): Promise<ReleaseResult>;
}

export const ProviderCreateAttemptStatusSchema = z.enum([
  "started", "no_session_created", "session_found", "unresolved", "released", "release_failed",
]);
export const ProviderCreateAttemptRecordSchema = z.object({
  schemaVersion: z.literal(1), runId: RunIdSchema, attemptCorrelationId: CreateAttemptCorrelationIdSchema,
  status: ProviderCreateAttemptStatusSchema, providerSessionId: BrowserSessionIdSchema.nullable(),
  potentialSessionLeak: z.boolean(), createdAt: UtcDateTimeSchema, updatedAt: UtcDateTimeSchema,
}).strict().superRefine((value, context) => {
  const requiresSession = ["session_found", "released", "release_failed"].includes(value.status);
  if (requiresSession !== (value.providerSessionId !== null)) context.addIssue({ code: "custom", path: ["providerSessionId"], message: "provider session identity must match attempt status" });
  const leakExpected = value.status === "unresolved" || value.status === "release_failed";
  if (value.potentialSessionLeak !== leakExpected) context.addIssue({ code: "custom", path: ["potentialSessionLeak"], message: "potential leak flag must match unresolved lifecycle state" });
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) context.addIssue({ code: "custom", path: ["updatedAt"], message: "attempt update cannot precede creation" });
});
export type ProviderCreateAttemptStatus = z.infer<typeof ProviderCreateAttemptStatusSchema>;
export type ProviderCreateAttemptRecord = z.infer<typeof ProviderCreateAttemptRecordSchema>;
export interface ProviderCreateAttemptRepository {
  recordStarted(record: Extract<ProviderCreateAttemptRecord, { status: "started" }> | ProviderCreateAttemptRecord, signal: AbortSignal): Promise<ProviderCreateAttemptRecord>;
  transition(runId: RunId, attemptCorrelationId: CreateAttemptCorrelationId, expected: ProviderCreateAttemptStatus, next: ProviderCreateAttemptRecord, signal: AbortSignal): Promise<boolean>;
  get(runId: RunId, attemptCorrelationId: CreateAttemptCorrelationId, signal: AbortSignal): Promise<ProviderCreateAttemptRecord | null>;
  listUnresolved(signal: AbortSignal): Promise<readonly ProviderCreateAttemptRecord[]>;
}

export const ProviderCapacityStateSchema = z.object({ configuredMaximum: z.number().int().min(1).max(5), effectiveCapacity: z.number().int().min(1).max(5), retryAfterMs: z.number().int().min(0).max(300_000).nullable() }).strict().superRefine((value, context) => {
  if (value.effectiveCapacity > value.configuredMaximum) context.addIssue({ code: "custom", path: ["effectiveCapacity"], message: "effective capacity cannot exceed configured maximum" });
});
export type ProviderCapacityState = z.infer<typeof ProviderCapacityStateSchema>;
export interface ProviderCapacityPort { current(signal: AbortSignal): Promise<ProviderCapacityState>; reduceAfterLimit(retryAfterMs: number | null, signal: AbortSignal): Promise<ProviderCapacityState>; }

export interface ElementActionInput { readonly ref: string; readonly observationRevision: ObservationRevision; }
export interface BrowserController {
  connect(lease: BrowserLease, signal: AbortSignal): Promise<void>;
  close(signal: AbortSignal): Promise<void>;
  navigate(url: string, signal: AbortSignal): Promise<UntrustedAgentObservation>;
  observe(signal: AbortSignal): Promise<UntrustedAgentObservation>;
  click(input: ElementActionInput, signal: AbortSignal): Promise<UntrustedAgentObservation>;
  type(input: ElementActionInput & { readonly text: string; readonly clearFirst: boolean }, signal: AbortSignal): Promise<UntrustedAgentObservation>;
  select(input: ElementActionInput & { readonly value: string }, signal: AbortSignal): Promise<UntrustedAgentObservation>;
  pressKey(input: ElementActionInput & { readonly key: string }, signal: AbortSignal): Promise<UntrustedAgentObservation>;
  scroll(direction: "up" | "down", amount: number, signal: AbortSignal): Promise<UntrustedAgentObservation>;
  wait(durationMs: number, signal: AbortSignal): Promise<UntrustedAgentObservation>;
}
export interface BrowserControllerFactory { create(lease: BrowserLease, signal: AbortSignal): Promise<BrowserController>; }

export interface WebMcpReadOnlyAdapterPort {
  discover(controller: BrowserController, currentOrigin: PublicHttpsOrigin, signal: AbortSignal): Promise<readonly WebMcpToolDescriptorV1[]>;
  invoke(controller: BrowserController, request: WebMcpInvocationRequest, signal: AbortSignal): Promise<UntrustedWebMcpResultV1>;
}

export interface SafeAgentToolPort {
  surface(observationRevision: ObservationRevision, signal: AbortSignal): Promise<SafeAgentToolSurface>;
  execute(action: SafeAgentAction, signal: AbortSignal): Promise<SafeAgentToolResult>;
}

export interface DiscoveryContext { readonly runId: RunId; readonly observation: UntrustedAgentObservation; readonly interfaceMode: InterfaceMode; readonly admittedTarget: AdmittedPublicTarget; }
export interface DiscoveryController { discover(context: DiscoveryContext, signal: AbortSignal): Promise<DiscoveryEvidence>; }
export interface AgentRunner { run(input: AgentExecutionInputV2, safeTools: SafeAgentToolPort, signal: AbortSignal): Promise<AgentRunResult>; }

export const AssertionCaptureInputSchema = z.object({ assertions: AssertionSetV1Schema }).strict();
export type AssertionCaptureInput = z.infer<typeof AssertionCaptureInputSchema>;
export interface AssertionEvidenceCapture { capture(controller: BrowserController, input: AssertionCaptureInput, signal: AbortSignal): Promise<AssertionCaptureResult>; }
export interface Grader { grade(input: GradeInputV2, signal: AbortSignal): Promise<GradeResultV2>; }

export interface FailureAnalysisContext { readonly run: Run; readonly failure: FailureRecord; readonly observation: UntrustedAgentObservation | null; readonly grade: GradeResultV2 | null; }
export interface FailureAnalyzer { analyze(context: FailureAnalysisContext, signal: AbortSignal): Promise<FailureAnalysis>; }

export interface EvaluationStatusPatch { readonly startedAt?: UtcDateTime | null; readonly finishedAt?: UtcDateTime | null; readonly failure?: ControlError | null; }
export interface EvaluationRepository {
  create(evaluation: Evaluation, signal: AbortSignal): Promise<Evaluation>;
  get(id: EvaluationId, signal: AbortSignal): Promise<Evaluation | null>;
  compareAndSetStatus(id: EvaluationId, expected: EvaluationStatus, next: EvaluationStatus, patch: EvaluationStatusPatch, signal: AbortSignal): Promise<boolean>;
  listRecoverable(signal: AbortSignal): Promise<readonly Evaluation[]>;
}

export const RunStatusPatchSchema = z.object({ startedAt: UtcDateTimeSchema.nullable().optional(), finishedAt: UtcDateTimeSchema.nullable().optional(), failure: FailureRecordSchema.nullable().optional(), releaseStatus: ReleaseStatusSchema.optional(), potentialSessionLeak: z.boolean().optional() }).strict();
export type RunStatusPatch = z.infer<typeof RunStatusPatchSchema>;
export const IntermediateRunStatusPatchSchema = RunStatusPatchSchema.omit({ finishedAt: true }).strict();
export type IntermediateRunStatusPatch = z.infer<typeof IntermediateRunStatusPatchSchema>;
const IntermediateRunStatusSchema = RunStatusSchema.exclude(["completed", "cancelled"]);

export const IntermediateRunTransitionInputSchema = z.object({ runId: RunIdSchema, expectedStatus: IntermediateRunStatusSchema, nextStatus: IntermediateRunStatusSchema, context: RunTransitionContextSchema, patch: IntermediateRunStatusPatchSchema, event: RunStatusChangedEventAppendInputSchema }).strict().superRefine((value, context) => {
  if (!validateRunTransition(value.expectedStatus, value.nextStatus, value.context).ok) context.addIssue({ code: "custom", path: ["nextStatus"], message: "run transition must be legal" });
  if (value.event.runId !== value.runId || value.event.payload.previous !== value.expectedStatus || value.event.payload.next !== value.nextStatus || value.event.payload.mode !== value.context.mode || value.event.runSequence === 0) context.addIssue({ code: "custom", path: ["event"], message: "transition event must align and use non-zero sequence" });
});
export const IntermediateRunTransitionResultSchema = z.object({ applied: z.boolean(), run: RunSchema.nullable(), event: RunStatusChangedEventEnvelopeSchema.nullable() }).strict().superRefine((value, context) => {
  if (value.applied !== (value.run !== null && value.event !== null)) context.addIssue({ code: "custom", message: "applied transition requires committed run and event" });
});
export type IntermediateRunTransitionInput = z.infer<typeof IntermediateRunTransitionInputSchema>;
export type IntermediateRunTransitionResult = z.infer<typeof IntermediateRunTransitionResultSchema>;
export interface RunTransitionRepository { transactionallyApply(input: IntermediateRunTransitionInput, signal: AbortSignal): Promise<IntermediateRunTransitionResult>; }

const FinalizableRunStatusSchema = RunStatusSchema.exclude(["completed", "cancelled"]);
export const RunCompletionPatchSchema = z.object({
  resolvedProvider: z.string().min(1).max(200).nullable(),
  iterations: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  browserActions: z.number().int().nonnegative(),
  interfaceUsage: InterfaceUsageSummarySchema.optional(),
  usage: TokenUsageSchema,
  releaseStatus: ReleaseStatusSchema,
  replayStatus: z.enum(["not_requested", "unsupported", "recording", "pending", "ready", "failed"]),
  potentialSessionLeak: z.boolean(),
}).strict();
export type RunCompletionPatch = z.infer<typeof RunCompletionPatchSchema>;
export const FinalizeRunInputSchema = z.object({
  runId: RunIdSchema, expectedStatus: FinalizableRunStatusSchema, context: RunTransitionContextSchema, outcome: RunOutcomeSchema,
  grade: GradeResultV2Schema, failure: FailureRecordSchema.nullable(), warnings: z.array(RunWarningSchema).max(50), finishedAt: UtcDateTimeSchema,
  resultPatch: RunCompletionPatchSchema.optional(), event: EventAppendInputSchema,
}).strict().superRefine((value, context) => {
  if (!validateRunTransition(value.expectedStatus, "completed", value.context).ok) context.addIssue({ code: "custom", path: ["context"], message: "terminalization requires a legal lease-safe completion transition" });
  if (value.grade.outcome !== value.outcome) context.addIssue({ code: "custom", path: ["grade", "outcome"], message: "grade outcome must match" });
  if (value.outcome === "passed" ? value.failure !== null : value.failure?.outcome !== value.outcome) context.addIssue({ code: "custom", path: ["failure"], message: "failure must be null for pass or match outcome" });
  if (JSON.stringify(value.grade.failure) !== JSON.stringify(value.failure)) context.addIssue({ code: "custom", path: ["failure"], message: "grade and terminalization must use the same authoritative failure" });
  if (value.event.runId !== value.runId || value.event.type !== `run.${value.outcome}` || value.event.runSequence === null || value.event.runSequence === 0) context.addIssue({ code: "custom", path: ["event"], message: "terminal event must match run/outcome and use a non-zero sequence" });
  if (value.resultPatch !== undefined && value.context.leaseDisposition === "released" && value.resultPatch.releaseStatus !== "released") {
    context.addIssue({ code: "custom", path: ["resultPatch", "releaseStatus"], message: "released lease disposition requires confirmed released result state" });
  }
});
export type FinalizeRunInput = z.infer<typeof FinalizeRunInputSchema>;
export interface FinalizeRunResult { readonly applied: boolean; readonly run: Run | null; readonly event: EventEnvelope | null; }

export const CancelRunInputSchema = z.object({
  runId: RunIdSchema,
  expectedStatus: FinalizableRunStatusSchema,
  context: RunTransitionContextSchema,
  reason: ControlErrorSchema.nullable(),
  finishedAt: UtcDateTimeSchema,
  releaseStatus: ReleaseStatusSchema,
  warnings: z.array(RunWarningSchema).max(50),
  potentialSessionLeak: z.boolean(),
  event: EventAppendInputSchema,
}).strict().superRefine((value, context) => {
  if (!validateRunTransition(value.expectedStatus, "cancelled", value.context).ok) {
    context.addIssue({ code: "custom", path: ["context"], message: "cancellation requires a legal lease-safe transition" });
  }
  if (value.context.leaseDisposition === "released" && value.releaseStatus !== "released") {
    context.addIssue({ code: "custom", path: ["releaseStatus"], message: "released lease disposition requires confirmed released state" });
  }
  if (value.event.runId !== value.runId || value.event.type !== "run.cancelled" || value.event.runSequence === null || value.event.runSequence === 0) {
    context.addIssue({ code: "custom", path: ["event"], message: "cancellation event must match the run and use a non-zero sequence" });
  } else if (JSON.stringify(value.event.payload.reason) !== JSON.stringify(value.reason)) {
    context.addIssue({ code: "custom", path: ["event", "payload", "reason"], message: "cancellation event reason must match the committed reason" });
  }
});
export const CancelRunResultSchema = z.object({
  applied: z.boolean(),
  run: RunSchema.nullable(),
  event: EventEnvelopeSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.applied !== (value.run !== null && value.event !== null)) context.addIssue({ code: "custom", message: "applied cancellation requires committed run and event" });
});
export type CancelRunInput = z.infer<typeof CancelRunInputSchema>;
export type CancelRunResult = z.infer<typeof CancelRunResultSchema>;
export interface RunRepository {
  create(run: Run, signal: AbortSignal): Promise<Run>;
  get(id: RunId, signal: AbortSignal): Promise<Run | null>;
  compareAndSetStatus(id: RunId, expected: RunStatus, next: RunStatus, patch: RunStatusPatch, signal: AbortSignal): Promise<boolean>;
  listRecoverable(signal: AbortSignal): Promise<readonly Run[]>;
  transactionallyFinalize(input: FinalizeRunInput, signal: AbortSignal): Promise<FinalizeRunResult>;
  transactionallyCancel(input: CancelRunInput, signal: AbortSignal): Promise<CancelRunResult>;
}
export interface EventRepository {
  append(input: EventAppendInput, signal: AbortSignal): Promise<EventEnvelope>;
  listAfter(evaluationId: EvaluationId, cursor: EventCursor | null, limit: number, signal: AbortSignal): Promise<readonly EventEnvelope[]>;
  earliestCursor(evaluationId: EvaluationId, signal: AbortSignal): Promise<EventCursor | null>;
  latestCursor(evaluationId: EvaluationId, signal: AbortSignal): Promise<EventCursor | null>;
}
export interface BrowserSessionRepository { upsert(session: BrowserSessionSummary, signal: AbortSignal): Promise<BrowserSessionSummary>; get(runId: RunId, signal: AbortSignal): Promise<BrowserSessionSummary | null>; listPotentiallyLeaked(signal: AbortSignal): Promise<readonly BrowserSessionSummary[]>; }

export interface ReplayStatusResult { readonly status: ReplayStatus; readonly checkedAt: UtcDateTime; }
export interface ReplayAccessResult { readonly status: ReplayStatus; readonly url: SensitiveReplayUrl | null; readonly expiresAt: UtcDateTime | null; }
export interface ReplayService { getStatus(providerSessionId: BrowserSessionId, signal: AbortSignal): Promise<ReplayStatusResult>; requestFreshAccess(providerSessionId: BrowserSessionId, signal: AbortSignal): Promise<ReplayAccessResult>; }
