import {
  AgentExecutionInputV2Schema,
  AgentRunResultSchema,
  RunWarningSchema,
  redactJson,
  type AgentExecutionInputV2,
  type AgentRunResult,
  type AgentRunner,
  type RunWarning,
  type SafeAgentToolPort,
} from "@tracegate/shared";
import type { AgentModelDriverFactory } from "./model-driver.ts";
import { BudgetLedger } from "./budgets.ts";
import { abortedError, terminalError } from "./errors.ts";
import { SerializedSafeToolExecutor } from "./executor.ts";
import { AgentConversationHistory } from "./history.ts";
import { emitMilestone, noMilestones, type AgentMilestoneSink } from "./milestones.ts";
import { AgentPolicy } from "./policy.ts";
import { initialPromptMessages, runtimeProgressMessage } from "./prompts.ts";

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

function providerWarning(code: "unknown_provider_event" | "usage_unavailable"): RunWarning {
  return RunWarningSchema.parse({
    schemaVersion: 1,
    code,
    category: "model_provider",
    phase: code === "unknown_provider_event" ? "ai.routing" : "ai.usage",
    retryable: false,
    message: code === "unknown_provider_event"
      ? "Provider identity was unavailable for this run."
      : "Provider token usage was unavailable or inconsistent for this run.",
    fieldIssues: [],
    causeChain: [],
  });
}

function warningKey(warning: RunWarning): string {
  return `${warning.code}\u0000${warning.phase ?? ""}\u0000${warning.message}`;
}

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
    let providerIdentityReliable = true;
    let providerIdentityObserved = false;
    let observedDocumentTransitions = 0;
    const warnings: RunWarning[] = [];
    const warningKeys = new Set<string>();
    const appendWarning = (candidate: unknown) => {
      if (warnings.length >= 10) return;
      const parsed = RunWarningSchema.safeParse(candidate);
      if (!parsed.success) return;
      const key = warningKey(parsed.data);
      if (warningKeys.has(key)) return;
      warningKeys.add(key);
      warnings.push(parsed.data);
    };
    try {
      while (!executor.finishBelief) {
        if (externalSignal.aborted) throw abortedError("agent.run");
        if (wall.signal.aborted) throw terminalError("budget_exhausted", "Wall-clock budget exhausted", "agent.run");
        const surface = await awaitWithAbort(executor.refreshSurface(signal), signal);
        const iteration = ledger.startModelTurn(signal);
        const compacted = history.compact([runtimeProgressMessage({
          budget: ledger.progress(),
          ...executor.progress(),
        })]);
        await emitMilestone(this.#sink, { type: "run.agent.iteration", payload: { iteration, summary: "model turn started", historyBytes: compacted.historyBytes } });
        const turn = await awaitWithAbort(driver.runTurn({ messages: compacted.messages, toolSurface: surface, executor, signal }), signal);
        executor.assertTargetEvidenceAvailable();
        for (const warning of turn.warnings ?? []) appendWarning(warning);
        const turnProvider = typeof turn.resolvedProvider === "string" && /^[A-Za-z0-9 ._/-]{1,100}$/u.test(turn.resolvedProvider.trim())
          ? turn.resolvedProvider.trim()
          : null;
        if (turnProvider === null) {
          providerIdentityReliable = false;
          resolvedProvider = null;
          appendWarning(providerWarning("unknown_provider_event"));
        } else if (providerIdentityReliable && !providerIdentityObserved) {
          resolvedProvider = turnProvider;
          providerIdentityObserved = true;
        } else if (providerIdentityReliable && resolvedProvider !== turnProvider) {
          providerIdentityReliable = false;
          resolvedProvider = null;
          appendWarning(providerWarning("unknown_provider_event"));
        }
        if (ledger.addUsage(turn.usage)) appendWarning(providerWarning("usage_unavailable"));
        const documentTransition = executor.documentTransitions > observedDocumentTransitions;
        observedDocumentTransitions = executor.documentTransitions;
        history.appendTurn(turn.messages, executor.observation, { documentTransition });
        await emitMilestone(this.#sink, { type: "run.agent.message", payload: { role: "assistant", summary: String(redactJson(turn.assistantSummary, { maxStringLength: 4_000 })) } });
        if (ledger.usage.promptTokens !== null && ledger.usage.completionTokens !== null && ledger.usage.totalTokens !== null) {
          await emitMilestone(this.#sink, {
            type: "run.usage.updated",
            payload: {
              promptTokens: ledger.usage.promptTokens,
              completionTokens: ledger.usage.completionTokens,
              totalTokens: ledger.usage.totalTokens,
            },
          });
        }
      }
      const finish = executor.finishBelief;
      if (finish === null) throw terminalError("provider_protocol_error", "Agent ended without a finish belief", "agent.run");
      return AgentRunResultSchema.parse({
        schemaVersion: 2,
        completedBelief: finish.completed,
        completionDisposition: finish.completionDisposition,
        summary: finish.summary,
        iterations: ledger.modelTurns,
        toolCalls: ledger.toolCalls,
        browserActions: ledger.browserActions,
        usage: ledger.usage,
        resolvedProvider: providerIdentityReliable ? resolvedProvider : null,
        warnings,
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
