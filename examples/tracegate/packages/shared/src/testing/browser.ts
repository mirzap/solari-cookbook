import {
  SafeAgentToolExchangeSchema,
  type AgentObservation,
  type SafeAgentAction,
  type SafeAgentToolResult,
  type SafeAgentToolSurface,
} from "../agent.ts";
import {
  BrowserSessionIdSchema,
  type BrowserSessionId,
  type CreateAttemptCorrelationId,
  type ObservationRevision,
} from "../ids.ts";
import {
  ProviderCapacityStateSchema,
  type BrowserAcquireRequest,
  type BrowserController,
  type BrowserControllerFactory,
  type BrowserLease,
  type BrowserProvider,
  type Clock,
  type ElementActionInput,
  type ProviderCapacityPort,
  type ProviderCapacityState,
  type ProviderCreateReconciliationResult,
  type ProviderSessionReconciliationPort,
  type ReleaseResult,
  type SafeAgentToolPort,
  type SensitiveBrowserEndpoint,
} from "../ports.ts";
import { cleanupWarningFixture } from "./fixtures.ts";

export type ScriptedBrowserOperation =
  | "connect" | "close" | "navigate" | "observe" | "click" | "type" | "select" | "pressKey" | "scroll" | "wait";

export interface ScriptedBrowserStep {
  readonly operation: ScriptedBrowserOperation;
  readonly observation?: AgentObservation;
  readonly error?: Error;
}

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
};
const clone = <T>(value: T): T => structuredClone(value);

export class ScriptedBrowserController implements BrowserController {
  readonly calls: Array<{ operation: ScriptedBrowserOperation; input: unknown }> = [];
  #steps: ScriptedBrowserStep[];
  #closed = false;

  constructor(steps: readonly ScriptedBrowserStep[]) { this.#steps = [...steps]; }

  #take(operation: ScriptedBrowserOperation, input: unknown, signal: AbortSignal): ScriptedBrowserStep {
    throwIfAborted(signal);
    this.calls.push({ operation, input });
    const step = this.#steps.shift();
    if (step === undefined || step.operation !== operation) {
      throw new Error(`Expected scripted operation ${step?.operation ?? "<none>"}, received ${operation}`);
    }
    if (step.error) throw step.error;
    return step;
  }

  async connect(lease: BrowserLease, signal: AbortSignal): Promise<void> { this.#take("connect", lease.providerSessionId, signal); }
  async close(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (this.#closed) return;
    this.#take("close", null, signal);
    this.#closed = true;
  }
  async navigate(url: string, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("navigate", url, signal); }
  async observe(signal: AbortSignal): Promise<AgentObservation> { return this.#observation("observe", null, signal); }
  async click(input: ElementActionInput, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("click", input, signal); }
  async type(input: ElementActionInput & { readonly text: string; readonly clearFirst: boolean }, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("type", input, signal); }
  async select(input: ElementActionInput & { readonly value: string }, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("select", input, signal); }
  async pressKey(input: ElementActionInput & { readonly key: string }, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("pressKey", input, signal); }
  async scroll(direction: "up" | "down", amount: number, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("scroll", { direction, amount }, signal); }
  async wait(durationMs: number, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("wait", durationMs, signal); }

  remainingSteps(): number { return this.#steps.length; }

  #observation(operation: ScriptedBrowserOperation, input: unknown, signal: AbortSignal): AgentObservation {
    const step = this.#take(operation, input, signal);
    if (step.observation === undefined) throw new Error(`Scripted ${operation} step requires observation`);
    return clone(step.observation);
  }
}

class FakeBrowserLease implements BrowserLease {
  readonly providerSessionId: BrowserSessionId;
  readonly connectEndpoint = "wss://redacted.invalid/session" as SensitiveBrowserEndpoint;
  readonly region = "test";
  readonly recordingRequested: boolean;
  releaseCalls = 0;
  #releaseResult: ReleaseResult | null = null;
  #clock: Clock;
  #failRelease: boolean;

  constructor(clock: Clock, recordingRequested: boolean, failRelease: boolean, providerSessionId: BrowserSessionId) {
    this.#clock = clock;
    this.providerSessionId = providerSessionId;
    this.recordingRequested = recordingRequested;
    this.#failRelease = failRelease;
  }

  async release(_reason: string, signal: AbortSignal): Promise<ReleaseResult> {
    throwIfAborted(signal);
    if (this.#releaseResult !== null) return this.#releaseResult;
    this.releaseCalls += 1;
    this.#releaseResult = this.#failRelease
      ? { status: "failed", confirmation: "unconfirmed", releasedAt: null, warning: cleanupWarningFixture }
      : { status: "released", confirmation: "confirmed_released", releasedAt: this.#clock.nowIso(), warning: null };
    return clone(this.#releaseResult);
  }
}

export class FakeBrowserProvider implements BrowserProvider {
  readonly acquisitions: BrowserAcquireRequest[] = [];
  readonly leases: BrowserLease[] = [];
  #clock: Clock;
  #failRelease: boolean;

  constructor(clock: Clock, options: { failRelease?: boolean } = {}) {
    this.#clock = clock;
    this.#failRelease = options.failRelease ?? false;
  }

  async acquire(request: BrowserAcquireRequest, signal: AbortSignal): Promise<BrowserLease> {
    throwIfAborted(signal);
    this.acquisitions.push(clone(request));
    const providerSessionId = BrowserSessionIdSchema.parse(`browser-session-fixture-${this.leases.length + 1}`);
    const lease = new FakeBrowserLease(this.#clock, request.recordingRequested, this.#failRelease, providerSessionId);
    this.leases.push(lease);
    return lease;
  }
}

export class FakeBrowserControllerFactory implements BrowserControllerFactory {
  readonly leases: BrowserLease[] = [];
  #controllers: BrowserController[];

  constructor(controllers: readonly BrowserController[]) { this.#controllers = [...controllers]; }

  async create(lease: BrowserLease, signal: AbortSignal): Promise<BrowserController> {
    throwIfAborted(signal);
    const controller = this.#controllers.shift();
    if (controller === undefined) throw new Error("No scripted browser controller remains");
    this.leases.push(lease);
    return controller;
  }
}

export class FakeSafeAgentToolPort implements SafeAgentToolPort {
  readonly surfaceCalls: ObservationRevision[] = [];
  readonly actions: SafeAgentAction[] = [];
  #surface: SafeAgentToolSurface;
  #results: SafeAgentToolResult[];

  constructor(surface: SafeAgentToolSurface, results: readonly SafeAgentToolResult[] = []) {
    this.#surface = clone(surface);
    this.#results = [...results].map(clone);
  }

  async surface(observationRevision: ObservationRevision, signal: AbortSignal): Promise<SafeAgentToolSurface> {
    throwIfAborted(signal);
    this.surfaceCalls.push(observationRevision);
    return clone({ ...this.#surface, observationRevision });
  }

  async execute(action: SafeAgentAction, signal: AbortSignal): Promise<SafeAgentToolResult> {
    throwIfAborted(signal);
    this.actions.push(clone(action));
    const result = this.#results.shift();
    if (result === undefined) throw new Error("No scripted safe-tool result remains");
    SafeAgentToolExchangeSchema.parse({ action, result });
    return clone(result);
  }
}

export class FakeProviderSessionReconciliationPort implements ProviderSessionReconciliationPort {
  readonly reconcileCalls: CreateAttemptCorrelationId[] = [];
  readonly releaseCalls: BrowserSessionId[] = [];
  #result: ProviderCreateReconciliationResult;
  #releaseResult: ReleaseResult;

  constructor(result: ProviderCreateReconciliationResult, releaseResult: ReleaseResult) {
    this.#result = clone(result);
    this.#releaseResult = clone(releaseResult);
  }

  async reconcileCreate(attemptCorrelationId: CreateAttemptCorrelationId, signal: AbortSignal): Promise<ProviderCreateReconciliationResult> {
    throwIfAborted(signal);
    this.reconcileCalls.push(attemptCorrelationId);
    if (this.#result.attemptCorrelationId !== attemptCorrelationId) throw new Error("Reconciliation result correlation mismatch");
    return clone(this.#result);
  }

  async releaseReconciled(providerSessionId: BrowserSessionId, _reason: string, signal: AbortSignal): Promise<ReleaseResult> {
    throwIfAborted(signal);
    this.releaseCalls.push(providerSessionId);
    return clone(this.#releaseResult);
  }
}

export class FakeProviderCapacityPort implements ProviderCapacityPort {
  readonly reductions: Array<number | null> = [];
  #state: ProviderCapacityState;

  constructor(configuredMaximum = 5, effectiveCapacity = configuredMaximum) {
    this.#state = ProviderCapacityStateSchema.parse({ configuredMaximum, effectiveCapacity, retryAfterMs: null });
  }

  async current(signal: AbortSignal): Promise<ProviderCapacityState> {
    throwIfAborted(signal);
    return clone(this.#state);
  }

  async reduceAfterLimit(retryAfterMs: number | null, signal: AbortSignal): Promise<ProviderCapacityState> {
    throwIfAborted(signal);
    this.reductions.push(retryAfterMs);
    this.#state = ProviderCapacityStateSchema.parse({
      ...this.#state,
      effectiveCapacity: Math.max(1, this.#state.effectiveCapacity - 1),
      retryAfterMs,
    });
    return clone(this.#state);
  }
}
