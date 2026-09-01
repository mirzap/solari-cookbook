import type { AgentObservation } from "../agent.ts";
import { BrowserSessionIdSchema } from "../ids.ts";
import type { JsonObject } from "../json.ts";
import type {
  BrowserAcquireRequest,
  BrowserController,
  BrowserLease,
  BrowserProvider,
  Clock,
  ElementActionInput,
  ReleaseResult,
  SensitiveBrowserEndpoint,
} from "../ports.ts";
import { warningFixture } from "./fixtures.ts";

export type ScriptedBrowserOperation =
  | "connect" | "navigate" | "observe" | "click" | "type" | "select" | "pressKey" | "scroll" | "wait" | "callNativeTool";

export interface ScriptedBrowserStep {
  readonly operation: ScriptedBrowserOperation;
  readonly observation?: AgentObservation;
  readonly result?: JsonObject;
  readonly error?: Error;
}

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
};

export class ScriptedBrowserController implements BrowserController {
  readonly calls: Array<{ operation: ScriptedBrowserOperation; input: unknown }> = [];
  #steps: ScriptedBrowserStep[];

  constructor(steps: readonly ScriptedBrowserStep[]) {
    this.#steps = [...steps];
  }

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
  async navigate(url: string, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("navigate", url, signal); }
  async observe(signal: AbortSignal): Promise<AgentObservation> { return this.#observation("observe", null, signal); }
  async click(input: ElementActionInput, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("click", input, signal); }
  async type(input: ElementActionInput & { readonly text: string; readonly clearFirst: boolean }, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("type", input, signal); }
  async select(input: ElementActionInput & { readonly value: string }, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("select", input, signal); }
  async pressKey(key: string, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("pressKey", key, signal); }
  async scroll(direction: "up" | "down", amount: number, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("scroll", { direction, amount }, signal); }
  async wait(durationMs: number, signal: AbortSignal): Promise<AgentObservation> { return this.#observation("wait", durationMs, signal); }

  async callNativeTool(name: string, arguments_: JsonObject, signal: AbortSignal): Promise<JsonObject> {
    const step = this.#take("callNativeTool", { name, arguments: arguments_ }, signal);
    if (step.result === undefined) throw new Error("Scripted native tool step requires result");
    return step.result;
  }

  remainingSteps(): number { return this.#steps.length; }

  #observation(operation: ScriptedBrowserOperation, input: unknown, signal: AbortSignal): AgentObservation {
    const step = this.#take(operation, input, signal);
    if (step.observation === undefined) throw new Error(`Scripted ${operation} step requires observation`);
    return step.observation;
  }
}

class FakeBrowserLease implements BrowserLease {
  readonly providerSessionId = BrowserSessionIdSchema.parse("browser-session-fixture");
  readonly connectEndpoint = "wss://redacted.invalid/session" as SensitiveBrowserEndpoint;
  readonly region = "test";
  readonly recordingRequested: boolean;
  releaseCalls = 0;
  #releaseResult: ReleaseResult | null = null;
  #clock: Clock;
  #failRelease: boolean;

  constructor(clock: Clock, recordingRequested: boolean, failRelease: boolean) {
    this.#clock = clock;
    this.recordingRequested = recordingRequested;
    this.#failRelease = failRelease;
  }

  async release(_reason: string, signal: AbortSignal): Promise<ReleaseResult> {
    throwIfAborted(signal);
    if (this.#releaseResult !== null) return this.#releaseResult;
    this.releaseCalls += 1;
    this.#releaseResult = {
      status: this.#failRelease ? "failed" : "released",
      releasedAt: this.#clock.nowIso(),
      warning: this.#failRelease ? warningFixture : null,
    };
    return this.#releaseResult;
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
    this.acquisitions.push(request);
    const lease = new FakeBrowserLease(this.#clock, request.recordingRequested, this.#failRelease);
    this.leases.push(lease);
    return lease;
  }
}
