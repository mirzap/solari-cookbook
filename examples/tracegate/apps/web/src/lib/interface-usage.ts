import {
  InterfaceUsageSummarySchema,
  toolCompletionInterfaceUsageDelta,
  type EventEnvelope,
  type InterfaceChannel,
  type InterfaceUsageMetric,
  type RunId,
  type RunSnapshot,
} from "@tracegate/shared";

export const INTERFACE_CHANNELS: readonly InterfaceChannel[] = [
  "semantic_ui",
  "page_webmcp",
  "configured_mcp",
  "llms_txt",
  "json_ld",
  "visual_fallback",
];

export type ProjectedInterfaceUsageMetric = InterfaceUsageMetric & Readonly<{
  usedRunIds: readonly RunId[];
  durationMs: number | null;
}>;

type DiscoveryEvent = Extract<EventEnvelope, { readonly type: "run.discovery.completed" }>;
type TerminalUsage = {
  invoked: number;
  succeeded: number;
  failed: number;
  durationMs: number;
};

const runChannelKey = (runId: RunId, channel: InterfaceChannel): string => `${runId}\u0000${channel}`;
const toolCompletionKey = (event: Extract<EventEnvelope, { readonly type: "run.tool.completed" }>): string => (
  `${event.runId ?? "evaluation"}\u0000${event.payload.toolCallId}`
);
const binary = (value: number): number => value > 0 ? 1 : 0;

function metadataNumber(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null || !(key in value)) return 0;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
}

function readinessFromDiscovery(
  event: DiscoveryEvent | undefined,
  channel: InterfaceChannel,
): { readonly discovered: number; readonly admitted: number } {
  if (event === undefined || channel === "visual_fallback") return { discovered: 0, admitted: 0 };
  if (channel === "semantic_ui") {
    const available = binary(event.payload.semanticControlCount);
    return { discovered: available, admitted: available };
  }
  if (channel === "page_webmcp") {
    return {
      discovered: event.payload.webMcpGate === "unavailable" ? 0 : 1,
      admitted: event.payload.webMcpGate === "admitted_read_only" ? 1 : 0,
    };
  }
  if (channel === "llms_txt") {
    return { discovered: event.payload.llmsTxt.status === "available" ? 1 : 0, admitted: 0 };
  }
  if (channel === "json_ld") {
    return { discovered: binary(event.payload.jsonLdTypes.length), admitted: 0 };
  }

  const configured = event.payload.interfaces.filter((item) => item.kind === "configured_mcp");
  const reached = configured.some((item) => item.metadata.status !== "unavailable");
  const admitted = configured.some((item) => metadataNumber(item.metadata, "admittedToolCount") > 0);
  return { discovered: reached ? 1 : 0, admitted: admitted ? 1 : 0 };
}

export function projectInterfaceUsageMetrics(
  runs: readonly RunSnapshot[],
  events: readonly EventEnvelope[] | null,
): readonly ProjectedInterfaceUsageMetric[] {
  const tracedRunChannels = new Set<string>();
  const completedToolCalls = new Set<string>();
  const terminalByRunChannel = new Map<string, TerminalUsage>();
  const latestDiscoveryByRun = new Map<RunId, DiscoveryEvent>();

  const orderedEvents = [...(events ?? [])].sort((left, right) => {
    const leftCursor = BigInt(left.cursor);
    const rightCursor = BigInt(right.cursor);
    return leftCursor < rightCursor ? -1 : leftCursor > rightCursor ? 1 : 0;
  });
  for (const event of orderedEvents) {
    if (event.type === "run.discovery.completed" && event.runId !== null) {
      latestDiscoveryByRun.set(event.runId, event);
      continue;
    }
    if (event.type === "run.tool.started" && event.runId !== null) {
      if (event.payload.interfaceSource !== "orchestration") {
        tracedRunChannels.add(runChannelKey(event.runId, event.payload.interfaceSource));
      }
      continue;
    }
    if (event.type !== "run.tool.completed" || event.runId === null) continue;

    const completionKey = toolCompletionKey(event);
    if (completedToolCalls.has(completionKey)) continue;
    completedToolCalls.add(completionKey);
    if (event.payload.interfaceSource !== "orchestration") {
      tracedRunChannels.add(runChannelKey(event.runId, event.payload.interfaceSource));
    }
    const delta = toolCompletionInterfaceUsageDelta(event.payload);
    if (delta === null) continue;

    const key = runChannelKey(event.runId, delta.channel);
    const current = terminalByRunChannel.get(key) ?? { invoked: 0, succeeded: 0, failed: 0, durationMs: 0 };
    current.invoked += 1;
    current[delta.outcome] += 1;
    current.durationMs += event.payload.durationMs;
    terminalByRunChannel.set(key, current);
  }

  const projected = INTERFACE_CHANNELS.map((channel) => {
    let discovered = 0;
    let admitted = 0;
    let invoked = 0;
    let succeeded = 0;
    let failed = 0;
    let durationMs = 0;
    let hasDurationlessFallback = false;
    const usedRunIds = new Set<RunId>();

    for (const run of runs) {
      const explicit = run.interfaceUsage?.metrics.find((candidate) => candidate.channel === channel);
      const readiness = explicit === undefined
        ? readinessFromDiscovery(latestDiscoveryByRun.get(run.id), channel)
        : { discovered: binary(explicit.discovered), admitted: binary(explicit.admitted) };
      discovered += readiness.discovered;
      admitted += readiness.admitted;

      const key = runChannelKey(run.id, channel);
      const terminal = terminalByRunChannel.get(key) ?? { invoked: 0, succeeded: 0, failed: 0, durationMs: 0 };
      if (tracedRunChannels.has(key)) {
        invoked += terminal.invoked;
        succeeded += terminal.succeeded;
        failed += terminal.failed;
        durationMs += terminal.durationMs;
        if (terminal.invoked > 0) usedRunIds.add(run.id);
      } else if (explicit !== undefined) {
        invoked += explicit.invoked;
        succeeded += explicit.succeeded;
        failed += explicit.failed;
        if (explicit.invoked > 0) {
          usedRunIds.add(run.id);
          hasDurationlessFallback = true;
        }
      }
    }

    return {
      channel,
      discovered,
      admitted,
      invoked,
      succeeded,
      failed,
      usedRunIds: [...usedRunIds],
      durationMs: hasDurationlessFallback ? null : durationMs,
    } satisfies ProjectedInterfaceUsageMetric;
  });

  const summary = InterfaceUsageSummarySchema.parse({
    schemaVersion: 1,
    metrics: projected.map(({ usedRunIds: _usedRunIds, durationMs: _durationMs, ...metric }) => metric),
  });
  return summary.metrics.map((metric, index) => ({
    ...metric,
    usedRunIds: projected[index]?.usedRunIds ?? [],
    durationMs: projected[index]?.durationMs ?? null,
  }));
}
