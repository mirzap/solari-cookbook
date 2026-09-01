import { AgentTraceEventSchema, redactJson, type RunEvent } from "@tracegate/shared";

export type AgentMilestone = Extract<RunEvent,
  { type: "run.agent.iteration" | "run.agent.message" | "run.tool.started" | "run.tool.completed" | "run.usage.updated" }>;
export type AgentMilestoneSink = (event: AgentMilestone) => Promise<void> | void;

export const noMilestones: AgentMilestoneSink = () => {};

export async function emitMilestone(sink: AgentMilestoneSink, event: AgentMilestone): Promise<void> {
  const bounded = event.type === "run.agent.message" || event.type === "run.agent.iteration"
    ? { ...event, payload: { ...event.payload, summary: String(redactJson(event.payload.summary, { maxStringLength: event.type === "run.agent.message" ? 4_000 : 2_000 })) } }
    : event;
  await sink(AgentTraceEventSchema.parse(bounded) as AgentMilestone);
}
