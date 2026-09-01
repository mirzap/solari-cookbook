import type { RuntimeBudgets, TokenUsage } from "@tracegate/shared";
import { abortedError, terminalError, throwIfAborted } from "./errors.ts";

export class BudgetLedger {
  readonly #budget: RuntimeBudgets;
  readonly #startedAt: number;
  readonly #now: () => number;
  modelTurns = 0;
  toolCalls = 0;
  browserActions = 0;
  usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

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

  addUsage(usage: TokenUsage): void {
    if (usage.promptTokens === null || usage.completionTokens === null || usage.totalTokens === null ||
        usage.promptTokens + usage.completionTokens !== usage.totalTokens) {
      throw terminalError("provider_protocol_error", "Provider returned missing or inconsistent usage", "agent.usage");
    }
    this.usage = {
      promptTokens: (this.usage.promptTokens ?? 0) + usage.promptTokens,
      completionTokens: (this.usage.completionTokens ?? 0) + usage.completionTokens,
      totalTokens: (this.usage.totalTokens ?? 0) + usage.totalTokens,
    };
    if ((this.usage.totalTokens ?? 0) > this.#budget.maxTotalTokens) throw terminalError("budget_exhausted", "Token budget exhausted", "agent.usage");
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
