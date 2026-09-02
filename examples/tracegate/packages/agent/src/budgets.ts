import type { RuntimeBudgets, TokenUsage } from "@tracegate/shared";
import { abortedError, terminalError, throwIfAborted } from "./errors.ts";

export interface BudgetProgress {
  readonly wallClockMsRemaining: number;
  readonly modelTurnsRemaining: number;
  readonly toolCallsRemaining: number;
  readonly browserActionsRemaining: number;
  readonly knownTokenLowerBound: number;
  readonly maxTotalTokens: number;
}

function validTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export class BudgetLedger {
  readonly #budget: RuntimeBudgets;
  readonly #startedAt: number;
  readonly #now: () => number;
  modelTurns = 0;
  toolCalls = 0;
  browserActions = 0;
  usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  #knownTokenLowerBound = 0;

  constructor(budget: RuntimeBudgets, now: () => number = performance.now.bind(performance)) {
    this.#budget = budget;
    this.#now = now;
    this.#startedAt = now();
  }

  checkWall(signal: AbortSignal, phase: string): void {
    throwIfAborted(signal, phase);
    if (this.#now() - this.#startedAt >= this.#budget.wallClockMs) {
      throw terminalError("budget_exhausted", "Wall-clock budget exhausted", phase);
    }
  }

  startModelTurn(signal: AbortSignal): number {
    this.checkWall(signal, "agent.model");
    if (this.modelTurns >= this.#budget.maxModelTurns) throw terminalError("budget_exhausted", "Model turn budget exhausted", "agent.model");
    return ++this.modelTurns;
  }

  admitTool(signal: AbortSignal): number {
    this.checkWall(signal, "agent.tool");
    this.toolCalls += 1;
    if (this.toolCalls > this.#budget.maxToolCalls) throw terminalError("budget_exhausted", "Tool proposal budget exhausted", "agent.tool");
    return this.toolCalls;
  }

  startBrowserAction(signal: AbortSignal): number {
    this.checkWall(signal, "agent.browser");
    if (this.browserActions >= this.#budget.maxBrowserActions) throw terminalError("budget_exhausted", "Browser action budget exhausted", "agent.browser");
    return ++this.browserActions;
  }

  addUsage(usage: TokenUsage): boolean {
    const promptTokens = validTokenCount(usage.promptTokens);
    const completionTokens = validTokenCount(usage.completionTokens);
    let totalTokens = validTokenCount(usage.totalTokens);
    let anomalous = promptTokens === null || completionTokens === null || totalTokens === null;
    if (promptTokens !== null && completionTokens !== null && totalTokens !== null &&
        promptTokens + completionTokens !== totalTokens) {
      totalTokens = null;
      anomalous = true;
    }
    this.#knownTokenLowerBound += totalTokens
      ?? ((promptTokens ?? 0) + (completionTokens ?? 0));
    this.usage = {
      promptTokens: this.usage.promptTokens === null || promptTokens === null
        ? null
        : this.usage.promptTokens + promptTokens,
      completionTokens: this.usage.completionTokens === null || completionTokens === null
        ? null
        : this.usage.completionTokens + completionTokens,
      totalTokens: this.usage.totalTokens === null || totalTokens === null
        ? null
        : this.usage.totalTokens + totalTokens,
    };
    if (this.#knownTokenLowerBound > this.#budget.maxTotalTokens) {
      throw terminalError("budget_exhausted", "Token budget exhausted", "agent.usage");
    }
    return anomalous;
  }

  progress(): BudgetProgress {
    return {
      wallClockMsRemaining: Math.max(0, Math.floor(this.#budget.wallClockMs - (this.#now() - this.#startedAt))),
      modelTurnsRemaining: Math.max(0, this.#budget.maxModelTurns - this.modelTurns),
      toolCallsRemaining: Math.max(0, this.#budget.maxToolCalls - this.toolCalls),
      browserActionsRemaining: Math.max(0, this.#budget.maxBrowserActions - this.browserActions),
      knownTokenLowerBound: this.#knownTokenLowerBound,
      maxTotalTokens: this.#budget.maxTotalTokens,
    };
  }

  async withToolTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T> {
    throwIfAborted(parent, "agent.tool");
    const controller = new AbortController();
    let rejectCancellation: ((error: unknown) => void) | null = null;
    const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    const onAbort = () => {
      controller.abort(parent.reason);
      rejectCancellation?.(abortedError("agent.tool"));
    };
    parent.addEventListener("abort", onAbort, { once: true });
    if (parent.aborted) onAbort();
    let rejectTimeout: ((error: unknown) => void) | null = null;
    const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const timer = setTimeout(() => {
      controller.abort(new Error("tool timeout"));
      rejectTimeout?.(new Error("tool timeout"));
    }, this.#budget.toolTimeoutMs);
    try {
      return await Promise.race([operation(controller.signal), cancellation, timeout]);
    } catch (error) {
      if (parent.aborted) throw abortedError("agent.tool");
      if (controller.signal.aborted) throw terminalError("budget_exhausted", "Tool timeout exhausted", "agent.tool", { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
      parent.removeEventListener("abort", onAbort);
    }
  }
}
