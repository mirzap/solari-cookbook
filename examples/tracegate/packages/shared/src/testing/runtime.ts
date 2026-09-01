import type { AgentRunResult } from "../agent.ts";
import type { DiscoveryEvidence } from "../discovery.ts";
import type {
  CreateDemoChallengeRequest,
  DemoChallengeProvision,
  DemoGradeEvidenceEnvelope,
  GetDemoGradeEvidenceRequest,
} from "../demo.ts";
import type { FailureAnalysis, GradeResult } from "../grading.ts";
import {
  EvaluationIdSchema,
  EventIdSchema,
  RunIdSchema,
  type BrowserSessionId,
  type EvaluationId,
  type EventId,
  type RunId,
} from "../ids.ts";
import type {
  AgentRunContext,
  AgentRunner,
  DiscoveryContext,
  DiscoveryController,
  DemoAdminPort,
  FailureAnalysisContext,
  FailureAnalyzer,
  GradeContext,
  Grader,
  IdGenerator,
  ReplayAccessResult,
  ReplayService,
  ReplayStatusResult,
  SensitiveReplayUrl,
} from "../ports.ts";
import type { Clock } from "../ports.ts";

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
};
const clone = <T>(value: T): T => structuredClone(value);

export class SequentialIdGenerator implements IdGenerator {
  #next = 1;

  #raw(): string {
    const suffix = this.#next.toString(16).padStart(12, "0");
    this.#next += 1;
    return `01890f00-0000-7000-8000-${suffix}`;
  }

  evaluationId(): EvaluationId { return EvaluationIdSchema.parse(this.#raw()); }
  runId(): RunId { return RunIdSchema.parse(this.#raw()); }
  eventId(): EventId { return EventIdSchema.parse(this.#raw()); }
}

export class FakeDiscoveryController implements DiscoveryController {
  readonly calls: DiscoveryContext[] = [];
  #result: DiscoveryEvidence;

  constructor(result: DiscoveryEvidence) { this.#result = clone(result); }
  async discover(context: DiscoveryContext, signal: AbortSignal): Promise<DiscoveryEvidence> {
    throwIfAborted(signal);
    this.calls.push(clone(context));
    return clone(this.#result);
  }
}

export class FakeAgentRunner implements AgentRunner {
  readonly calls: AgentRunContext[] = [];
  #result: AgentRunResult;

  constructor(result: AgentRunResult) { this.#result = clone(result); }
  async run(context: AgentRunContext, signal: AbortSignal): Promise<AgentRunResult> {
    throwIfAborted(signal);
    this.calls.push(context);
    return clone(this.#result);
  }
}

export class FakeGrader implements Grader {
  readonly calls: GradeContext[] = [];
  #result: GradeResult;

  constructor(result: GradeResult) { this.#result = clone(result); }
  async grade(context: GradeContext, signal: AbortSignal): Promise<GradeResult> {
    throwIfAborted(signal);
    this.calls.push(clone(context));
    return clone(this.#result);
  }
}

export class FakeDemoAdminPort implements DemoAdminPort {
  readonly createCalls: CreateDemoChallengeRequest[] = [];
  readonly evidenceCalls: GetDemoGradeEvidenceRequest[] = [];
  #challenge: DemoChallengeProvision;
  #evidence: DemoGradeEvidenceEnvelope;

  constructor(challenge: DemoChallengeProvision, evidence: DemoGradeEvidenceEnvelope) {
    this.#challenge = clone(challenge);
    this.#evidence = clone(evidence);
  }

  async createChallenge(request: CreateDemoChallengeRequest, signal: AbortSignal): Promise<DemoChallengeProvision> {
    throwIfAborted(signal);
    this.createCalls.push(clone(request));
    if (
      request.evaluationId !== this.#challenge.evaluationId
      || request.runId !== this.#challenge.runId
      || request.challengeId !== this.#challenge.challengeId
    ) {
      throw new Error("Configured Demo challenge does not match the create request identity");
    }
    return clone(this.#challenge);
  }

  async getGradeEvidence(request: GetDemoGradeEvidenceRequest, signal: AbortSignal): Promise<DemoGradeEvidenceEnvelope> {
    throwIfAborted(signal);
    this.evidenceCalls.push(clone(request));
    if (request.runId !== this.#evidence.runId || request.challengeId !== this.#evidence.challengeId) {
      throw new Error("Configured Demo grade evidence does not match the request identity");
    }
    return clone(this.#evidence);
  }
}

export class FakeFailureAnalyzer implements FailureAnalyzer {
  readonly calls: FailureAnalysisContext[] = [];
  #result: FailureAnalysis;

  constructor(result: FailureAnalysis) { this.#result = clone(result); }
  async analyze(context: FailureAnalysisContext, signal: AbortSignal): Promise<FailureAnalysis> {
    throwIfAborted(signal);
    this.calls.push(clone(context));
    return clone(this.#result);
  }
}

export class FakeReplayService implements ReplayService {
  readonly statusCalls: BrowserSessionId[] = [];
  readonly accessCalls: BrowserSessionId[] = [];
  #clock: Clock;
  #status: ReplayStatusResult["status"];
  #url: SensitiveReplayUrl | null;

  constructor(clock: Clock, options: { status?: ReplayStatusResult["status"]; url?: SensitiveReplayUrl | null } = {}) {
    this.#clock = clock;
    this.#status = options.status ?? "pending";
    this.#url = options.url ?? null;
  }

  async getStatus(providerSessionId: BrowserSessionId, signal: AbortSignal): Promise<ReplayStatusResult> {
    throwIfAborted(signal);
    this.statusCalls.push(providerSessionId);
    return { status: this.#status, checkedAt: this.#clock.nowIso() };
  }

  async requestFreshAccess(providerSessionId: BrowserSessionId, signal: AbortSignal): Promise<ReplayAccessResult> {
    throwIfAborted(signal);
    this.accessCalls.push(providerSessionId);
    return {
      status: this.#status,
      url: this.#status === "ready" ? this.#url : null,
      expiresAt: this.#status === "ready" && this.#url !== null ? this.#clock.nowIso() : null,
    };
  }
}
