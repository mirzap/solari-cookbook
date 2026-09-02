import {
  AgentTraceEventSchema,
  AgentTraceProjectionSchema,
  CreateEvaluationRequestSchema,
  CreateEvaluationResponseSchema,
  EvaluationReportProjectionSchema,
  EvaluationSchema,
  EventAppendInputSchema,
  EventListResponseSchema,
  HealthResponseSchema,
  ConfiguredMcpReadinessV1Schema,
  InterfaceUsageSummarySchema,
  RunQueuedEventAppendInputSchema,
  RunSchema,
  RuntimeCapabilitiesSchema,
  RuntimeCapabilitySchema,
  TraceGateError,
  UtcDateTimeSchema,
  classifyPromptAdmission,
  createControlError,
  redactError,
  type AgentTraceProjection,
  type CancelRunInput,
  type CancelRunResult,
  type CreateEvaluationResponse,
  type EvaluationId,
  type EvaluationReportProjection,
  type EvaluationSnapshot,
  type EventAppendInput,
  type EventCursor,
  type EventEnvelope,
  type EventListResponse,
  type Evaluation,
  type FinalizeRunInput,
  type FinalizeRunResult,
  type HealthResponse,
  type IdGenerator,
  type IntermediateRunTransitionInput,
  type IntermediateRunTransitionResult,
  type InterfaceUsageSummary,
  type Run,
  type RunSnapshot,
  type RuntimeCapabilities,
  type UtcDateTime,
} from "@tracegate/shared";
import {
  TracegateDatabase,
  type PersistRunEventStepInput,
  type PersistedRunEventStep,
  type PersistRunMilestoneInput,
  type PersistedRunMilestone,
} from "@tracegate/db";

import { projectInterfaceUsageMetrics } from "../lib/interface-usage.ts";
import { UuidV7Generator } from "./ids.ts";
import {
  createMilestoneSseResponse,
  type MilestoneSubscriber,
  type MilestoneSubscriptionSource,
  type SseOptions,
} from "./sse.ts";

class PersistedMilestoneBus implements MilestoneSubscriptionSource {
  readonly #subscribers = new Map<EvaluationId, Set<MilestoneSubscriber>>();

  publish(event: EventEnvelope): void {
    const subscribers = this.#subscribers.get(event.evaluationId);
    if (subscribers === undefined) return;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(event);
      } catch {
        subscribers.delete(subscriber);
      }
    }
    if (subscribers.size === 0) this.#subscribers.delete(event.evaluationId);
  }

  subscribe(evaluationId: EvaluationId, subscriber: MilestoneSubscriber): () => void {
    const subscribers = this.#subscribers.get(evaluationId) ?? new Set<MilestoneSubscriber>();
    subscribers.add(subscriber);
    this.#subscribers.set(evaluationId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.#subscribers.delete(evaluationId);
    };
  }

  subscriberCount(evaluationId: EvaluationId): number {
    return this.#subscribers.get(evaluationId)?.size ?? 0;
  }
}

const FUNCTIONAL_MODEL_IDS = new Set(["deepseek/deepseek-v4-flash-0731"]);

function summarizeInterfaceUsage(runs: readonly RunSnapshot[], events: readonly EventEnvelope[] = []): InterfaceUsageSummary {
  return InterfaceUsageSummarySchema.parse({
    schemaVersion: 1,
    metrics: projectInterfaceUsageMetrics(runs, events).map(({
      usedRunIds: _usedRunIds,
      durationMs: _durationMs,
      ...metric
    }) => metric),
  });
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function deniedToolArray(value: unknown): readonly { readonly name: string; readonly code: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("name" in item) || !("code" in item)) return [];
    return typeof item.name === "string" && typeof item.code === "string" ? [{ name: item.name, code: item.code }] : [];
  });
}

export interface EvaluationSubmissionReservation {
  commit(): void;
  release(): void;
}

export interface EvaluationSubmissionScheduler {
  reserve(evaluation: Evaluation, runs: readonly Run[]): EvaluationSubmissionReservation;
}

export interface TracegateServerOptions {
  readonly ids?: IdGenerator;
  readonly now?: () => Date;
  readonly scheduler?: EvaluationSubmissionScheduler;
}

function schedulerConflict(error: unknown): TraceGateError | null {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
  const message = code === "evaluation_queue_full"
    ? "TraceGate is at capacity. Try again after an evaluation finishes."
    : code === "duplicate_evaluation_job"
      ? "This evaluation is already queued or running."
      : code === "invalid_evaluation_queue_reservation_state"
        ? "This evaluation could not be queued in its current state."
        : null;
  return message === null ? null : new TraceGateError(createControlError("conflict", message, {
    category: "incorrect_state",
    phase: "evaluation_queue_admission",
    retryable: code === "evaluation_queue_full",
  }));
}

export class TracegateServer {
  readonly #milestones = new PersistedMilestoneBus();
  readonly #ids: IdGenerator;
  readonly #now: () => Date;
  readonly #scheduler: EvaluationSubmissionScheduler | undefined;
  readonly database: TracegateDatabase;

  constructor(database: TracegateDatabase, options: TracegateServerOptions = {}) {
    this.database = database;
    this.#ids = options.ids ?? new UuidV7Generator();
    this.#now = options.now ?? (() => new Date());
    this.#scheduler = options.scheduler;
  }

  async createEvaluation(inputValue: unknown, signal: AbortSignal): Promise<CreateEvaluationResponse> {
    const rawPrompt = typeof inputValue === "object" && inputValue !== null && "prompt" in inputValue
      ? inputValue.prompt
      : undefined;
    if (typeof rawPrompt === "string") {
      const admission = classifyPromptAdmission(rawPrompt);
      if (admission.decision === "reject") {
        throw new TraceGateError(createControlError("unsafe_prompt_rejected", admission.message, {
          category: "policy",
          phase: "prompt_admission",
        }));
      }
    }

    const input = CreateEvaluationRequestSchema.parse(inputValue);
    const capabilities = await this.getCapabilities(signal);
    const unavailableModels = input.modelIds.filter((modelId) => !FUNCTIONAL_MODEL_IDS.has(modelId) || !capabilities.checks.some(
      (check) => check.kind === "model" && check.subject === modelId && (check.status === "pending" || check.status === "verified"),
    ));
    const recordingVerified = capabilities.checks.some(
      (check) => check.kind === "replay" && check.status === "verified",
    );
    if (capabilities.blockerCodes.length > 0 || unavailableModels.length > 0 || (input.recordingRequested && !recordingVerified)) {
      throw new TraceGateError(createControlError(
        "capability_blocked",
        unavailableModels.length > 0
          ? "The selected model is not available in this version."
          : input.recordingRequested && !recordingVerified
            ? "Recording and replay are not available in this version."
            : "Evaluation creation is blocked by unavailable runtime capabilities.",
        { category: "infrastructure", phase: "evaluation_create" },
      ));
    }

    const now = this.nowIso();
    const evaluationId = this.#ids.evaluationId();
    const evaluation = EvaluationSchema.parse({
      schemaVersion: 2,
      id: evaluationId,
      config: input,
      status: "queued",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      failure: null,
    });

    const runs = [];
    let runIndex = 0;
    for (const modelId of input.modelIds) {
      for (let repetition = 0; repetition < input.requestedRunsPerModel; repetition += 1) {
        runs.push(RunSchema.parse({
          schemaVersion: 2,
          id: this.#ids.runId(),
          evaluationId,
          runIndex,
          modelId,
          resolvedProvider: null,
          status: "queued",
          outcome: null,
          createdAt: now,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          iterations: 0,
          toolCalls: 0,
          browserActions: 0,
          usage: { promptTokens: null, completionTokens: null, totalTokens: null },
          failure: null,
          grade: null,
          replayStatus: "not_requested",
          releaseStatus: "not_started",
          warnings: [],
          potentialSessionLeak: false,
        }));
        runIndex += 1;
      }
    }

    const queuedEvents = runs.map((run) => RunQueuedEventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: this.#ids.eventId(),
      evaluationId,
      runId: run.id,
      runSequence: 0,
      type: "run.queued",
      occurredAt: now,
      payload: { runIndex: run.runIndex },
    }));

    let reservation: EvaluationSubmissionReservation | undefined;
    try {
      reservation = this.#scheduler?.reserve(evaluation, runs);
    } catch (error) {
      throw schedulerConflict(error) ?? error;
    }

    let persisted;
    try {
      persisted = await this.database.transactionallyCreateSubmission({ evaluation, runs, queuedEvents }, signal);
    } catch (error) {
      reservation?.release();
      throw error;
    }
    this.#publishPersisted(persisted.queuedEvents);
    try {
      reservation?.commit();
    } catch (error) {
      throw schedulerConflict(error) ?? error;
    }
    return CreateEvaluationResponseSchema.parse({
      evaluationId,
      status: evaluation.status,
      runIds: runs.map((run) => run.id),
      latestCursor: persisted.queuedEvents.at(-1)?.cursor ?? null,
    });
  }

  getSnapshot(evaluationId: EvaluationId, signal: AbortSignal): Promise<EvaluationSnapshot | null> {
    return this.database.getEvaluationSnapshot(evaluationId, signal);
  }

  async getReport(evaluationId: EvaluationId, signal: AbortSignal): Promise<EvaluationReportProjection | null> {
    const persisted = await this.database.getEvaluationReport(evaluationId, signal);
    if (persisted === null) return null;
    const url = new URL(persisted.snapshot.config.target.startUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const configuredMcp = persisted.snapshot.config.configuredMcpEndpoints?.flatMap((endpoint) => {
      const match = [...persisted.interfaces].reverse().find((item) => item.kind === "configured_mcp"
        && item.metadata.endpointId === endpoint.id
        && item.metadata.status !== "unavailable");
      if (match === undefined) return [];
      const readiness = ConfiguredMcpReadinessV1Schema.safeParse({
        schemaVersion: 1,
        endpointId: endpoint.id,
        label: endpoint.label,
        transport: endpoint.transport,
        selectedTools: stringArray(match.metadata.selectedTools),
        admittedTools: stringArray(match.metadata.admittedTools),
        deniedTools: deniedToolArray(match.metadata.deniedTools),
      });
      return readiness.success ? [readiness.data] : [];
    }) ?? [];
    const interfaceUsage = summarizeInterfaceUsage(persisted.snapshot.runs, persisted.events);
    return EvaluationReportProjectionSchema.parse({
      schemaVersion: 2,
      evaluationId,
      prompt: persisted.snapshot.config.prompt,
      target: {
        redactedDisplayUrl: url.toString(),
        allowedNavigationOrigins: persisted.snapshot.config.target.allowedNavigationOrigins,
      },
      assertions: persisted.snapshot.config.assertions,
      aggregate: persisted.snapshot.aggregate,
      runs: persisted.snapshot.runs,
      interfaceReadiness: {
        mode: persisted.snapshot.config.interfaceMode,
        pageWebMcpEnabled: persisted.snapshot.config.webMcpReadOnlyEnabled,
        configuredMcp,
        usage: interfaceUsage,
      },
      observableStateLimitation: "PASS proves declared browser-observable assertions only, not arbitrary backend business truth.",
    });
  }

  async getAgentTrace(
    evaluationId: EvaluationId,
    afterCursor: EventCursor | null,
    signal: AbortSignal,
  ): Promise<AgentTraceProjection | null> {
    const persisted = await this.database.getEvaluationReport(evaluationId, signal);
    if (persisted === null) return null;
    const items = persisted.events.flatMap((event) => {
      if (afterCursor !== null && BigInt(event.cursor) <= BigInt(afterCursor)) return [];
      if (event.runId === null || event.runSequence === null) return [];
      const parsed = AgentTraceEventSchema.safeParse({ type: event.type, payload: event.payload });
      if (!parsed.success) return [];
      return [{ cursor: event.cursor, runId: event.runId, runSequence: event.runSequence, occurredAt: event.occurredAt, event: parsed.data }];
    });
    return AgentTraceProjectionSchema.parse({
      schemaVersion: 1,
      evaluationId,
      items: items.slice(0, 200),
      interfaceMode: persisted.snapshot.config.interfaceMode,
      interfaceUsage: summarizeInterfaceUsage(persisted.snapshot.runs, persisted.events),
      truncated: items.length > 200,
      nextCursor: items.length > 200 ? items[199]?.cursor ?? null : null,
    });
  }

  async getEvents(evaluationId: EvaluationId, cursor: EventCursor | null, signal: AbortSignal): Promise<EventListResponse | null> {
    if (await this.database.getEvaluation(evaluationId, signal) === null) return null;
    const events = await this.database.listEventsAfter(evaluationId, cursor, 100, signal);
    return EventListResponseSchema.parse({
      events,
      earliestCursor: await this.database.earliestEventCursor(evaluationId, signal),
      latestCursor: await this.database.latestEventCursor(evaluationId, signal),
      truncated: events.length === 100,
      nextCursor: events.length === 100 ? events.at(-1)?.cursor ?? null : null,
    });
  }

  async getCapabilities(signal: AbortSignal): Promise<RuntimeCapabilities> {
    const checkedAt = this.nowIso();
    let persisted = [] as Awaited<ReturnType<TracegateDatabase["listCapabilities"]>>;
    let databaseCheck;
    try {
      await this.database.ping(signal);
      persisted = await this.database.listCapabilities(signal);
      databaseCheck = RuntimeCapabilitySchema.parse({
        schemaVersion: 1,
        kind: "database",
        subject: "libsql-v2",
        status: "verified",
        details: { migration: "0000", writer: "serialized", publication: "after_commit" },
        checkedAt,
        error: null,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      databaseCheck = RuntimeCapabilitySchema.parse({
        schemaVersion: 1,
        kind: "database",
        subject: "libsql-v2",
        status: "failed",
        details: {},
        checkedAt,
        error: createControlError("service_unavailable", redactError(error).message, {
          category: "infrastructure",
          phase: "database_health",
          retryable: true,
        }),
      });
    }
    const checks = [databaseCheck, ...persisted.filter((check) => check.kind !== "database")];
    const blockerCodes: string[] = [];
    if (databaseCheck.status !== "verified") blockerCodes.push("database_unhealthy");
    if (!checks.some((check) => check.kind === "model" && (check.status === "pending" || check.status === "verified"))) blockerCodes.push("no_verified_model");
    if (!checks.some((check) => check.kind === "solari" && (check.status === "pending" || check.status === "verified"))) blockerCodes.push("solari_unavailable");
    return RuntimeCapabilitiesSchema.parse({ schemaVersion: 1, checks, blockerCodes, checkedAt });
  }

  async health(signal: AbortSignal): Promise<HealthResponse> {
    const capabilities = await this.getCapabilities(signal);
    const database = capabilities.checks.find((check) => check.kind === "database");
    const model = capabilities.checks.find((check) => check.kind === "model" && (check.status === "pending" || check.status === "verified"));
    const solari = capabilities.checks.find((check) => check.kind === "solari" && (check.status === "pending" || check.status === "verified"));
    const hasPendingLiveCheck = model?.status === "pending" || solari?.status === "pending";
    const status = database?.status !== "verified" ? "unavailable" : capabilities.blockerCodes.length > 0 || hasPendingLiveCheck ? "degraded" : "ok";
    return HealthResponseSchema.parse({
      status,
      checkedAt: capabilities.checkedAt,
      dependencies: {
        database: database?.status === "verified" ? "ok" : "unavailable",
        model: capabilities.blockerCodes.includes("no_verified_model") ? "unavailable" : model?.status === "verified" ? "ok" : "degraded",
        solari: capabilities.blockerCodes.includes("solari_unavailable") ? "unavailable" : solari?.status === "verified" ? "ok" : "degraded",
        webmcp: capabilities.checks.some((check) => check.kind === "webmcp" && check.status === "verified") ? "ok" : "degraded",
      },
    });
  }

  async persistMilestone(input: PersistRunMilestoneInput, signal: AbortSignal): Promise<PersistedRunMilestone> {
    const persisted = await this.database.persistRunMilestone(input, signal);
    this.#publishPersisted([persisted.event]);
    return persisted;
  }

  async appendRunEventStep(input: PersistRunEventStepInput, signal: AbortSignal): Promise<PersistedRunEventStep> {
    const persisted = await this.database.appendRunEventStep(input, signal);
    this.#publishPersisted([persisted.event]);
    return persisted;
  }

  async applyRunTransition(input: IntermediateRunTransitionInput, signal: AbortSignal): Promise<IntermediateRunTransitionResult> {
    const persisted = await this.database.transactionallyApplyRunTransition(input, signal);
    if (persisted.event !== null) this.#publishPersisted([persisted.event]);
    return persisted;
  }

  async cancelRun(input: CancelRunInput, signal: AbortSignal): Promise<CancelRunResult> {
    const persisted = await this.database.transactionallyCancel(input, signal);
    if (persisted.event !== null) this.#publishPersisted([persisted.event]);
    return persisted;
  }

  async appendEvent(input: EventAppendInput, signal: AbortSignal): Promise<EventEnvelope> {
    const persisted = await this.database.appendEvent(input, signal);
    this.#publishPersisted([persisted]);
    return persisted;
  }

  async finalizeRun(input: FinalizeRunInput, signal: AbortSignal): Promise<FinalizeRunResult> {
    const persisted = await this.database.transactionallyFinalize(input, signal);
    if (persisted.event !== null) this.#publishPersisted([persisted.event]);
    return persisted;
  }

  async eventStream(evaluationId: EvaluationId, signal: AbortSignal, options?: SseOptions): Promise<Response | null> {
    if (await this.database.getEvaluation(evaluationId, signal) === null) return null;
    return createMilestoneSseResponse(this.#milestones, evaluationId, signal, options);
  }

  subscriberCount(evaluationId: EvaluationId): number {
    return this.#milestones.subscriberCount(evaluationId);
  }

  #publishPersisted(events: readonly EventEnvelope[]): void {
    for (const event of events) this.#milestones.publish(event);
  }

  private nowIso(): UtcDateTime {
    return UtcDateTimeSchema.parse(this.#now().toISOString());
  }
}
