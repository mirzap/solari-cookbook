import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  type InterfaceMode,
  type ModelId,
  type RuntimeCapabilities,
} from "@tracegate/shared";
import { InlineNotice, Panel, PrimaryButton, StatusBadge } from "@tracegate/ui";
import { TracegateApiClient, TracegateApiError } from "../lib/api-client.ts";
import {
  createEvaluationRequestFromDraft,
  type AssertionDraft,
  type AssertionKind,
} from "../lib/evaluation-form.ts";

const client = new TracegateApiClient();
const MODEL_LABELS: Record<ModelId, string> = {
  "deepseek/deepseek-v4-flash-0731": "DeepSeek V4 Flash",
  "mistralai/mistral-small-2603": "Mistral Small",
  "openai/gpt-5-mini": "GPT-5 mini",
};

export const Route = createFileRoute("/")({ component: ConfigurePage });

function safeMessage(error: unknown): string {
  if (error instanceof TracegateApiError) return error.safe.message;
  if (error instanceof Error && error.name === "ZodError") return "Check the website, task, success criteria, and run settings.";
  return "TraceGate could not start this evaluation.";
}

function ConfigurePage() {
  const navigate = useNavigate();
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startUrl, setStartUrl] = useState("");
  const [origins, setOrigins] = useState("");
  const [prompt, setPrompt] = useState("");
  const [modelIds, setModelIds] = useState<readonly ModelId[]>(["deepseek/deepseek-v4-flash-0731"]);
  const [runs, setRuns] = useState(3);
  const [concurrency, setConcurrency] = useState(1);
  const [recordingRequested, setRecordingRequested] = useState(false);
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>("auto");
  const [webMcpReadOnlyEnabled, setWebMcpReadOnlyEnabled] = useState(false);
  const [configuredMcpEnabled, setConfiguredMcpEnabled] = useState(false);
  const [configuredMcpLabel, setConfiguredMcpLabel] = useState("");
  const [configuredMcpEndpointUrl, setConfiguredMcpEndpointUrl] = useState("");
  const [configuredMcpSelectedToolsText, setConfiguredMcpSelectedToolsText] = useState("");
  const [assertions, setAssertions] = useState<readonly AssertionDraft[]>([
    { key: 1, kind: "text", value: "", name: "" },
  ]);
  const [nextAssertionKey, setNextAssertionKey] = useState(2);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void client.capabilities(controller.signal).then((value) => {
      setCapabilities(value);
      const firstAvailable = value.checks.find(
        (check) => check.kind === "model" && (check.status === "pending" || check.status === "verified") && check.subject in MODEL_LABELS,
      );
      if (firstAvailable !== undefined) setModelIds([firstAvailable.subject as ModelId]);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(safeMessage(error));
    });
    return () => controller.abort();
  }, []);

  const modelChecks = useMemo(
    () => capabilities?.checks.filter((check) => check.kind === "model" && check.subject in MODEL_LABELS) ?? [],
    [capabilities],
  );
  const blocked = capabilities === null || capabilities.blockerCodes.length > 0;

  function updateAssertion(key: number, patch: Partial<AssertionDraft>) {
    setAssertions((current) => current.map((assertion) => assertion.key === key ? { ...assertion, ...patch } : assertion));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const input = createEvaluationRequestFromDraft({
        startUrl,
        allowedOriginsText: origins || new URL(startUrl).origin,
        prompt,
        assertions,
        modelIds,
        runsPerModel: runs,
        concurrency,
        interfaceMode,
        webMcpReadOnlyEnabled,
        configuredMcpEnabled,
        configuredMcpLabel,
        configuredMcpEndpointUrl,
        configuredMcpSelectedToolsText,
        recordingRequested,
      });
      const created = await client.createEvaluation(input);
      await navigate({ to: "/evaluations/$id", params: { id: created.evaluationId } });
    } catch (error: unknown) {
      setFormError(safeMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="tg-shell">
      <header className="tg-page-header tg-hero">
        <div>
          <p className="tg-eyebrow">TraceGate</p>
          <h1>Is your website ready for the agent era?</h1>
          <p className="tg-lede">Repeat a real outcome task, measure how reliably agents complete it, and see which website interfaces helped or got in the way.</p>
        </div>
        <StatusBadge status={blocked ? "blocked" : "ready"} />
      </header>

      {loadError === null ? null : <InlineNotice tone="error">{loadError}</InlineNotice>}
      {capabilities?.blockerCodes.map((code) => <InlineNotice key={code} tone="warning">The evaluation runtime is not ready: {code.replaceAll("_", " ")}.</InlineNotice>)}

      <form className="tg-product-form" onSubmit={(event) => void submit(event)}>
        <Panel eyebrow="1 · Website" title="What site should agents use?">
          <div className="tg-field-stack">
            <label htmlFor="start-url">Public HTTPS website</label>
            <input id="start-url" type="url" required placeholder="https://your-site.example/path" value={startUrl} onChange={(event) => setStartUrl(event.target.value)} />
            <p className="tg-field-help">Use an anonymous public site. Never include sign-in links, access tokens, personal data, or private hosts.</p>
          </div>
        </Panel>

        <Panel eyebrow="2 · Task" title="What should the agent accomplish?">
          <div className="tg-field-stack">
            <label htmlFor="prompt">Task</label>
            <textarea id="prompt" required maxLength={1_000} rows={4} placeholder="Find the support plan for a small team and open its details." value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <p className="tg-field-help">Keep the task safe, reversible, and public. TraceGate does not allow purchases, messages, uploads, downloads, or destructive actions.</p>
          </div>
        </Panel>

        <Panel eyebrow="3 · Success criteria" title="What outcome proves success?">
          <div className="tg-field-stack">
            {assertions.map((assertion, index) => (
              <fieldset className="tg-assertion" data-kind={assertion.kind} key={assertion.key}>
                <legend>Criterion {index + 1}</legend>
                <label>Observe
                  <select value={assertion.kind} onChange={(event) => updateAssertion(assertion.key, { kind: event.target.value as AssertionKind })}>
                    <option value="text">Visible text</option>
                    <option value="url">Final page</option>
                    <option value="url_query">Registration page with plan</option>
                    <option value="semantic">Page element</option>
                    <option value="state">Selected state</option>
                  </select>
                </label>
                <label>{assertion.kind === "url_query" ? "Registration page URL" : assertion.kind === "url" ? "Expected page URL" : assertion.kind === "text" ? "Expected visible text" : "Element role"}
                  <input required type={assertion.kind === "url" || assertion.kind === "url_query" ? "url" : "text"} placeholder={assertion.kind === "url_query" ? "https://your-site.example/register" : assertion.kind === "url" ? "https://your-site.example/result" : assertion.kind === "text" ? "Support plan" : "heading"} value={assertion.value} onChange={(event) => updateAssertion(assertion.key, { value: event.target.value })} />
                </label>
                {assertion.kind === "url_query" ? <>
                  <label>Query parameter name
                    <input required placeholder="planId" value={assertion.queryParameterName ?? ""} onChange={(event) => updateAssertion(assertion.key, { queryParameterName: event.target.value })} />
                  </label>
                  <label>Expected value
                    <input required placeholder="12" value={assertion.queryParameterValue ?? ""} onChange={(event) => updateAssertion(assertion.key, { queryParameterValue: event.target.value })} />
                  </label>
                </> : null}
                {assertion.kind === "semantic" || assertion.kind === "state" ? <label>Accessible name
                  <input required placeholder="Plan details" value={assertion.name} onChange={(event) => updateAssertion(assertion.key, { name: event.target.value })} />
                </label> : null}
                <button type="button" className="tg-link-button" disabled={assertions.length === 1} onClick={() => setAssertions((current) => current.filter((item) => item.key !== assertion.key))}>Remove criterion</button>
              </fieldset>
            ))}
            <button type="button" className="tg-link-button" disabled={assertions.length >= 20} onClick={() => {
              setAssertions((current) => [...current, { key: nextAssertionKey, kind: "text", value: "", name: "", queryParameterName: "", queryParameterValue: "" }]);
              setNextAssertionKey((value) => value + 1);
            }}>Add success criterion</button>
            <p className="tg-field-help">Agents never see these checks. TraceGate grades them independently from a fresh browser view. If an outcome cannot be verified, the run is inconclusive—not guessed.</p>
          </div>
        </Panel>

        <Panel eyebrow="4 · Runs" title="How much repetition do you need?">
          <div className="tg-run-controls">
            <label htmlFor="runs">Runs
              <input id="runs" type="number" min={1} max={5} value={runs} onChange={(event) => setRuns(Number(event.target.value))} />
            </label>
            <p>More runs reveal intermittent paths. Start with three; use up to five per model in this proof of concept.</p>
          </div>
        </Panel>

        <details className="tg-details">
          <summary>Agent interfaces and advanced options</summary>
          <div className="tg-details__body">
            <section>
              <h2>Agent Interfaces</h2>
              <p>TraceGate checks whether agents can use Semantic UI, page WebMCP, a configured MCP endpoint, llms.txt, JSON-LD, or visual fallback—and records what they actually used.</p>
              <label className="tg-check"><input type="checkbox" checked={webMcpReadOnlyEnabled} onChange={(event) => setWebMcpReadOnlyEnabled(event.target.checked)} /> Let this site offer admitted read-only WebMCP tools</label>
              <label className="tg-check"><input type="checkbox" checked={configuredMcpEnabled} onChange={(event) => setConfiguredMcpEnabled(event.target.checked)} /> Add a read-only MCP endpoint</label>
              {configuredMcpEnabled ? <div className="tg-field-stack tg-inset-fields">
                <label htmlFor="mcp-label">Name
                  <input id="mcp-label" required value={configuredMcpLabel} placeholder="Product catalog" onChange={(event) => setConfiguredMcpLabel(event.target.value)} />
                </label>
                <label htmlFor="mcp-url">Endpoint
                  <input id="mcp-url" type="url" required value={configuredMcpEndpointUrl} placeholder="https://mcp.your-site.example/mcp" onChange={(event) => setConfiguredMcpEndpointUrl(event.target.value)} />
                </label>
                <label htmlFor="mcp-tools">Allowed read-only tools
                  <textarea id="mcp-tools" required rows={2} value={configuredMcpSelectedToolsText} placeholder="searchCatalog, getProductDetails" onChange={(event) => setConfiguredMcpSelectedToolsText(event.target.value)} />
                </label>
                <p className="tg-field-help">TraceGate accepts only unauthenticated HTTPS (or loopback HTTP) endpoints and locally admits the named read-only tools. It never persists endpoint URLs or raw tool output in readiness evidence.</p>
              </div> : null}
              <label htmlFor="interface-mode">Interface preference
                <select id="interface-mode" value={interfaceMode} onChange={(event) => setInterfaceMode(event.target.value as InterfaceMode)}>
                  <option value="auto">Use the best available interface</option>
                  <option value="semantic-only">Use browser semantics only</option>
                  <option value="mcp-preferred">Prefer admitted MCP interfaces</option>
                </select>
              </label>
            </section>

            <section>
              <h2>Evaluation controls</h2>
              <label htmlFor="origins">Additional allowed website origins
                <textarea id="origins" rows={2} placeholder="https://docs.your-site.example" value={origins} onChange={(event) => setOrigins(event.target.value)} />
              </label>
              <p className="tg-field-help">Leave blank to stay on the website origin. Add only exact public HTTPS origins, separated by commas or new lines.</p>
              <fieldset className="tg-model-list">
                <legend>Model</legend>
                {(Object.keys(MODEL_LABELS) as ModelId[]).map((id) => {
                  const capability = modelChecks.find((check) => check.subject === id);
                  const selected = modelIds.includes(id);
                  const available = capability?.status === "pending" || capability?.status === "verified";
                  return <label className="tg-check" key={id}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!available || (!selected && modelIds.length >= 3)}
                      onChange={(event) => setModelIds((current) => event.target.checked
                        ? [...current, id]
                        : current.length === 1 ? current : current.filter((item) => item !== id))}
                    />
                    {MODEL_LABELS[id]} · {capability?.status === "verified" ? "live verified" : capability?.status === "pending" ? "checked during first run" : "unavailable"}
                  </label>;
                })}
              </fieldset>
              <label htmlFor="concurrency">Concurrent runs
                <input id="concurrency" type="number" min={1} max={5} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} />
              </label>
              <label className="tg-check"><input type="checkbox" checked={recordingRequested} onChange={(event) => setRecordingRequested(event.target.checked)} /> Request a provider recording</label>
            </section>

            <section>
              <h2>Safety limitations</h2>
              <ul className="tg-limitations">
                <li>TraceGate reduces risk with exact-origin navigation and guarded actions, but cannot guarantee whole-browser network confinement or perfect DNS-rebinding prevention.</li>
                <li>Page and MCP content is untrusted and never authorizes unsafe effects.</li>
                <li>Only fresh browser-observable criteria determine pass, fail, or inconclusive.</li>
              </ul>
            </section>
          </div>
        </details>

        <div className="tg-submit-row">
          {formError === null ? null : <InlineNotice tone="error">{formError}</InlineNotice>}
          <PrimaryButton type="submit" disabled={blocked || submitting || modelIds.length === 0}>{submitting ? "Starting evaluation…" : "Measure reliability"}</PrimaryButton>
        </div>
      </form>
    </main>
  );
}
