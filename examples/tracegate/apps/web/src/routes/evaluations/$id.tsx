import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type {
  AgentTraceProjection,
  EvaluationReportProjection,
  EventEnvelope,
  InterfaceChannel,
  RunSnapshot,
} from "@tracegate/shared";
import { InlineNotice, Metric, Panel, StatusBadge } from "@tracegate/ui";
import { TracegateApiClient } from "../../lib/api-client.ts";
import { projectInterfaceUsageMetrics } from "../../lib/interface-usage.ts";
import { useLiveEvaluation } from "../../lib/use-live-evaluation.ts";

export const Route = createFileRoute("/evaluations/$id")({ component: LiveEvaluationPage });
const client = new TracegateApiClient();
const PIPELINE_STEPS = ["Prepare", "Explore", "Work", "Verify", "Finish"] as const;
const INTERFACE_LABELS: Record<InterfaceChannel, string> = {
  page_webmcp: "WebMCP",
  configured_mcp: "Configured MCP",
  semantic_ui: "Semantic UI",
  llms_txt: "llms.txt",
  json_ld: "JSON-LD",
  visual_fallback: "Visual fallback",
};
const INTERFACE_DESCRIPTIONS: Record<InterfaceChannel, string> = {
  page_webmcp: "Read-only tools offered by the website",
  configured_mcp: "Read-only tools from your optional endpoint",
  semantic_ui: "Accessible names, roles, and page structure",
  llms_txt: "Detected for readiness reporting; not provided to the agent in this version",
  json_ld: "Detected for readiness reporting; not provided to the agent in this version",
  visual_fallback: "Not available in this version",
};
const INTERFACE_ORDER: readonly InterfaceChannel[] = ["page_webmcp", "configured_mcp", "semantic_ui", "llms_txt", "json_ld"];

async function loadAllEvents(evaluationId: Parameters<TracegateApiClient["events"]>[0], signal: AbortSignal): Promise<readonly EventEnvelope[] | null> {
  const events: EventEnvelope[] = [];
  let cursor: Parameters<TracegateApiClient["events"]>[1] = null;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await client.events(evaluationId, cursor, signal);
    events.push(...page.events);
    if (!page.truncated || page.nextCursor === null) return events;
    cursor = page.nextCursor;
  }
  return null;
}

function progressIndex(run: RunSnapshot): number {
  if (run.status === "acquiring_browser" || run.status === "connecting_browser") return 0;
  if (run.status === "discovering") return 1;
  if (run.status === "running_agent") return 2;
  if (run.status === "grading") return 3;
  if (run.status === "releasing_browser") return 4;
  return -1;
}

function runStatus(run: RunSnapshot): string {
  if (run.outcome !== null) return run.outcome;
  if (run.status === "queued") return "waiting";
  if (run.status === "acquiring_browser" || run.status === "connecting_browser") return "preparing";
  if (run.status === "discovering") return "exploring";
  if (run.status === "running_agent") return "working";
  if (run.status === "grading") return "verifying";
  if (run.status === "releasing_browser") return "finishing";
  return run.status;
}

function runFailureMessage(run: RunSnapshot): string | null {
  if (run.failure === null) return null;
  if (run.failure.code === "agent_policy_refused") return "The agent stopped because it could not safely complete the task.";
  if (run.failure.code === "agent_blocked") return "The agent could not complete the task with the safe actions available in this run.";
  if (run.failure.code === "agent_needs_input") return "The agent needed information that was not available in this run.";
  return run.failure.message;
}

function RunCard({ run }: { readonly run: RunSnapshot }) {
  const activeStep = progressIndex(run);
  const terminal = run.status === "completed" || run.status === "cancelled";
  return (
    <article className="tg-run-card">
      <header className="tg-run-card__header">
        <div><p className="tg-eyebrow">Run {run.runIndex + 1}</p><h3>{run.modelId.split("/").at(-1)?.replaceAll("-", " ")}</h3></div>
        <StatusBadge status={runStatus(run)} />
      </header>
      <ol className="tg-pipeline" aria-label={`Run ${run.runIndex + 1} progress`}>
        {PIPELINE_STEPS.map((step, index) => <li key={step} data-state={terminal || index < activeStep ? "done" : index === activeStep ? "active" : "waiting"}>{step}</li>)}
      </ol>
      <dl className="tg-run-metrics">
        <Metric label="Tool calls" value={run.toolCalls} />
        <Metric label="Time" value={run.durationMs === null ? "—" : `${(run.durationMs / 1_000).toFixed(1)}s`} />
      </dl>
      {runFailureMessage(run) === null ? null : <InlineNotice tone={run.outcome === "inconclusive" ? "warning" : "error"}>{runFailureMessage(run)}</InlineNotice>}
      {run.warnings.map((warning, index) => <InlineNotice key={`${warning.code}-${index}`} tone="warning">{warning.message}</InlineNotice>)}
      {run.potentialSessionLeak ? <InlineNotice tone="warning">Browser cleanup could not be confirmed, so this run is not presented as conclusive.</InlineNotice> : null}
      <details className="tg-inline-details"><summary>Run details</summary><p>Model iterations: {run.iterations} · Browser actions: {run.browserActions} · Cleanup: {run.releaseStatus.replaceAll("_", " ")}</p></details>
    </article>
  );
}

function AgentInterfaceInsights({ runs, history }: { readonly runs: readonly RunSnapshot[]; readonly history: readonly EventEnvelope[] | null }) {
  const totals = useMemo(() => {
    const projected = projectInterfaceUsageMetrics(runs, history);
    return INTERFACE_ORDER.map((channel) => {
      const metric = projected.find((candidate) => candidate.channel === channel);
      if (metric === undefined) throw new Error(`Missing interface usage projection for ${channel}`);
      const usedRunIds = new Set(metric.usedRunIds);
      const usedRuns = runs.filter((run) => usedRunIds.has(run.id));
      return {
        ...metric,
        usedRuns: usedRuns.length,
        passedWithUse: usedRuns.filter((run) => run.outcome === "passed").length,
      };
    });
  }, [history, runs]);

  return (
    <Panel eyebrow="Agent Interfaces" title="How ready is this website for agents?">
      <p className="tg-section-copy">Availability shows what TraceGate found in each run. Usage is counted only from completed tool activity and does not imply that an interface caused an outcome.</p>
      <div className="tg-interface-grid">
        {totals.map((metric) => {
          const state = metric.invoked > 0 ? "used" : metric.discovered > 0 || metric.admitted > 0 ? "available" : "not observed";
          return <article className="tg-interface-card" key={metric.channel}>
            <header><div><h3>{INTERFACE_LABELS[metric.channel]}</h3><p>{INTERFACE_DESCRIPTIONS[metric.channel]}</p></div><StatusBadge status={state} /></header>
            <dl>
              <Metric label="Actual uses" value={metric.invoked} detail={metric.invoked === 0 ? "Not used in these runs" : `${metric.succeeded} completed · ${metric.failed} failed`} />
              <Metric label="Time in use" value={metric.invoked === 0 || metric.durationMs === null ? "—" : `${(metric.durationMs / 1_000).toFixed(1)}s`} />
              <Metric label="Reliability when used" value={metric.usedRuns === 0 ? "—" : `${metric.passedWithUse}/${metric.usedRuns}`} detail="Passed runs / runs that used it" />
            </dl>
          </article>;
        })}
      </div>
    </Panel>
  );
}

function successCriterionDescription(assertion: EvaluationReportProjection["assertions"][number]): string {
  if (assertion.kind === "url" && assertion.operator === "origin_path_and_query_parameter_equals") {
    return `Final page ${assertion.expectedUrl} with exactly one ${assertion.queryParameter.name}=${assertion.queryParameter.value}`;
  }
  if (assertion.kind === "url") return `Final page ${assertion.expectedUrl}`;
  if (assertion.kind === "text") return `Visible text includes “${assertion.expected}”`;
  if (assertion.kind === "semantic") return `${assertion.locator.role} named “${assertion.locator.accessibleName.value}” is present`;
  return `${assertion.locator.role} named “${assertion.locator.accessibleName.value}” reaches the expected state`;
}

function GradingReport({ report }: { readonly report: EvaluationReportProjection }) {
  return (
    <Panel eyebrow="Reliability results" title="Did agents reach the outcome?">
      <p>{report.observableStateLimitation}</p>
      <div className="tg-report-runs">
        {report.runs.map((run) => (
          <section key={run.id} className="tg-report-run">
            <header><strong>Run {run.runIndex + 1}</strong><StatusBadge status={run.outcome ?? run.status} /></header>
            {run.grade === null ? <p className="tg-muted">Waiting for fresh, independent verification.</p> : (
              <table className="tg-result-table">
                <thead><tr><th>Success criterion</th><th>Result</th><th>What TraceGate observed</th></tr></thead>
                <tbody>{run.grade.assertions.map((result, index) => <tr key={result.assertionId}>
                  <td><strong>Criterion {index + 1}</strong><span className="tg-criterion-copy">{report.assertions[index] === undefined ? "Configured outcome" : successCriterionDescription(report.assertions[index])}</span></td>
                  <td><StatusBadge status={result.status} /></td><td>{result.actualSummary}</td>
                </tr>)}</tbody>
              </table>
            )}
          </section>
        ))}
      </div>
    </Panel>
  );
}

function toolCompletionDisplay(event: Extract<AgentTraceProjection["items"][number]["event"], { readonly type: "run.tool.completed" }>): string {
  if (event.payload.success) return "Tool completed.";
  if (!("failure" in event.payload) || event.payload.failure === undefined) {
    return "Tool did not complete; no safe classification is available for this older event.";
  }

  const summary = event.payload.failure.code === "unsafe_action_blocked"
    ? "A safety policy blocked this tool action."
    : event.payload.failure.code === "provider_protocol_error"
      ? "The model proposed an action TraceGate could not safely use."
      : event.payload.failure.code === "stale_element_exhausted"
        ? "The page changed before the tool action could run."
        : "The tool action did not complete.";
  if (event.payload.dispatchDisposition === "rejected_before_dispatch") {
    return `${summary} It was not dispatched.`;
  }
  if (event.payload.failure.phase === "post_dispatch_validation") {
    return `${summary} The returned result could not be safely verified.`;
  }
  return summary;
}

function traceEventDisplay(event: AgentTraceProjection["items"][number]["event"]): string {
  if (event.type === "run.tool.completed") return toolCompletionDisplay(event);
  return "summary" in event.payload ? event.payload.summary : "Execution milestone";
}

function AgentTrace({ trace }: { readonly trace: AgentTraceProjection }) {
  return trace.items.length === 0 ? <p className="tg-muted">No execution milestones have been committed yet.</p> : <ol className="tg-trace">
    {trace.items.map((item) => <li key={`${item.runId}-${item.runSequence}`}>
      <time>{new Date(item.occurredAt).toLocaleTimeString()}</time>
      <strong>{item.event.type.replaceAll(".", " ")}</strong>
      <span>{traceEventDisplay(item.event)}</span>
    </li>)}
  </ol>;
}

function LiveEvaluationPage() {
  const { id } = Route.useParams();
  const live = useLiveEvaluation(id);
  const snapshot = live.snapshot;
  const [report, setReport] = useState<EvaluationReportProjection | null>(null);
  const [trace, setTrace] = useState<AgentTraceProjection | null>(null);
  const [history, setHistory] = useState<readonly EventEnvelope[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (snapshot === null) return undefined;
    const controller = new AbortController();
    const terminal = ["completed", "cancelled", "failed"].includes(snapshot.status);
    const timer = setTimeout(() => {
      void Promise.all([
        client.report(snapshot.evaluationId, controller.signal),
        client.trace(snapshot.evaluationId, null, controller.signal),
        loadAllEvents(snapshot.evaluationId, controller.signal),
      ]).then(([nextReport, nextTrace, nextHistory]) => {
        setReport(nextReport);
        setTrace(nextTrace);
        setHistory(nextHistory);
      }).catch(() => undefined);
    }, terminal ? 0 : 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [snapshot?.evaluationId, snapshot?.latestCursor]);

  useEffect(() => {
    if (snapshot === null || !["queued", "running", "cancelling"].includes(snapshot.status)) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [snapshot?.status]);

  const completed = snapshot === null ? 0 : snapshot.aggregate.passed + snapshot.aggregate.failed + snapshot.aggregate.inconclusive + snapshot.aggregate.cancelled;
  const evaluationFailure = history === null ? undefined : [...history].reverse().find((event) => event.type === "evaluation.failed");
  const latestMilestone = history?.at(-1);
  const quietForMs = latestMilestone === undefined ? 0 : Math.max(0, now - Date.parse(latestMilestone.recordedAt));
  const quietThresholdMs = snapshot === null ? Number.POSITIVE_INFINITY : Math.max(30_000, snapshot.config.budgets.toolTimeoutMs * 2);
  const progressDelayed = snapshot !== null
    && ["queued", "running", "cancelling"].includes(snapshot.status)
    && latestMilestone !== undefined
    && quietForMs >= quietThresholdMs;

  return (
    <main id="main-content" className="tg-shell">
      <nav className="tg-breadcrumb" aria-label="Breadcrumb"><Link to="/">New evaluation</Link><span>/</span><span>Reliability</span></nav>
      <header className="tg-page-header">
        <div><p className="tg-eyebrow">Live evaluation</p><h1>Progress and reliability</h1><p className="tg-lede">Saved progress is restored after refresh or reconnect. Live updates appear only after they have been saved.</p></div>
        <div className="tg-status-stack"><StatusBadge status={snapshot?.status ?? "loading"} /><span className="tg-connection" data-state={live.connection}><span aria-hidden="true" />{live.connection === "live" ? "Live updates" : live.connection}</span></div>
      </header>

      {live.error === null ? null : <InlineNotice tone="warning">Live updates paused. TraceGate is reconnecting and will restore the latest saved progress.</InlineNotice>}
      {evaluationFailure?.type === "evaluation.failed" ? <InlineNotice tone="error">Evaluation could not continue. {evaluationFailure.payload.error.message}</InlineNotice> : null}
      {progressDelayed ? <InlineNotice tone="warning">No new progress has been saved for {Math.floor(quietForMs / 1_000)} seconds. The current step may be taking longer than expected; TraceGate will show the next durable update when it arrives.</InlineNotice> : null}
      {snapshot === null ? <Panel title="Loading evaluation"><p className="tg-muted">Loading the latest saved progress…</p></Panel> : <>
        <section className="tg-summary" aria-label="Reliability summary">
          <dl className="tg-summary__metrics">
            <Metric label="Progress" value={`${completed}/${snapshot.aggregate.requested}`} detail="Completed runs / requested runs" />
            <Metric label="Reliable outcomes" value={`${snapshot.aggregate.passed}/${snapshot.aggregate.requested}`} detail="Passed runs / all requested runs" />
            <Metric label="Inconclusive" value={snapshot.aggregate.inconclusive} detail="Could not be verified safely" />
            <Metric label="Reliability" value={snapshot.aggregate.endToEndPassRate.value === null ? "—" : `${Math.round(snapshot.aggregate.endToEndPassRate.value * 100)}%`} detail="Passed / all requested runs" />
          </dl>
        </section>

        <Panel eyebrow="Website → Task → Success criteria" title="What TraceGate is measuring">
          <p className="tg-target-url">{snapshot.config.target.startUrl}</p>
          <blockquote className="tg-task-quote">{snapshot.config.prompt}</blockquote>
          <p>{snapshot.config.assertions.length} independently checked success {snapshot.config.assertions.length === 1 ? "criterion" : "criteria"} across {snapshot.aggregate.requested} {snapshot.aggregate.requested === 1 ? "run" : "runs"}.</p>
        </Panel>

        <section className="tg-runs" aria-labelledby="progress-heading">
          <div className="tg-section-heading"><p className="tg-eyebrow">Progress</p><h2 id="progress-heading">Repeated runs</h2></div>
          <div className="tg-run-grid">{snapshot.runs.map((run) => <RunCard key={run.id} run={run} />)}</div>
        </section>

        <AgentInterfaceInsights runs={snapshot.runs} history={history} />
        {report === null ? null : <GradingReport report={report} />}

        <details className="tg-details">
          <summary>Execution evidence and limitations</summary>
          <div className="tg-details__body">
            <section>
              <h2>Assertion-blind trace</h2>
              <p className="tg-field-help">This bounded, redacted history contains execution summaries only. Success criteria and grading evidence stay separate.</p>
              {trace === null ? <p className="tg-muted">Loading execution evidence…</p> : <AgentTrace trace={trace} />}
            </section>
            <section>
              <h2>Environment and cleanup</h2>
              {history?.filter((event) => event.type === "run.environment.recorded").length
                ? <p>Execution environment evidence was committed for {history.filter((event) => event.type === "run.environment.recorded").length} {history.filter((event) => event.type === "run.environment.recorded").length === 1 ? "run" : "runs"}. Secret-bearing connection details are never shown.</p>
                : <p className="tg-muted">No environment evidence is committed yet.</p>}
              <p>Cleanup is shown on every run. An unconfirmed browser release makes that run inconclusive.</p>
            </section>
            <section>
              <h2>Known limitations</h2>
              <ul className="tg-limitations">
                <li>A pass proves only the declared, fresh browser-observable outcome—not arbitrary backend business truth.</li>
                <li>TraceGate does not guarantee whole-browser network confinement or perfect DNS-rebinding prevention.</li>
                <li>Website and MCP content remains untrusted and cannot determine the result directly.</li>
              </ul>
            </section>
          </div>
        </details>
      </>}
    </main>
  );
}
