import type { SafeAgentToolSurface, TokenUsage } from "@tracegate/shared";

export interface AgentToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface AgentModelMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly toolCalls?: readonly AgentToolCall[];
  readonly toolCallId?: string;
}

export interface ToolAdmission {
  readonly normalizedId: string;
  readonly ordinal: number;
}

export interface AgentToolExecutor {
  admit(providerCallId: string, toolName: string, rawArguments: string): ToolAdmission;
  execute(providerCallId: string, proposal: unknown, signal: AbortSignal): Promise<string>;
  failAdmitted(providerCallId: string, error: unknown): Promise<void>;
}

export interface AgentModelTurnInput {
  readonly messages: readonly AgentModelMessage[];
  readonly toolSurface: SafeAgentToolSurface;
  readonly executor: AgentToolExecutor;
  readonly signal: AbortSignal;
}

export interface AgentModelTurnResult {
  readonly messages: readonly AgentModelMessage[];
  readonly assistantSummary: string;
  readonly usage: TokenUsage;
  readonly resolvedProvider: string;
}

export interface AgentModelDriver {
  runTurn(input: AgentModelTurnInput): Promise<AgentModelTurnResult>;
  dispose?(): Promise<void> | void;
}

export interface AgentModelDriverFactoryInput {
  readonly modelId: string;
  readonly sampling: {
    readonly temperature: number;
    readonly topP: number;
    readonly providerRouting: {
      readonly allowProviders: readonly string[];
      readonly order: "price" | "latency" | "throughput" | null;
    } | null;
  };
}

export type AgentModelDriverFactory = (input: AgentModelDriverFactoryInput) => AgentModelDriver;
