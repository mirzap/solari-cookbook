import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
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
  "deepseek/deepseek-v4-flash-0731": "DeepSeek V4 Flash (verified P0)",
  "mistralai/mistral-small-2603": "Mistral Small (optional)",
  "openai/gpt-5-mini": "GPT-5 mini (optional)",
};

export const Route = createFileRoute("/")({ component: ConfigurePage });

function safeMessage(error: unknown): string {
  if (error instanceof TracegateApiError) return error.safe.message;
  if (error instanceof Error && error.name === "ZodError") return "Please correct the highlighted evaluation fields and assertion values.";
  return "The evaluation service could not complete the request.";
}

function ConfigurePage() {
  const navigate = useNavigate();
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startUrl, setStartUrl] = useState("https://example.com/");
  const [origins, setOrigins] = useState("https://example.com");
  const [prompt, setPrompt] = useState("Find the public information requested and leave the page in the matching observable state.");
  const [modelIds, setModelIds] = useState<readonly ModelId[]>(["deepseek/deepseek-v4-flash-0731"]);
  const [runs, setRuns] = useState(1);
  const [concurrency, setConcurrency] = useState(1);
  const [recordingRequested, setRecordingRequested] = useState(false);
  const [webMcpReadOnlyEnabled, setWebMcpReadOnlyEnabled] = useState(false);
  const [assertions, setAssertions] = useState<readonly AssertionDraft[]>([
    { key: 1, kind: "url", value: "https://example.com/", name: "" },
    { key: 2, kind: "text", value: "Example Domain", name: "" },
  ]);
  const [nextAssertionKey, setNextAssertionKey] = useState(3);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void client.capabilities(controller.signal).then((value) => {
      setCapabilities(value);
      const firstVerified = value.checks.find(
        (check) => check.kind === "model" && check.status === "verified" && check.subject in MODEL_LABELS,
      );
      if (firstVerified !== undefined) setModelIds([firstVerified.subject as ModelId]);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(safeMessage(error));
    });
    return () => controller.abort();
  }, []);

  const modelChecks = useMemo(
    () => capabilities?.checks.filter((check) => check.kind === "model" && check.subject in MODEL_LABELS) ?? [],
    [capabilities],
  );
  const webMcpCapability = capabilities?.checks.find((check) => check.kind === "webmcp");
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
        allowedOriginsText: origins,
        prompt,
        assertions,
        modelIds,
        runsPerModel: runs,
        concurrency,
        webMcpReadOnlyEnabled,
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
      <header className="tg-page-header">
        <div>
          <p className="tg-eyebrow">TraceGate · loopback control plane</p>
          <h1>Configure a public-site evaluation</h1>
          <p className="tg-lede">Define observable success, run isolated browser sessions, and grade fresh evidence independently of the model.</p>
        </div>
        <StatusBadge status={blocked ? "blocked" : "ready"} />
      </header>

      {loadError === null ? null : <InlineNotice tone="error">{loadError}</InlineNotice>}
      {capabilities?.blockerCodes.map((code) => <InlineNotice key={code} tone="warning">Capability blocker: {code}</InlineNotice>)}

      <form className="tg-config-grid" onSubmit={(event) => void submit(event)}>
        <Panel eyebrow="Target" title="Anonymous public HTTPS site">
          <div className="tg-field-stack">
            <label htmlFor="start-url">Start URL</label>
            <input id="start-url" type="url" required value={startUrl} onChange={(event) => setStartUrl(event.target.value)} />
            <label htmlFor="origins">Exact allowed origins</label>
            <textarea id="origins" required rows={2} value={origins} onChange={(event) => setOrigins(event.target.value)} />
            <p className="tg-field-help">One to three canonical HTTPS origins, separated by commas or new lines. Use anonymous public URLs only—never signed URLs, access tokens, credentials, or private hosts.</p>
          </div>
        </Panel>

        <Panel eyebrow="Task" title="Assertion-blind user prompt">
          <div className="tg-field-stack">
            <label htmlFor="prompt">Prompt</label>
            <textarea id="prompt" required maxLength={1_000} rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <p className="tg-field-help">Do not include credentials, personal data, purchases, messages, uploads, downloads, or destructive actions.</p>
          </div>
        </Panel>

        <Panel eyebrow="Grade" title="Browser-observable assertions">
          <div className="tg-field-stack">
            {assertions.map((assertion, index) => (
              <fieldset className="tg-assertion" key={assertion.key}>
                <legend>Assertion {index + 1}</legend>
                <label>Kind
                  <select value={assertion.kind} onChange={(event) => updateAssertion(assertion.key, { kind: event.target.value as AssertionKind })}>
                    <option value="url">Final URL</option><option value="text">Visible text</option><option value="semantic">Semantic element</option><option value="state">Selected state</option>
                  </select>
                </label>
                <label>{assertion.kind === "url" ? "Expected HTTPS URL" : assertion.kind === "text" ? "Expected text" : "ARIA role"}
                  <input required value={assertion.value} onChange={(event) => updateAssertion(assertion.key, { value: event.target.value })} />
                </label>
                {assertion.kind === "semantic" || assertion.kind === "state" ? <label>Accessible name
                  <input required value={assertion.name} onChange={(event) => updateAssertion(assertion.key, { name: event.target.value })} />
                </label> : null}
                <button type="button" className="tg-link-button" disabled={assertions.length === 1} onClick={() => setAssertions((current) => current.filter((item) => item.key !== assertion.key))}>Remove</button>
              </fieldset>
            ))}
            <button type="button" className="tg-link-button" disabled={assertions.length >= 20} onClick={() => {
              setAssertions((current) => [...current, { key: nextAssertionKey, kind: "text", value: "", name: "" }]);
              setNextAssertionKey((value) => value + 1);
            }}>Add assertion</button>
            <p className="tg-field-help">Assertions never enter the agent DTO, tools, history, or trace. PASS proves these browser-observable checks only.</p>
          </div>
        </Panel>

        <Panel eyebrow="Execution" title="Model, runs, and concurrency">
          <div className="tg-field-stack">
            <fieldset className="tg-model-list">
              <legend>Models (one to three)</legend>
              {(Object.keys(MODEL_LABELS) as ModelId[]).map((id) => {
                const capability = modelChecks.find((check) => check.subject === id);
                const selected = modelIds.includes(id);
                const unavailable = capability?.status !== "verified";
                return <label className="tg-check" key={id}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={unavailable || (!selected && modelIds.length >= 3)}
                    onChange={(event) => setModelIds((current) => event.target.checked
                      ? [...current, id]
                      : current.length === 1 ? current : current.filter((item) => item !== id))}
                  />
                  {MODEL_LABELS[id]} · {capability?.status ?? "unverified"}
                </label>;
              })}
            </fieldset>
            <label htmlFor="runs">Runs per model</label>
            <input id="runs" type="number" min={1} max={5} value={runs} onChange={(event) => setRuns(Number(event.target.value))} />
            <label htmlFor="concurrency">Concurrency</label>
            <input id="concurrency" type="number" min={1} max={5} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} />
            <label className="tg-check"><input type="checkbox" checked={recordingRequested} onChange={(event) => setRecordingRequested(event.target.checked)} /> Request provider recording</label>
          </div>
        </Panel>

        <Panel eyebrow="Experimental" title="Read-only WebMCP adapter">
          <div className="tg-field-stack">
            <label className="tg-check"><input type="checkbox" checked={webMcpReadOnlyEnabled} onChange={(event) => setWebMcpReadOnlyEnabled(event.target.checked)} /> Opt in to admitted read-only WebMCP tools</label>
            <p className="tg-field-help">Off by default. Site descriptors, annotations, and results are untrusted. Only sanitized current-origin read-only tools may appear; rejection or failure degrades to semantic browser controls. WebMCP results never grade directly.</p>
            <StatusBadge status={webMcpCapability?.status ?? "not_configured"} />
          </div>
        </Panel>

        <Panel eyebrow="Limitations" title="Practical PoC safety boundary">
          <ul className="tg-limitations">
            <li>Exact-origin navigation, structural URL checks, best-effort public DNS preflight, and observable request/action guards reduce risk.</li>
            <li>TraceGate does not provide perfect DNS-rebinding prevention or whole-browser egress confinement.</li>
            <li>An unstable or incomplete fresh capture yields INCONCLUSIVE rather than guessed truth.</li>
          </ul>
        </Panel>

        <div className="tg-submit-row">
          {formError === null ? null : <InlineNotice tone="error">{formError}</InlineNotice>}
          <PrimaryButton type="submit" disabled={blocked || submitting || modelIds.length === 0}>{submitting ? "Creating…" : "Run evaluation"}</PrimaryButton>
        </div>
      </form>
    </main>
  );
}
