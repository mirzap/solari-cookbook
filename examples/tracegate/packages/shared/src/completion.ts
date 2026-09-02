import { z } from "zod";

export const AgentCompletionDispositionSchema = z.enum([
  "completed",
  "policy_refused",
  "blocked",
  "needs_input",
]);

export const NonCompletedAgentDispositionSchema = AgentCompletionDispositionSchema.exclude(["completed"]);

export const RunCompletionDispositionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("gradable"),
    agentDisposition: z.literal("completed"),
  }).strict(),
  z.object({
    kind: z.literal("blocked"),
    agentDisposition: NonCompletedAgentDispositionSchema,
    requiredOutcome: z.literal("inconclusive"),
  }).strict(),
]);

export type AgentCompletionDisposition = z.infer<typeof AgentCompletionDispositionSchema>;
export type NonCompletedAgentDisposition = z.infer<typeof NonCompletedAgentDispositionSchema>;
export type RunCompletionDisposition = z.infer<typeof RunCompletionDispositionSchema>;

export const AGENT_COMPLETION_DISPOSITION_MESSAGES: Readonly<Record<NonCompletedAgentDisposition, string>> = {
  policy_refused: "The agent stopped because the requested action was outside the safe evaluation boundary.",
  blocked: "The agent could not safely complete the requested task.",
  needs_input: "The agent needed additional non-sensitive input before it could complete the task.",
};

export function resolveRunCompletionDisposition(
  agentDisposition: AgentCompletionDisposition,
): RunCompletionDisposition {
  return agentDisposition === "completed"
    ? { kind: "gradable", agentDisposition }
    : { kind: "blocked", agentDisposition, requiredOutcome: "inconclusive" };
}

export function legacyAgentCompletionDisposition(completedBelief: boolean): AgentCompletionDisposition {
  return completedBelief ? "completed" : "blocked";
}
