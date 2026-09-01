import { AgentTraceEventSchema, redactJson, type RunEvent } from "@tracegate/shared";

export type AgentMilestone = Extract<RunEvent,
  { type: "run.agent.iteration" | "run.agent.message" | "run.tool.started" | "run.tool.completed" | "run.usage.updated" }>;
export type AgentMilestoneSink = (event: AgentMilestone) => Promise<void> | void;

export const noMilestones: AgentMilestoneSink = () => {};

const boundedText = (value: string, maxStringLength: number): string => String(redactJson(value, { maxStringLength }));

export async function emitMilestone(sink: AgentMilestoneSink, event: AgentMilestone): Promise<void> {
  const bounded = event.type === "run.agent.message" || event.type === "run.agent.iteration"
    ? { ...event, payload: { ...event.payload, summary: boundedText(event.payload.summary, event.type === "run.agent.message" ? 4_000 : 2_000) } }
    : event.type === "run.tool.started"
      ? { ...event, payload: { ...event.payload, argumentSummary: boundedText(event.payload.argumentSummary, 2_000) } }
      : event.type === "run.tool.completed"
        ? { ...event, payload: { ...event.payload, resultSummary: boundedText(event.payload.resultSummary, 2_000) } }
        : event;
  await sink(AgentTraceEventSchema.parse(bounded) as AgentMilestone);
}
