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

function channelForDiscoveredKind(
  kind: "semantic" | "llms_txt" | "json_ld" | "webmcp" | "configured_mcp" | "visual_fallback",
): InterfaceChannel {
  if (kind === "semantic") return "semantic_ui";
  if (kind === "webmcp") return "page_webmcp";
  return kind;
}

const runChannelKey = (runId: RunId | null, channel: InterfaceChannel): string => `${runId ?? "evaluation"}\u0000${channel}`;
const toolCompletionKey = (event: Extract<EventEnvelope, { readonly type: "run.tool.completed" }>): string => (
  `${event.runId ?? "evaluation"}\u0000${event.payload.toolCallId}`
);

export function projectInterfaceUsageMetrics(
  runs: readonly RunSnapshot[],
  events: readonly EventEnvelope[] | null,
): readonly ProjectedInterfaceUsageMetric[] {
  const tracedRunChannels = new Set<string>();
  const completedToolCalls = new Set<string>();
  const terminalByChannel = new Map<InterfaceChannel, {
    invoked: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    usedRunIds: Set<RunId>;
  }>();

  for (const event of events ?? []) {
    if (event.type !== "run.tool.started" && event.type !== "run.tool.completed") continue;
    if (event.payload.interfaceSource !== "orchestration") {
      tracedRunChannels.add(runChannelKey(event.runId, event.payload.interfaceSource));
    }
    if (event.type !== "run.tool.completed") continue;

    const completionKey = toolCompletionKey(event);
    if (completedToolCalls.has(completionKey)) continue;
    completedToolCalls.add(completionKey);
    const delta = toolCompletionInterfaceUsageDelta(event.payload);
    if (delta === null) continue;

    const current = terminalByChannel.get(delta.channel) ?? {
      invoked: 0,
      succeeded: 0,
      failed: 0,
      durationMs: 0,
      usedRunIds: new Set<RunId>(),
    };
    current.invoked += 1;
    current[delta.outcome] += 1;
    current.durationMs += event.payload.durationMs;
    if (event.runId !== null) current.usedRunIds.add(event.runId);
    terminalByChannel.set(delta.channel, current);
  }

  const projected = INTERFACE_CHANNELS.map((channel) => {
    const runMetrics = runs.flatMap((run) => {
      const metric = run.interfaceUsage?.metrics.find((candidate) => candidate.channel === channel);
      return metric === undefined ? [] : [{ run, metric }];
    });
    const fallbackMetrics = runMetrics.filter(({ run }) => !tracedRunChannels.has(runChannelKey(run.id, channel)));
    const terminal = terminalByChannel.get(channel) ?? {
      invoked: 0,
      succeeded: 0,
      failed: 0,
      durationMs: 0,
      usedRunIds: new Set<RunId>(),
    };
    const invoked = terminal.invoked + fallbackMetrics.reduce((sum, { metric }) => sum + metric.invoked, 0);
    const succeeded = terminal.succeeded + fallbackMetrics.reduce((sum, { metric }) => sum + metric.succeeded, 0);
    const failed = terminal.failed + fallbackMetrics.reduce((sum, { metric }) => sum + metric.failed, 0);
    const discoveryEvents = events?.filter((event) => event.type === "run.discovery.completed") ?? [];
    const discoveredFromEvents = discoveryEvents.reduce(
      (sum, event) => sum + event.payload.interfaces.filter((entry) => channelForDiscoveredKind(entry.kind) === channel).length,
      0,
    );
    const admittedFromDiscovery = channel === "page_webmcp"
      ? discoveryEvents.filter((event) => event.payload.webMcpGate === "admitted_read_only").length
      : 0;
    const discovered = Math.max(
      runMetrics.reduce((sum, { metric }) => sum + metric.discovered, 0),
      discoveredFromEvents,
      invoked > 0 ? 1 : 0,
    );
    const admitted = Math.max(
      runMetrics.reduce((sum, { metric }) => sum + metric.admitted, 0),
      admittedFromDiscovery,
      invoked > 0 ? 1 : 0,
    );
    const usedRunIds = new Set(terminal.usedRunIds);
    for (const { run, metric } of fallbackMetrics) if (metric.invoked > 0) usedRunIds.add(run.id);
    const hasDurationlessFallback = fallbackMetrics.some(({ metric }) => metric.invoked > 0);

    return {
      channel,
      discovered,
      admitted,
      invoked,
      succeeded,
      failed,
      usedRunIds: [...usedRunIds],
      durationMs: hasDurationlessFallback ? null : terminal.durationMs,
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
