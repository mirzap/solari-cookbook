import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { AgentTraceProjection, EvaluationReportProjection, EventListResponse, RunSnapshot } from "@tracegate/shared";
import { InlineNotice, Metric, Panel, StatusBadge } from "@tracegate/ui";
import { TracegateApiClient } from "../../lib/api-client.ts";
import { useLiveEvaluation } from "../../lib/use-live-evaluation.ts";

export const Route = createFileRoute("/evaluations/$id")({ component: LiveEvaluationPage });
const client = new TracegateApiClient();
const PIPELINE_STEPS = ["provision", "discover", "act", "capture", "grade", "cleanup"] as const;

function RunCard({ run }: { readonly run: RunSnapshot }) {
  const activeStep = run.status === "acquiring_browser" || run.status === "connecting_browser" ? 0
    : run.status === "discovering" ? 1
      : run.status === "running_agent" ? 2
        : run.status === "grading" ? 4
          : run.status === "releasing_browser" ? 5
            : -1;

  return (
    <article className="tg-run-card">
      <header className="tg-run-card__header">
        <div><p className="tg-eyebrow">Run {run.runIndex + 1}</p><h3>{run.modelId}</h3></div>
        <StatusBadge status={run.outcome ?? run.status} />
      </header>
      <ol className="tg-pipeline" aria-label={`Run ${run.runIndex + 1} pipeline`}>
        {PIPELINE_STEPS.map((step, index) => <li key={step} data-state={index < activeStep || run.finishedAt !== null ? "done" : index === activeStep ? "active" : "waiting"}>{step}</li>)}
      </ol>
      <dl className="tg-run-metrics">
        <Metric label="Iterations" value={run.iterations} />
        <Metric label="Tool calls" value={run.toolCalls} />
        <Metric label="Browser actions" value={run.browserActions} />
        <Metric label="Duration" value={run.durationMs === null ? "—" : `${run.durationMs} ms`} />
        <Metric label="Cleanup" value={run.releaseStatus} detail={run.releaseStatus === "released" ? "Provider release confirmed" : "Not confirmed released"} />
      </dl>
      {run.failure === null ? null : <InlineNotice tone={run.outcome === "inconclusive" ? "warning" : "error"}>{run.failure.message}</InlineNotice>}
      {run.warnings.map((warning, index) => <InlineNotice key={`${warning.code}-${index}`} tone="warning">{warning.message}</InlineNotice>)}
      {run.potentialSessionLeak ? <InlineNotice tone="warning">Potential unacknowledged browser session leak; this run cannot be presented as conclusive.</InlineNotice> : null}
    </article>
  );
}

function GradingReport({ report }: { readonly report: EvaluationReportProjection }) {
  return (
    <Panel eyebrow="Independent grading panel" title="Fresh browser-observable evidence">
      <p>{report.observableStateLimitation}</p>
      <p className="tg-code">{report.target.redactedDisplayUrl}</p>
      <div className="tg-report-runs">
        {report.runs.map((run) => (
          <section key={run.id} className="tg-report-run">
            <header><strong>Run {run.runIndex + 1}</strong><StatusBadge status={run.outcome ?? run.status} /></header>
            {run.grade === null ? <p className="tg-muted">No deterministic grade is committed yet.</p> : (
              <table className="tg-result-table">
                <thead><tr><th>Assertion</th><th>Result</th><th>Observed</th></tr></thead>
                <tbody>{run.grade.assertions.map((result) => <tr key={result.assertionId}>
                  <td>{result.assertionId}</td><td><StatusBadge status={result.status} /></td><td>{result.actualSummary}</td>
                </tr>)}</tbody>
              </table>
            )}
          </section>
        ))}
      </div>
    </Panel>
  );
}

function AgentTrace({ trace }: { readonly trace: AgentTraceProjection }) {
  return (
    <Panel eyebrow="Assertion-blind agent trace" title="Bounded redacted execution milestones">
      <p className="tg-field-help">This panel contains model/tool summaries only. Assertion definitions and grading evidence are deliberately separate.</p>
      {trace.items.length === 0 ? <p className="tg-muted">No agent milestones committed yet.</p> : <ol className="tg-trace">
        {trace.items.map((item) => <li key={`${item.runId}-${item.runSequence}`}>
          <time>{new Date(item.occurredAt).toLocaleTimeString()}</time>
          <strong>{item.event.type.replaceAll(".", " ")}</strong>
          <span>{"summary" in item.event.payload ? item.event.payload.summary : "resultSummary" in item.event.payload ? item.event.payload.resultSummary : "usage milestone"}</span>
        </li>)}
      </ol>}
      {trace.truncated ? <InlineNotice tone="warning">Trace is bounded and truncated. Fetch the next cursor to continue.</InlineNotice> : null}
    </Panel>
  );
}

function LiveEvaluationPage() {
  const { id } = Route.useParams();
  const live = useLiveEvaluation(id);
  const snapshot = live.snapshot;
  const [report, setReport] = useState<EvaluationReportProjection | null>(null);
  const [trace, setTrace] = useState<AgentTraceProjection | null>(null);
  const [history, setHistory] = useState<EventListResponse | null>(null);

  useEffect(() => {
    if (snapshot === null) return undefined;
    const controller = new AbortController();
    void Promise.all([
      client.report(snapshot.evaluationId, controller.signal),
      client.trace(snapshot.evaluationId, null, controller.signal),
      client.events(snapshot.evaluationId, null, controller.signal),
    ]).then(([nextReport, nextTrace, nextHistory]) => {
      setReport(nextReport);
      setTrace(nextTrace);
      setHistory(nextHistory);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [snapshot?.evaluationId, snapshot?.latestCursor]);

  return (
    <main id="main-content" className="tg-shell">
      <nav className="tg-breadcrumb" aria-label="Breadcrumb"><Link to="/">New evaluation</Link><span>/</span><span>Live evaluation</span></nav>
      <header className="tg-page-header">
        <div><p className="tg-eyebrow">Authoritative snapshot + committed milestones</p><h1>Evaluation dashboard</h1><p className="tg-code">{id}</p></div>
        <div className="tg-status-stack"><StatusBadge status={snapshot?.status ?? "loading"} /><span className="tg-connection" data-state={live.connection}><span aria-hidden="true" />{live.connection}</span></div>
      </header>

      {live.error === null ? null : <InlineNotice tone="warning">{live.error} Reconnecting through the subscribe-first snapshot handshake.</InlineNotice>}
      {snapshot === null ? <Panel title="Loading evaluation"><p className="tg-muted">Subscribing, then reading the durable evaluation snapshot…</p></Panel> : <>
        <section className="tg-summary" aria-label="Evaluation summary">
          <dl className="tg-summary__metrics">
            <Metric label="Started" value={`${snapshot.aggregate.started}/${snapshot.aggregate.requested}`} />
            <Metric label="Passed" value={snapshot.aggregate.passed} />
            <Metric label="Failed" value={snapshot.aggregate.failed} />
            <Metric label="Inconclusive" value={snapshot.aggregate.inconclusive} />
            <Metric label="End-to-end pass rate" value={snapshot.aggregate.endToEndPassRate.value === null ? "—" : `${Math.round(snapshot.aggregate.endToEndPassRate.value * 100)}%`} detail="Passed / all requested runs" />
            <Metric label="Gradeable success" value={snapshot.aggregate.gradeableObservableStateSuccess.value === null ? "—" : `${Math.round(snapshot.aggregate.gradeableObservableStateSuccess.value * 100)}%`} detail="Passed / (passed + failed)" />
          </dl>
          <div className="tg-cursor"><span>Latest persisted cursor</span><strong>{snapshot.latestCursor ?? "none"}</strong></div>
        </section>

        <Panel eyebrow="Task" title="User-authored prompt">
          <p>{snapshot.config.prompt}</p>
          <p className="tg-code">{snapshot.config.target.startUrl}</p>
          <p className="tg-field-help">Allowed origins: {snapshot.config.target.allowedNavigationOrigins.join(", ")}</p>
          <p className="tg-field-help">Experimental read-only WebMCP: {snapshot.config.webMcpReadOnlyEnabled ? "opted in; admitted tools only" : "off"}. Results remain untrusted and never grade directly.</p>
        </Panel>

        <section className="tg-runs" aria-labelledby="runs-heading">
          <div className="tg-section-heading"><p className="tg-eyebrow">Execution</p><h2 id="runs-heading">Runs</h2></div>
          <div className="tg-run-grid">{snapshot.runs.map((run) => <RunCard key={run.id} run={run} />)}</div>
        </section>

        {history === null ? null : <Panel eyebrow="Execution environment" title="Persisted generic run evidence">
          {history.events.filter((event) => event.type === "run.environment.recorded").length === 0
            ? <p className="tg-muted">No execution-environment milestone is committed yet.</p>
            : <dl className="tg-environment-list">{history.events.filter((event) => event.type === "run.environment.recorded").map((event) => {
                const environment = event.payload;
                return <div key={event.eventId}>
                  <dt>Run {event.runId ?? "evaluation"}</dt>
                  <dd>Node {environment.nodeVersion} · pnpm {environment.pnpmVersion} · {environment.browserProvider} ({environment.browserRegion ?? "default region"}) · {environment.modelId} via {environment.resolvedProvider ?? "provider unresolved"}</dd>
                </div>;
              })}</dl>}
          <p className="tg-field-help">Environment evidence is a committed, redacted milestone. Provider session identifiers and secret-bearing connection URLs are never projected here.</p>
        </Panel>}
        {trace === null ? null : <AgentTrace trace={trace} />}
        {report === null ? null : <GradingReport report={report} />}

        <Panel eyebrow="Known limitations" title="What this result does not prove">
          <ul className="tg-limitations"><li>PASS is limited to declared fresh browser-observable assertions.</li><li>P0 does not guarantee whole-browser egress confinement or perfect DNS-rebinding prevention.</li><li>Page semantics and admitted WebMCP output are untrusted content, not safety authorization.</li></ul>
        </Panel>
      </>}
    </main>
  );
}
