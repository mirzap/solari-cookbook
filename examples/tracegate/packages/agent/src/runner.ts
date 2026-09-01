import {
  AgentExecutionInputV2Schema,
  AgentRunResultSchema,
  redactJson,
  type AgentExecutionInputV2,
  type AgentRunResult,
  type AgentRunner,
  type SafeAgentToolPort,
} from "@tracegate/shared";
import type { AgentModelDriverFactory } from "./model-driver.ts";
import { BudgetLedger } from "./budgets.ts";
import { abortedError, terminalError } from "./errors.ts";
import { SerializedSafeToolExecutor } from "./executor.ts";
import { AgentConversationHistory } from "./history.ts";
import { emitMilestone, noMilestones, type AgentMilestoneSink } from "./milestones.ts";
import { AgentPolicy } from "./policy.ts";
import { initialPromptMessages } from "./prompts.ts";

export const VERIFIED_DEEPSEEK_MODEL = "deepseek/deepseek-v4-flash-0731" as const;

export interface TraceGateAgentRunnerOptions {
  readonly modelId?: typeof VERIFIED_DEEPSEEK_MODEL;
  readonly sampling?: {
    readonly temperature: number;
    readonly topP: number;
    readonly providerRouting: {
      readonly allowProviders: readonly string[];
      readonly order: "price" | "latency" | "throughput" | null;
    } | null;
  };
  readonly sink?: AgentMilestoneSink;
  readonly now?: () => number;
}

const DEFAULT_SAMPLING = { temperature: 0.2, topP: 1, providerRouting: null } as const;

async function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortedError("agent.run");
  let rejectCancellation: ((error: unknown) => void) | null = null;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const onAbort = () => rejectCancellation?.(abortedError("agent.run"));
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try { return await Promise.race([operation, cancellation]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export class TraceGateAgentRunner implements AgentRunner {
  readonly #factory: AgentModelDriverFactory;
  readonly #modelId: typeof VERIFIED_DEEPSEEK_MODEL;
  readonly #sampling: NonNullable<TraceGateAgentRunnerOptions["sampling"]>;
  readonly #sink: AgentMilestoneSink;
  readonly #now: () => number;

  constructor(factory: AgentModelDriverFactory, options: TraceGateAgentRunnerOptions = {}) {
    this.#factory = factory;
    this.#modelId = options.modelId ?? VERIFIED_DEEPSEEK_MODEL;
    this.#sampling = options.sampling ?? DEFAULT_SAMPLING;
    this.#sink = options.sink ?? noMilestones;
    this.#now = options.now ?? performance.now.bind(performance);
  }

  async run(inputValue: AgentExecutionInputV2, safeTools: SafeAgentToolPort, externalSignal: AbortSignal): Promise<AgentRunResult> {
    const input = AgentExecutionInputV2Schema.parse(inputValue);
    const wall = new AbortController();
    const timer = setTimeout(() => wall.abort(new Error("wall-clock deadline")), input.budgets.wallClockMs);
    const signal = AbortSignal.any([externalSignal, wall.signal]);
    const ledger = new BudgetLedger(input.budgets, this.#now);
    const policy = new AgentPolicy(input.capabilities);
    policy.assertObservation(input.initialObservation);
    const base = initialPromptMessages(input);
    const history = new AgentConversationHistory(base, input.initialObservation, input.budgets.maxObservationBytes, input.budgets.maxHistoryBytes);
    const executor = new SerializedSafeToolExecutor({ tools: safeTools, ledger, policy, observation: input.initialObservation, signal, sink: this.#sink, now: this.#now });
    const driver = this.#factory({ modelId: this.#modelId, sampling: this.#sampling });
    let resolvedProvider: string | null = null;
    try {
      while (!executor.finishBelief) {
        if (externalSignal.aborted) throw abortedError("agent.run");
        if (wall.signal.aborted) throw terminalError("budget_exhausted", "Wall-clock budget exhausted", "agent.run");
        const surface = await awaitWithAbort(executor.refreshSurface(signal), signal);
        const iteration = ledger.startModelTurn(signal);
        const compacted = history.compact();
        await emitMilestone(this.#sink, { type: "run.agent.iteration", payload: { iteration, summary: "model turn started", historyBytes: compacted.historyBytes } });
        const turn = await awaitWithAbort(driver.runTurn({ messages: compacted.messages, toolSurface: surface, executor, signal }), signal);
        executor.assertTargetEvidenceAvailable();
        if (!turn.resolvedProvider.trim()) throw terminalError("provider_protocol_error", "Resolved provider is missing", "agent.model");
        if (resolvedProvider && resolvedProvider !== turn.resolvedProvider) throw terminalError("provider_protocol_error", "Provider changed during a run", "agent.model");
        resolvedProvider = turn.resolvedProvider;
        ledger.addUsage(turn.usage);
        history.appendTurn(turn.messages, executor.observation);
        await emitMilestone(this.#sink, { type: "run.agent.message", payload: { role: "assistant", summary: String(redactJson(turn.assistantSummary, { maxStringLength: 4_000 })) } });
        await emitMilestone(this.#sink, { type: "run.usage.updated", payload: { promptTokens: ledger.usage.promptTokens!, completionTokens: ledger.usage.completionTokens!, totalTokens: ledger.usage.totalTokens! } });
      }
      const finish = executor.finishBelief;
      if (finish === null) throw terminalError("provider_protocol_error", "Agent ended without a finish belief", "agent.run");
      return AgentRunResultSchema.parse({
        schemaVersion: 2,
        completedBelief: finish.completed,
        summary: finish.summary,
        iterations: ledger.modelTurns,
        toolCalls: ledger.toolCalls,
        browserActions: ledger.browserActions,
        usage: ledger.usage,
        resolvedProvider,
        warnings: [],
      });
    } catch (error) {
      if (externalSignal.aborted) throw abortedError("agent.run");
      if (wall.signal.aborted) throw terminalError("budget_exhausted", "Wall-clock budget exhausted", "agent.run", { cause: error });
      executor.assertTargetEvidenceAvailable();
      throw error;
    } finally {
      clearTimeout(timer);
      await driver.dispose?.();
    }
  }
}
