import assert from "node:assert/strict";
import test from "node:test";
import {
  SafeAgentToolExchangeSchema,
  TraceGateError,
  type SafeActionEffect,
  type SafeAgentAction,
  type SafeAgentToolName,
  type SafeAgentToolPort,
  type SafeAgentToolResult,
  type UntrustedAgentObservation,
  type WebMcpToolDescriptorV1,
} from "@tracegate/shared";
import { agentExecutionInputFixture, observationFixture, webMcpResultFixture, webMcpToolDescriptorFixture } from "@tracegate/shared/testing";
import { BudgetLedger } from "./budgets.ts";
import { SerializedSafeToolExecutor } from "./executor.ts";
import type { AgentModelDriver, AgentModelTurnInput } from "./model-driver.ts";
import { AgentPolicy } from "./policy.ts";
import { TraceGateAgentRunner } from "./runner.ts";

const observation = (revision: number, text = `revision ${revision}`): UntrustedAgentObservation => ({
  ...observationFixture, revision, visibleText: text,
  elements: [{ ...observationFixture.elements[0]!, ref: `e:${revision}:1` }],
});

const effects: Record<SafeAgentToolName, SafeActionEffect> = {
  navigate: "admitted_get_navigation", inspect: "inspect", click: "local_filter_select",
  type: "non_sensitive_filter_input", select: "local_filter_select", pressKey: "restricted_key_navigation",
  scroll: "viewport_scroll", wait: "passive_wait", invokeWebMcpReadOnly: "admitted_read_only_webmcp", finish: "finish_declaration",
};

class ScriptedSafeTools implements SafeAgentToolPort {
  readonly actions: SafeAgentAction[] = [];
  readonly surfaceCalls: number[] = [];
  maxActive = 0;
  #active = 0;
  readonly #available: SafeAgentToolName[];
  readonly #observations: UntrustedAgentObservation[];
  readonly #webMcpTools: WebMcpToolDescriptorV1[];
  readonly #delayMs: number;

  constructor(available: SafeAgentToolName[], options: { observations?: UntrustedAgentObservation[]; webMcpTools?: WebMcpToolDescriptorV1[]; delayMs?: number } = {}) {
    this.#available = available;
    this.#observations = [...(options.observations ?? [])];
    this.#webMcpTools = [...(options.webMcpTools ?? [])];
    this.#delayMs = options.delayMs ?? 0;
  }

  async surface(revision: number, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    this.surfaceCalls.push(revision);
    return { observationRevision: revision, tools: [...this.#available], webMcpTools: [...this.#webMcpTools] };
  }

  async execute(action: SafeAgentAction, signal: AbortSignal): Promise<SafeAgentToolResult> {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    this.#active += 1; this.maxActive = Math.max(this.maxActive, this.#active);
    if (this.#delayMs) await new Promise((resolve) => setTimeout(resolve, this.#delayMs));
    try {
      this.actions.push(action);
      const next = action.kind === "finish" ? null : (this.#observations.shift() ?? observation(action.observationRevision));
      const base = {
        schemaVersion: 1 as const,
        toolCallId: action.toolCallId,
        tool: action.kind,
        decision: { decision: "allow" as const, effect: effects[action.kind], observationRevision: action.observationRevision },
        observation: next,
        finishedBelief: action.kind === "finish" ? action.completed : null,
        summary: action.kind === "finish" ? action.summary : `${action.kind} completed`,
      };
      const result = (action.kind === "invokeWebMcpReadOnly" ? { ...base, webMcpResult: webMcpResultFixture } : base) as SafeAgentToolResult;
      SafeAgentToolExchangeSchema.parse({ action, result });
      return result;
    } finally { this.#active -= 1; }
  }
}

test("V2 runner uses assertion-free prompts, dynamic tools, fresh observations, and bounded milestones", async () => {
  const tools = new ScriptedSafeTools(["click", "finish"], { observations: [observation(2, "fresh filtered jobs")] });
  const milestones: unknown[] = [];
  let turn = 0;
  const driver: AgentModelDriver = {
    async runTurn(input) {
      turn += 1;
      assert.deepEqual(input.toolSurface.tools, ["click", "finish"]);
      if (turn === 1) {
        input.executor.admit("provider-secret-id-1", "click", '{"ref":"e:1:1"}');
        const result = await input.executor.execute("provider-secret-id-1", { kind: "click", ref: "e:1:1" }, input.signal);
        return {
          messages: [{ role: "assistant", content: null, toolCalls: [{ id: "provider-secret-id-1", name: "click", arguments: '{"ref":"e:1:1"}' }] }, { role: "tool", toolCallId: "provider-secret-id-1", content: result }],
          assistantSummary: "clicked", usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 }, resolvedProvider: "Novita",
        };
      }
      assert.match(JSON.stringify(input.messages), /fresh filtered jobs/u);
      input.executor.admit("provider-secret-id-2", "finish", '{"completed":true,"summary":"Looks complete; grading remains external."}');
      await input.executor.execute("provider-secret-id-2", { kind: "finish", completed: true, summary: "Looks complete; grading remains external." }, input.signal);
      return { messages: [{ role: "assistant", content: "done" }], assistantSummary: "done", usage: { promptTokens: 8, completionTokens: 1, totalTokens: 9 }, resolvedProvider: "Novita" };
    },
  };
  const runner = new TraceGateAgentRunner(() => driver, { sink: (event) => { milestones.push(event); } });
  const input = { ...agentExecutionInputFixture, capabilities: { ...agentExecutionInputFixture.capabilities, availableTools: ["click", "finish"] as const } };
  const result = await runner.run(input, tools, new AbortController().signal);
  assert.equal(result.completedBelief, true);
  assert.equal(result.iterations, 2);
  assert.equal(result.toolCalls, 2);
  assert.equal(result.browserActions, 1);
  assert.deepEqual(tools.actions.map((action) => action.kind), ["click", "finish"]);
  const serialized = JSON.stringify(milestones);
  assert.doesNotMatch(serialized, /provider-secret-id/u);
  assert.match(serialized, /tool-1/u);
});

test("parallel proposals execute FIFO without concurrent dispatch", async () => {
  const tools = new ScriptedSafeTools(["inspect", "finish"], { delayMs: 10 });
  const executor = new SerializedSafeToolExecutor({ tools, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(agentExecutionInputFixture.capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await executor.refreshSurface(new AbortController().signal);
  executor.admit("a", "inspect", "{}"); executor.admit("b", "inspect", "{}");
  await Promise.all([
    executor.execute("a", { kind: "inspect" }, new AbortController().signal),
    executor.execute("b", { kind: "inspect" }, new AbortController().signal),
  ]);
  assert.deepEqual(tools.actions.map((action) => action.toolCallId), ["tool-1", "tool-2"]);
  assert.equal(tools.maxActive, 1);
});

test("queued proposal is revalidated against the current observation revision", async () => {
  const tools = new ScriptedSafeTools(["wait", "finish"], { observations: [observation(2)] });
  const executor = new SerializedSafeToolExecutor({ tools, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(agentExecutionInputFixture.capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await executor.refreshSurface(new AbortController().signal);
  executor.admit("a", "wait", '{"durationMs":1}'); executor.admit("b", "wait", '{"durationMs":2}');
  await executor.execute("a", { kind: "wait", durationMs: 1 }, new AbortController().signal);
  await assert.rejects(executor.execute("b", { kind: "wait", durationMs: 2 }, new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "stale_element_exhausted");
  assert.equal(tools.actions.length, 1);
});

test("only admitted sanitized WebMCP tools can reach the safe port", async () => {
  const capabilities = { ...agentExecutionInputFixture.capabilities, availableTools: ["invokeWebMcpReadOnly", "finish"] as const };
  const tools = new ScriptedSafeTools(["invokeWebMcpReadOnly", "finish"], { webMcpTools: [webMcpToolDescriptorFixture], observations: [observation(2)] });
  const executor = new SerializedSafeToolExecutor({ tools, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await executor.refreshSurface(new AbortController().signal);
  executor.admit("web", "invokeWebMcpReadOnly", JSON.stringify({ toolId: webMcpToolDescriptorFixture.id, input: { query: "senior engineer", minimumSalary: 150000 } }));
  await executor.execute("web", { kind: "invokeWebMcpReadOnly", toolId: webMcpToolDescriptorFixture.id, input: { query: "senior engineer", minimumSalary: 150000 } }, new AbortController().signal);
  assert.equal(tools.actions[0]?.kind, "invokeWebMcpReadOnly");

  const unavailable = new ScriptedSafeTools(["inspect", "finish"]);
  const rejected = new SerializedSafeToolExecutor({ tools: unavailable, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(agentExecutionInputFixture.capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await rejected.refreshSurface(new AbortController().signal);
  assert.throws(() => rejected.admit("bad", "invokeWebMcpReadOnly", "{}"), (error: unknown) => error instanceof TraceGateError && error.safe.code === "provider_protocol_error");
  assert.equal(unavailable.actions.length, 0);
});

test("cancellation propagates through the runner as a redacted control error", async () => {
  const driver: AgentModelDriver = {
    async runTurn(input: AgentModelTurnInput) {
      await new Promise<void>((_resolve, reject) => input.signal.addEventListener("abort", () => reject(new Error("Bearer sk-or-cancellation-secret-123456")), { once: true }));
      throw new Error("unreachable");
    },
  };
  const controller = new AbortController();
  const pending = new TraceGateAgentRunner(() => driver).run(agentExecutionInputFixture, new ScriptedSafeTools(["inspect", "finish"]), controller.signal);
  setTimeout(() => controller.abort("user cancel"), 10);
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof TraceGateError);
    assert.equal(error.safe.code, "operation_aborted");
    assert.doesNotMatch(JSON.stringify(error.safe), /cancellation-secret/u);
    return true;
  });
});
