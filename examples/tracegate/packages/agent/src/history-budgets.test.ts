import assert from "node:assert/strict";
import test from "node:test";
import { TraceGateError, buildAgentExecutionInputV2 } from "@tracegate/shared";
import { ASSERTION_ONLY_CANARY, assertionCanaryConfigFixture, observationFixture } from "@tracegate/shared/testing";
import { BudgetLedger } from "./budgets.ts";
import { AgentConversationHistory } from "./history.ts";
import { initialPromptMessages } from "./prompts.ts";

test("bounded history retains the latest observation, redacts secrets, and excludes assertion canaries", () => {
  const input = buildAgentExecutionInputV2(assertionCanaryConfigFixture, observationFixture, ["inspect", "finish"]);
  const base = initialPromptMessages(input);
  assert.doesNotMatch(JSON.stringify(base), new RegExp(ASSERTION_ONLY_CANARY, "u"));
  const history = new AgentConversationHistory(base, observationFixture, 12_288, 16_384);
  for (let index = 1; index <= 15; index += 1) {
    history.appendTurn([{ role: "assistant", content: `${"x".repeat(2_000)} Bearer sk-or-history-secret-123456 turn-${index}` }]);
  }
  history.appendTurn([{ role: "tool", toolCallId: "tool-1", content: JSON.stringify({ schemaVersion: 2, trust: "untrusted_page_or_tool_content", kind: "safe_tool_result", result: { observation: observationFixture } }) }]);
  const compacted = history.compact();
  assert.ok(compacted.historyBytes <= 16_384);
  const serialized = JSON.stringify(compacted.messages);
  assert.match(serialized, /UNTRUSTED_BROWSER_OBSERVATION/u);
  assert.match(serialized, /historical_observation_stub/u);
  assert.match(serialized, /\[REDACTED\]/u);
  assert.doesNotMatch(serialized, /history-secret/u);
  assert.doesNotMatch(serialized, /turn-1"/u);
  assert.match(serialized, /turn-15/u);
  assert.doesNotMatch(serialized, new RegExp(ASSERTION_ONLY_CANARY, "u"));
});

test("model, browser, token, wall, and tool-timeout budgets fail independently", async () => {
  let now = 0;
  const budget = {
    wallClockMs: 15_000, maxModelTurns: 1, maxToolCalls: 1, maxBrowserActions: 1,
    toolTimeoutMs: 1_000, maxObservationBytes: 2_048, maxHistoryBytes: 16_384, maxTotalTokens: 5,
  };
  const model = new BudgetLedger(budget, () => now);
  model.startModelTurn(new AbortController().signal);
  assert.throws(() => model.startModelTurn(new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "budget_exhausted");
  const browser = new BudgetLedger(budget, () => now);
  browser.startBrowserAction(new AbortController().signal);
  assert.throws(() => browser.startBrowserAction(new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "budget_exhausted");
  const tokens = new BudgetLedger(budget, () => now);
  assert.throws(() => tokens.addUsage({ promptTokens: 3, completionTokens: 3, totalTokens: 6 }), (error: unknown) => error instanceof TraceGateError && error.safe.code === "budget_exhausted");
  const wall = new BudgetLedger(budget, () => now);
  now = 15_000;
  assert.throws(() => wall.checkWall(new AbortController().signal, "test"), (error: unknown) => error instanceof TraceGateError && error.safe.code === "budget_exhausted");
  const timeout = new BudgetLedger(budget);
  await assert.rejects(timeout.withToolTimeout(() => new Promise(() => {}), new AbortController().signal), (error: unknown) => error instanceof TraceGateError && error.safe.code === "budget_exhausted");
});
