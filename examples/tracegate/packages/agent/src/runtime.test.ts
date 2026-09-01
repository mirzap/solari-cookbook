import assert from "node:assert/strict";
import test from "node:test";
import {
  SafeAgentToolExchangeSchema,
  TraceGateError,
  UntrustedWebMcpResultV1Schema,
  WebMcpToolDescriptorV1Schema,
  type SafeActionEffect,
  type SafeAgentAction,
  type SafeAgentToolName,
  type SafeAgentToolPort,
  type SafeAgentToolResult,
  type UntrustedAgentObservation,
  type WebMcpToolDescriptorV1,
} from "@tracegate/shared";
import { agentExecutionInputFixture, observationFixture } from "@tracegate/shared/testing";
import { BudgetLedger } from "./budgets.ts";
import { SerializedSafeToolExecutor } from "./executor.ts";
import type { AgentModelDriver, AgentModelTurnInput } from "./model-driver.ts";
import { AgentPolicy } from "./policy.ts";
import { TraceGateAgentRunner } from "./runner.ts";

const observation = (revision: number, text = `revision ${revision}`): UntrustedAgentObservation => ({
  ...observationFixture, revision, visibleText: text,
  elements: [{ ...observationFixture.elements[0]!, ref: `e:${revision}:1` }],
});

const genericWebMcpDescriptor = WebMcpToolDescriptorV1Schema.parse({
  schemaVersion: 1,
  id: "current.records.search",
  name: "search_public_records",
  description: "Read filtered public records from the current document.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 1, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 20 } },
    required: ["query"],
    additionalProperties: false,
  },
  currentOrigin: new URL(observationFixture.url).origin,
  trust: "untrusted_page_capability",
  declaredReadOnly: true,
});

const genericWebMcpResult = UntrustedWebMcpResultV1Schema.parse({
  schemaVersion: 1,
  toolId: genericWebMcpDescriptor.id,
  trust: "untrusted_page_tool_result",
  summary: "Returned bounded public records",
  output: { count: 1 },
  truncated: false,
  redacted: true,
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
      const result = (action.kind === "invokeWebMcpReadOnly" ? { ...base, webMcpResult: genericWebMcpResult } : base) as SafeAgentToolResult;
      SafeAgentToolExchangeSchema.parse({ action, result });
      return result;
    } finally { this.#active -= 1; }
  }
}

test("V2 runner uses assertion-free prompts, dynamic tools, fresh observations, and bounded milestones", async () => {
  const tools = new ScriptedSafeTools(["click", "finish"], { observations: [observation(2, "fresh filtered public records")] });
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
      assert.match(JSON.stringify(input.messages), /fresh filtered public records/u);
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
  const tools = new ScriptedSafeTools(["invokeWebMcpReadOnly", "finish"], { webMcpTools: [genericWebMcpDescriptor], observations: [observation(2)] });
  const executor = new SerializedSafeToolExecutor({ tools, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await executor.refreshSurface(new AbortController().signal);
  executor.admit("web", "invokeWebMcpReadOnly", JSON.stringify({ toolId: genericWebMcpDescriptor.id, input: { query: "public notice", limit: 5 } }));
  await executor.execute("web", { kind: "invokeWebMcpReadOnly", toolId: genericWebMcpDescriptor.id, input: { query: "public notice", limit: 5 } }, new AbortController().signal);
  assert.equal(tools.actions[0]?.kind, "invokeWebMcpReadOnly");

  const unavailable = new ScriptedSafeTools(["inspect", "finish"]);
  const rejected = new SerializedSafeToolExecutor({ tools: unavailable, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(agentExecutionInputFixture.capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await rejected.refreshSurface(new AbortController().signal);
  assert.throws(() => rejected.admit("bad", "invokeWebMcpReadOnly", "{}"), (error: unknown) => error instanceof TraceGateError && error.safe.code === "provider_protocol_error");
  assert.equal(unavailable.actions.length, 0);
});

test("unsafe and schema-invalid proposals are blocked before browser dispatch", async () => {
  const navigationCapabilities = { ...agentExecutionInputFixture.capabilities, availableTools: ["navigate", "finish"] as const };
  const navigationTools = new ScriptedSafeTools(["navigate", "finish"]);
  const navigationLedger = new BudgetLedger(agentExecutionInputFixture.budgets);
  const navigation = new SerializedSafeToolExecutor({ tools: navigationTools, ledger: navigationLedger, policy: new AgentPolicy(navigationCapabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await navigation.refreshSurface(new AbortController().signal);
  navigation.admit("outside", "navigate", '{"url":"https://outside.example/path"}');
  await assert.rejects(navigation.execute("outside", { kind: "navigate" }, new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "unsafe_action_blocked");
  assert.equal(navigationTools.actions.length, 0);
  assert.equal(navigationLedger.browserActions, 0);
  assert.equal(navigationLedger.toolCalls, 1);

  const webCapabilities = { ...agentExecutionInputFixture.capabilities, availableTools: ["invokeWebMcpReadOnly", "finish"] as const };
  const webTools = new ScriptedSafeTools(["invokeWebMcpReadOnly", "finish"], { webMcpTools: [genericWebMcpDescriptor] });
  const webLedger = new BudgetLedger(agentExecutionInputFixture.budgets);
  const web = new SerializedSafeToolExecutor({ tools: webTools, ledger: webLedger, policy: new AgentPolicy(webCapabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await web.refreshSurface(new AbortController().signal);
  web.admit("invalid-input", "invokeWebMcpReadOnly", JSON.stringify({ toolId: genericWebMcpDescriptor.id, input: { query: "public notice", limit: 21 } }));
  await assert.rejects(web.execute("invalid-input", { kind: "invokeWebMcpReadOnly" }, new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "unsafe_action_blocked");
  web.admit("prototype-input", "invokeWebMcpReadOnly", `{"toolId":"${genericWebMcpDescriptor.id}","input":{"query":"public notice","constructor":1}}`);
  await assert.rejects(web.execute("prototype-input", { kind: "invokeWebMcpReadOnly" }, new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "unsafe_action_blocked");
  assert.equal(webTools.actions.length, 0);
  assert.equal(webLedger.browserActions, 0);
});

test("cross-origin WebMCP descriptors are rejected before model exposure", async () => {
  const capabilities = { ...agentExecutionInputFixture.capabilities, availableTools: ["invokeWebMcpReadOnly", "finish"] as const };
  const crossOrigin = WebMcpToolDescriptorV1Schema.parse({ ...genericWebMcpDescriptor, currentOrigin: "https://outside.example" });
  const tools = new ScriptedSafeTools(["invokeWebMcpReadOnly", "finish"], { webMcpTools: [crossOrigin] });
  const executor = new SerializedSafeToolExecutor({ tools, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await assert.rejects(executor.refreshSurface(new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "unsafe_action_blocked");
  assert.equal(tools.actions.length, 0);
});

test("state-changing tools require a newer post-action observation", async () => {
  const capabilities = { ...agentExecutionInputFixture.capabilities, availableTools: ["click", "finish"] as const };
  const tools = new ScriptedSafeTools(["click", "finish"], { observations: [observation(1, "stale post-action state")] });
  const ledger = new BudgetLedger(agentExecutionInputFixture.budgets);
  const executor = new SerializedSafeToolExecutor({ tools, ledger, policy: new AgentPolicy(capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await executor.refreshSurface(new AbortController().signal);
  executor.admit("mutate", "click", '{"ref":"e:1:1"}');
  await assert.rejects(executor.execute("mutate", { kind: "click" }, new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "target_evidence_lost");
  assert.equal(tools.actions.length, 1);
  assert.equal(ledger.browserActions, 1);
  assert.equal(executor.observation.revision, 1);
});

test("malformed mutation results terminate with lost evidence", async () => {
  const capabilities = { ...agentExecutionInputFixture.capabilities, availableTools: ["click", "finish"] as const };
  let dispatches = 0;
  const port: SafeAgentToolPort = {
    async surface(revision) { return { observationRevision: revision, tools: ["click", "finish"], webMcpTools: [] }; },
    async execute(action) {
      dispatches += 1;
      return { schemaVersion: 1, toolCallId: action.toolCallId, tool: "click", unsafe: "Bearer sk-or-unknown-state-secret-123456" } as never;
    },
  };
  const executor = new SerializedSafeToolExecutor({ tools: port, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await executor.refreshSurface(new AbortController().signal);
  executor.admit("malformed-mutation", "click", '{"ref":"e:1:1"}');
  await assert.rejects(executor.execute("malformed-mutation", { kind: "click" }, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof TraceGateError);
    assert.equal(error.safe.code, "target_evidence_lost");
    assert.doesNotMatch(JSON.stringify(error.safe), /unknown-state-secret|Bearer/u);
    return true;
  });
  assert.equal(dispatches, 1);
  assert.throws(() => executor.admit("retry", "click", '{"ref":"e:1:1"}'), (error: unknown) => error instanceof TraceGateError && error.safe.code === "target_evidence_lost");
});

test("malformed WebMCP results are redacted and semantic tools remain the fallback", async () => {
  const capabilities = { ...agentExecutionInputFixture.capabilities, availableTools: ["invokeWebMcpReadOnly", "finish"] as const };
  const malformedPort: SafeAgentToolPort = {
    async surface(revision) { return { observationRevision: revision, tools: ["invokeWebMcpReadOnly", "finish"], webMcpTools: [genericWebMcpDescriptor] }; },
    async execute(action) {
      return {
        schemaVersion: 1, toolCallId: action.toolCallId, tool: "invokeWebMcpReadOnly",
        decision: { decision: "allow", effect: "admitted_read_only_webmcp", observationRevision: action.observationRevision },
        observation: observation(2), finishedBelief: null, summary: "Bearer sk-or-malformed-result-secret-123456",
        webMcpResult: { ...genericWebMcpResult, redacted: false },
      } as never;
    },
  };
  const malformed = new SerializedSafeToolExecutor({ tools: malformedPort, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await malformed.refreshSurface(new AbortController().signal);
  malformed.admit("malformed", "invokeWebMcpReadOnly", JSON.stringify({ toolId: genericWebMcpDescriptor.id, input: { query: "public notice" } }));
  const result = await malformed.execute("malformed", { kind: "invokeWebMcpReadOnly" }, new AbortController().signal);
  assert.match(result, /safe_tool_error/u);
  assert.doesNotMatch(result, /malformed-result-secret|Bearer|webMcpResult/u);

  const fallbackTools = new ScriptedSafeTools(["inspect", "finish"], { observations: [observation(2)] });
  const fallback = new SerializedSafeToolExecutor({ tools: fallbackTools, ledger: new BudgetLedger(agentExecutionInputFixture.budgets), policy: new AgentPolicy(agentExecutionInputFixture.capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  const surface = await fallback.refreshSurface(new AbortController().signal);
  assert.deepEqual(surface.webMcpTools, []);
  fallback.admit("inspect-fallback", "inspect", "{}");
  await fallback.execute("inspect-fallback", { kind: "inspect" }, new AbortController().signal);
  assert.deepEqual(fallbackTools.actions.map((action) => action.kind), ["inspect"]);
});

test("tool timeout covers current-observation surface revalidation", async () => {
  let surfaceCalls = 0;
  const port: SafeAgentToolPort = {
    async surface(revision) {
      surfaceCalls += 1;
      if (surfaceCalls > 1) return new Promise<never>(() => {});
      return { observationRevision: revision, tools: ["inspect", "finish"], webMcpTools: [] };
    },
    async execute() { throw new Error("browser dispatch must not occur"); },
  };
  const budget = { ...agentExecutionInputFixture.budgets, toolTimeoutMs: 20 };
  const executor = new SerializedSafeToolExecutor({ tools: port, ledger: new BudgetLedger(budget), policy: new AgentPolicy(agentExecutionInputFixture.capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await executor.refreshSurface(new AbortController().signal);
  executor.admit("timed", "inspect", "{}");
  await assert.rejects(executor.execute("timed", { kind: "inspect" }, new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "budget_exhausted");
});

test("timed-out non-cooperative execution terminally blocks queued dispatch", async () => {
  let dispatches = 0;
  const port: SafeAgentToolPort = {
    async surface(revision) { return { observationRevision: revision, tools: ["inspect", "finish"], webMcpTools: [] }; },
    async execute(action) {
      dispatches += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return {
        schemaVersion: 1, toolCallId: action.toolCallId, tool: "inspect",
        decision: { decision: "allow", effect: "inspect", observationRevision: action.observationRevision },
        observation: observation(2, "late untrusted result"), finishedBelief: null, summary: "late",
      };
    },
  };
  const budget = { ...agentExecutionInputFixture.budgets, toolTimeoutMs: 20 };
  const executor = new SerializedSafeToolExecutor({ tools: port, ledger: new BudgetLedger(budget), policy: new AgentPolicy(agentExecutionInputFixture.capabilities), observation: observationFixture, signal: new AbortController().signal, sink: () => {} });
  await executor.refreshSurface(new AbortController().signal);
  executor.admit("first", "inspect", "{}");
  executor.admit("queued", "inspect", "{}");
  const first = executor.execute("first", { kind: "inspect" }, new AbortController().signal);
  const queued = executor.execute("queued", { kind: "inspect" }, new AbortController().signal);
  await assert.rejects(first, (error: unknown) => error instanceof TraceGateError && error.safe.code === "budget_exhausted");
  await assert.rejects(queued, (error: unknown) => error instanceof TraceGateError && error.safe.code === "target_evidence_lost");
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(dispatches, 1);
  assert.equal(executor.observation.revision, 1);
});

test("cancellation stops a non-cooperative safe-tool surface", async () => {
  const driver: AgentModelDriver = { async runTurn() { throw new Error("model must not run"); } };
  const port: SafeAgentToolPort = {
    async surface() { return new Promise<never>(() => {}); },
    async execute() { throw new Error("browser must not run"); },
  };
  const controller = new AbortController();
  const pending = new TraceGateAgentRunner(() => driver).run(agentExecutionInputFixture, port, controller.signal);
  setTimeout(() => controller.abort("user cancel"), 10);
  await assert.rejects(pending, (error: unknown) => error instanceof TraceGateError && error.safe.code === "operation_aborted");
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
