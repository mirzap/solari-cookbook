import { UntrustedAgentObservationSchema, redactJson, type UntrustedAgentObservation } from "@tracegate/shared";
import type { AgentModelMessage } from "./model-driver.ts";
import { terminalError } from "./errors.ts";

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

function documentLocation(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

function compactHistoricalContent(message: AgentModelMessage): string | null {
  if (message.content === null) return null;
  if (message.role === "tool") {
    try {
      const parsed = JSON.parse(message.content) as Record<string, unknown>;
      if (parsed.kind === "safe_tool_result" && parsed.result && typeof parsed.result === "object") {
        const result = parsed.result as Record<string, unknown>;
        const observation = result.observation;
        if (observation && typeof observation === "object") {
          const source = observation as Record<string, unknown>;
          return JSON.stringify(redactJson({
            ...parsed,
            result: {
              ...result,
              observation: {
                schemaVersion: 2,
                trust: "untrusted_page_or_tool_content",
                kind: "historical_observation_stub",
                revision: source.revision,
                url: source.url,
                title: source.title,
                truncated: true,
              },
            },
          }, { maxStringLength: 4_000 }));
        }
      }
    } catch { /* malformed tool text remains bounded untrusted text */ }
  }
  return String(redactJson(message.content, { maxStringLength: 4_000 }));
}

function boundedObservation(input: UntrustedAgentObservation, maxBytes: number): UntrustedAgentObservation {
  let current = UntrustedAgentObservationSchema.parse(input);
  if (bytes(current) <= maxBytes) return current;
  current = { ...current, visibleText: current.visibleText.slice(0, Math.max(0, Math.floor(maxBytes / 3))), truncated: true };
  while (bytes(current) > maxBytes && current.elements.length > 0) current = { ...current, elements: current.elements.slice(0, -1), truncated: true };
  while (bytes(current) > maxBytes && current.visibleText.length > 0) current = { ...current, visibleText: current.visibleText.slice(0, Math.floor(current.visibleText.length / 2)), truncated: true };
  if (bytes(current) > maxBytes) throw terminalError("budget_exhausted", "Mandatory observation exceeds observation byte budget", "agent.history");
  return UntrustedAgentObservationSchema.parse(current);
}

export class AgentConversationHistory {
  readonly #base: AgentModelMessage[];
  readonly #turns: AgentModelMessage[][] = [];
  readonly #maxObservationBytes: number;
  readonly #maxHistoryBytes: number;
  #latestObservation: UntrustedAgentObservation;
  #documentTransitions = 0;

  constructor(base: readonly AgentModelMessage[], observation: UntrustedAgentObservation, maxObservationBytes: number, maxHistoryBytes: number) {
    this.#base = [...base.slice(0, -1)];
    this.#latestObservation = boundedObservation(observation, maxObservationBytes);
    this.#maxObservationBytes = maxObservationBytes;
    this.#maxHistoryBytes = maxHistoryBytes;
  }

  appendTurn(
    messages: readonly AgentModelMessage[],
    observation?: UntrustedAgentObservation,
    options: { readonly documentTransition?: boolean } = {},
  ): void {
    const nextObservation = observation
      ? boundedObservation(observation, this.#maxObservationBytes)
      : this.#latestObservation;
    const transitioned = options.documentTransition === true
      || documentLocation(nextObservation.url) !== documentLocation(this.#latestObservation.url);
    if (transitioned) {
      this.#turns.length = 0;
      this.#documentTransitions += 1;
    }
    this.#turns.push(messages.map((message) => ({
      ...message,
      content: compactHistoricalContent(message),
      ...(message.toolCalls ? { toolCalls: message.toolCalls.map((call) => ({ ...call, arguments: String(redactJson(call.arguments, { maxStringLength: 8_192 })) })) } : {}),
    })));
    this.#latestObservation = nextObservation;
  }

  compact(trustedTrailingMessages: readonly AgentModelMessage[] = []): { messages: AgentModelMessage[]; historyBytes: number; documentTransitions: number } {
    const observation: AgentModelMessage = {
      role: "user",
      content: `UNTRUSTED_BROWSER_OBSERVATION\n${JSON.stringify({ schemaVersion: 2, trust: "untrusted_page_or_tool_content", observation: this.#latestObservation })}`,
    };
    const retained = [...this.#turns];
    const trailing = trustedTrailingMessages.map((message) => ({ ...message }));
    const build = () => [...this.#base, ...retained.flat(), ...trailing, observation];
    while (retained.length > 0 && bytes(build()) > this.#maxHistoryBytes) retained.shift();
    const messages = build();
    const historyBytes = bytes(messages);
    if (historyBytes > this.#maxHistoryBytes) throw terminalError("budget_exhausted", "Mandatory prompt context exceeds history byte budget", "agent.history");
    return { messages, historyBytes, documentTransitions: this.#documentTransitions };
  }
}

export { boundedObservation, bytes as historyBytes };
