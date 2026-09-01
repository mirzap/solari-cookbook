import type { AgentExecutionInputV2, AgentRunResult } from "../agent.ts";
import type { DiscoveryEvidence } from "../discovery.ts";
import type { AssertionCaptureResult } from "../evidence.ts";
import type { FailureAnalysis, GradeInputV2, GradeResultV2 } from "../grading.ts";
import {
  CreateAttemptCorrelationIdSchema,
  EvaluationIdSchema,
  EventIdSchema,
  RunIdSchema,
  type BrowserSessionId,
  type CreateAttemptCorrelationId,
  type EvaluationId,
  type EventId,
  type RunId,
} from "../ids.ts";
import type {
  AgentRunner,
  AssertionCaptureInput,
  AssertionEvidenceCapture,
  BrowserController,
  Clock,
  DiscoveryContext,
  DiscoveryController,
  FailureAnalysisContext,
  FailureAnalyzer,
  Grader,
  IdGenerator,
  ReplayAccessResult,
  ReplayService,
  ReplayStatusResult,
  SafeAgentToolPort,
  SensitiveReplayUrl,
  TargetAdmissionPort,
} from "../ports.ts";
import type { PublicEvaluationTargetV2, TargetAdmissionResult } from "../targets.ts";

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
  createAttemptCorrelationId(): CreateAttemptCorrelationId { return CreateAttemptCorrelationIdSchema.parse(`create-${this.#raw()}`); }
}

export class FakeTargetAdmissionPort implements TargetAdmissionPort {
  readonly calls: PublicEvaluationTargetV2[] = [];
  #result: TargetAdmissionResult;

  constructor(result: TargetAdmissionResult) { this.#result = clone(result); }

  async assess(target: PublicEvaluationTargetV2, signal: AbortSignal): Promise<TargetAdmissionResult> {
    throwIfAborted(signal);
    this.calls.push(clone(target));
    return clone(this.#result);
  }
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
  readonly calls: Array<{ input: AgentExecutionInputV2; safeTools: SafeAgentToolPort }> = [];
  #result: AgentRunResult;

  constructor(result: AgentRunResult) { this.#result = clone(result); }
  async run(input: AgentExecutionInputV2, safeTools: SafeAgentToolPort, signal: AbortSignal): Promise<AgentRunResult> {
    throwIfAborted(signal);
    this.calls.push({ input: clone(input), safeTools });
    return clone(this.#result);
  }
}

export class FakeAssertionEvidenceCapture implements AssertionEvidenceCapture {
  readonly calls: Array<{ controller: BrowserController; input: AssertionCaptureInput }> = [];
  #result: AssertionCaptureResult;

  constructor(result: AssertionCaptureResult) { this.#result = clone(result); }

  async capture(controller: BrowserController, input: AssertionCaptureInput, signal: AbortSignal): Promise<AssertionCaptureResult> {
    throwIfAborted(signal);
    this.calls.push({ controller, input: clone(input) });
    return clone(this.#result);
  }
}

export class FakeGrader implements Grader {
  readonly calls: GradeInputV2[] = [];
  #result: GradeResultV2;

  constructor(result: GradeResultV2) { this.#result = clone(result); }
  async grade(input: GradeInputV2, signal: AbortSignal): Promise<GradeResultV2> {
    throwIfAborted(signal);
    this.calls.push(clone(input));
    return clone(this.#result);
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
