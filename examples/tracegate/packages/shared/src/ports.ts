import type { AgentObservation, AgentRunResult } from "./agent.ts";
import type { InterfaceMode, PublicEvaluationConfigInput } from "./config.ts";
import type { DiscoveryEvidence } from "./discovery.ts";
import type {
  CreateDemoChallengeRequest,
  DemoChallengeProvision,
  DemoGradeEvidenceEnvelope,
  GetDemoGradeEvidenceRequest,
} from "./demo.ts";
import type { BrowserSessionSummary, Evaluation, Run } from "./entities.ts";
import type { ControlError, FailureRecord, RunWarning } from "./errors.ts";
import { EventAppendInputSchema, type EventAppendInput, type EventEnvelope } from "./events.ts";
import { GradeResultSchema, type DemoGradeEvidence, type FailureAnalysis, type GradeResult } from "./grading.ts";
import type {
  BrowserSessionId,
  ChallengeId,
  EventCursor,
  EvaluationId,
  EventId,
  ObservationRevision,
  RunId,
  UtcDateTime,
} from "./ids.ts";
import type { JsonObject } from "./json.ts";
import type { ModelId } from "./models.ts";
import { RunOutcomeSchema, RunStatusSchema, type ReleaseStatus, type ReplayStatus, type RunOutcome, type RunStatus, type EvaluationStatus } from "./states.ts";
import { z } from "zod";
import { FailureRecordSchema, RunWarningSchema } from "./errors.ts";
import { RunIdSchema, UtcDateTimeSchema } from "./ids.ts";

export interface Clock {
  now(): Date;
  nowIso(): UtcDateTime;
  sleep(durationMs: number, signal: AbortSignal): Promise<void>;
}

export interface IdGenerator {
  evaluationId(): EvaluationId;
  runId(): RunId;
  eventId(): EventId;
}

export type SensitiveBrowserEndpoint = string & { readonly __sensitiveBrowserEndpoint: unique symbol };
export type SensitiveReplayUrl = string & { readonly __sensitiveReplayUrl: unique symbol };

export interface BrowserAcquireRequest {
  readonly evaluationId: EvaluationId;
  readonly runId: RunId;
  readonly modelId: ModelId;
  readonly recordingRequested: boolean;
  readonly region?: string;
}

export interface ReleaseResult {
  readonly status: Extract<ReleaseStatus, "released" | "failed">;
  readonly releasedAt: UtcDateTime;
  readonly warning: RunWarning | null;
}

export interface BrowserLease {
  readonly providerSessionId: BrowserSessionId;
  readonly connectEndpoint: SensitiveBrowserEndpoint;
  readonly region: string | null;
  readonly recordingRequested: boolean;
  release(reason: string, signal: AbortSignal): Promise<ReleaseResult>;
}

export interface BrowserProvider {
  acquire(request: BrowserAcquireRequest, signal: AbortSignal): Promise<BrowserLease>;
}

export interface ElementActionInput {
  readonly ref: string;
  readonly observationRevision: ObservationRevision;
}

export interface BrowserController {
  connect(lease: BrowserLease, signal: AbortSignal): Promise<void>;
  close(signal: AbortSignal): Promise<void>;
  navigate(url: string, signal: AbortSignal): Promise<AgentObservation>;
  observe(signal: AbortSignal): Promise<AgentObservation>;
  click(input: ElementActionInput, signal: AbortSignal): Promise<AgentObservation>;
  type(input: ElementActionInput & { readonly text: string; readonly clearFirst: boolean }, signal: AbortSignal): Promise<AgentObservation>;
  select(input: ElementActionInput & { readonly value: string }, signal: AbortSignal): Promise<AgentObservation>;
  pressKey(key: string, signal: AbortSignal): Promise<AgentObservation>;
  scroll(direction: "up" | "down", amount: number, signal: AbortSignal): Promise<AgentObservation>;
  wait(durationMs: number, signal: AbortSignal): Promise<AgentObservation>;
  callNativeTool(name: string, arguments_: JsonObject, signal: AbortSignal): Promise<JsonObject>;
}

export interface DiscoveryContext {
  readonly runId: RunId;
  readonly observation: AgentObservation;
  readonly interfaceMode: InterfaceMode;
  readonly allowedOrigins: readonly string[];
}

export interface DiscoveryController {
  discover(context: DiscoveryContext, signal: AbortSignal): Promise<DiscoveryEvidence>;
}

export interface AgentRunContext {
  readonly evaluationId: EvaluationId;
  readonly run: Run;
  readonly config: PublicEvaluationConfigInput;
  readonly browser: BrowserController;
  readonly initialObservation: AgentObservation;
  readonly discovery: DiscoveryEvidence;
}

export interface AgentRunner {
  run(context: AgentRunContext, signal: AbortSignal): Promise<AgentRunResult>;
}

export interface GradeContext {
  readonly evaluationId: EvaluationId;
  readonly run: Run;
  readonly challengeId: ChallengeId;
  readonly evidence: DemoGradeEvidence;
}

export interface Grader {
  grade(context: GradeContext, signal: AbortSignal): Promise<GradeResult>;
}

export interface DemoAdminPort {
  createChallenge(request: CreateDemoChallengeRequest, signal: AbortSignal): Promise<DemoChallengeProvision>;
  getGradeEvidence(request: GetDemoGradeEvidenceRequest, signal: AbortSignal): Promise<DemoGradeEvidenceEnvelope>;
}

export interface FailureAnalysisContext {
  readonly run: Run;
  readonly failure: FailureRecord;
  readonly observation: AgentObservation | null;
  readonly grade: GradeResult | null;
}

export interface FailureAnalyzer {
  analyze(context: FailureAnalysisContext, signal: AbortSignal): Promise<FailureAnalysis>;
}

export interface EvaluationStatusPatch {
  readonly startedAt?: UtcDateTime | null;
  readonly finishedAt?: UtcDateTime | null;
  readonly failure?: ControlError | null;
}

export interface EvaluationRepository {
  create(evaluation: Evaluation, signal: AbortSignal): Promise<Evaluation>;
  get(id: EvaluationId, signal: AbortSignal): Promise<Evaluation | null>;
  compareAndSetStatus(id: EvaluationId, expected: EvaluationStatus, next: EvaluationStatus, patch: EvaluationStatusPatch, signal: AbortSignal): Promise<boolean>;
  listRecoverable(signal: AbortSignal): Promise<readonly Evaluation[]>;
}

export interface RunStatusPatch {
  readonly startedAt?: UtcDateTime | null;
  readonly finishedAt?: UtcDateTime | null;
  readonly failure?: FailureRecord | null;
  readonly releaseStatus?: ReleaseStatus;
  readonly potentialSessionLeak?: boolean;
}

export const FinalizeRunInputSchema = z.object({
  runId: RunIdSchema,
  expectedStatus: RunStatusSchema.extract(["grading", "releasing_browser"]),
  outcome: RunOutcomeSchema,
  grade: GradeResultSchema,
  failure: FailureRecordSchema.nullable(),
  warnings: z.array(RunWarningSchema).max(50),
  finishedAt: UtcDateTimeSchema,
  event: EventAppendInputSchema,
}).superRefine((value, context) => {
  if (value.grade.outcome !== value.outcome) {
    context.addIssue({ code: "custom", path: ["grade", "outcome"], message: "grade outcome must match final outcome" });
  }
  if (value.outcome === "passed" ? value.failure !== null : value.failure?.outcome !== value.outcome) {
    context.addIssue({ code: "custom", path: ["failure"], message: "failure must be null for pass or match the non-passing outcome" });
  }
  if (value.event.runId !== value.runId) {
    context.addIssue({ code: "custom", path: ["event", "runId"], message: "terminal event runId must match finalized run" });
  }
  const expectedType = `run.${value.outcome}`;
  if (value.event.type !== expectedType) {
    context.addIssue({ code: "custom", path: ["event", "type"], message: `terminal event type must be ${expectedType}` });
  }
});
export type FinalizeRunInput = z.infer<typeof FinalizeRunInputSchema>;

export interface FinalizeRunResult {
  readonly applied: boolean;
  readonly run: Run | null;
  readonly event: EventEnvelope | null;
}

export interface RunRepository {
  create(run: Run, signal: AbortSignal): Promise<Run>;
  get(id: RunId, signal: AbortSignal): Promise<Run | null>;
  compareAndSetStatus(id: RunId, expected: RunStatus, next: RunStatus, patch: RunStatusPatch, signal: AbortSignal): Promise<boolean>;
  listRecoverable(signal: AbortSignal): Promise<readonly Run[]>;
  transactionallyFinalize(input: FinalizeRunInput, signal: AbortSignal): Promise<FinalizeRunResult>;
}

export interface EventRepository {
  append(input: EventAppendInput, signal: AbortSignal): Promise<EventEnvelope>;
  listAfter(evaluationId: EvaluationId, cursor: EventCursor | null, limit: number, signal: AbortSignal): Promise<readonly EventEnvelope[]>;
  earliestCursor(evaluationId: EvaluationId, signal: AbortSignal): Promise<EventCursor | null>;
  latestCursor(evaluationId: EvaluationId, signal: AbortSignal): Promise<EventCursor | null>;
}

export interface BrowserSessionRepository {
  upsert(session: BrowserSessionSummary, signal: AbortSignal): Promise<BrowserSessionSummary>;
  get(runId: RunId, signal: AbortSignal): Promise<BrowserSessionSummary | null>;
  listPotentiallyLeaked(signal: AbortSignal): Promise<readonly BrowserSessionSummary[]>;
}

export interface ReplayStatusResult {
  readonly status: ReplayStatus;
  readonly checkedAt: UtcDateTime;
}

export interface ReplayAccessResult {
  readonly status: ReplayStatus;
  readonly url: SensitiveReplayUrl | null;
  readonly expiresAt: UtcDateTime | null;
}

export interface ReplayService {
  getStatus(providerSessionId: BrowserSessionId, signal: AbortSignal): Promise<ReplayStatusResult>;
  requestFreshAccess(providerSessionId: BrowserSessionId, signal: AbortSignal): Promise<ReplayAccessResult>;
}
