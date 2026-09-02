# F3 real-provider validation — Talon — 2026-09-02

## Decision

**F3's real-provider/API/DB subgate passed.** Exactly one independent evaluation run completed through the production-built TraceGate API using Solari Browser and `deepseek/deepseek-v4-flash-0731`. Fresh browser evidence was gradeable, the deterministic result was **PASS**, the browser session release was provider-confirmed, and the final database had no unresolved session, provider attempt, leak, or nonterminal run.

The source plan also requires observing the product UI consume live updates. This authorized run observed the production API, live SSE transport, and database directly, not a browser-rendered UI consumer. A later terminal route GET returned the expected client-loading shell but cannot retrospectively prove live UI projection. Therefore the provider path succeeded, but the full F3 milestone remains open on that UI-only criterion and F4 is not yet promoted. This is one validation observation, not a reliability-rate claim; the three-run evaluation was not started.

## Scope and controls

- External validation target: `https://www.talon.ba`.
- Natural-language task, submitted verbatim: **“Navigate to Pricing, select the Standard plan, and finish on the registration page.”**
- One browser-observable assertion used `origin_path_and_query_parameter_equals` with expected URL `https://www.talon.ba/register` and query parameter `planId=12`. This operator requires the expected origin/path and exactly one occurrence of the named parameter with the configured value.
- Model: `deepseek/deepseek-v4-flash-0731`.
- Interface mode: `semantic-only`.
- Requested runs/concurrency: `1/1`.
- Recording: not requested.
- Default bounded runtime budgets were used: 120,000 ms wall clock, 15 model turns, 40 tool calls, 25 browser actions, 15,000 ms per tool, 12,288 observation bytes, 96,000 history bytes, and 100,000 total tokens.
- A new temporary database was used: `/tmp/tracegate-f3-talon-20260902-b347bf3.db`.
- Automated tests were not created, edited, compiled as claimed evidence, or run. No second or three-run provider evaluation was submitted.
- Agent A did not edit any B-, C-, or D-owned path.

Before execution, a production-source search over `apps`, `packages`, and `scripts` returned zero matches for `talon`, `talon.ba`, `planId`, or `Standard plan`. The target/task/assertion were request data only; there is no Talon-specific production branch or fixture logic.

Provider session identifiers and all credentials are omitted from this document. The API/SSE projections used by the audit redact provider session identifiers. The temporary DB was inspected only with identifier-suppressing boolean/count queries; no raw provider session identifier was copied into durable evidence.

## Production-only commands and results

All package commands used the installed mise toolchain and pnpm `12.0.0`; Corepack was not used.

### Build and fresh database

```bash
cd examples/tracegate
test ! -e /tmp/tracegate-f3-talon-20260902-b347bf3.db
mise exec -- pnpm build
DATABASE_URL=file:/tmp/tracegate-f3-talon-20260902-b347bf3.db mise exec -- pnpm db:migrate
DATABASE_URL=file:/tmp/tracegate-f3-talon-20260902-b347bf3.db mise exec -- pnpm db:check
```

Results:

- the database path did not exist before the gate;
- both required provider credential variables were present, checked as booleans without printing values;
- all 11 production packages built successfully; `@tracegate/e2e` was excluded;
- migration `0000` applied successfully;
- Drizzle reported `Everything's fine`.

### Built product and preflight

```bash
DATABASE_URL=file:/tmp/tracegate-f3-talon-20260902-b347bf3.db \
  TRACEGATE_PORT=3105 mise exec -- pnpm start
curl -H 'Accept: application/json' http://127.0.0.1:3105/api/health
curl -H 'Accept: application/json' http://127.0.0.1:3105/api/capabilities
```

The production server started on `127.0.0.1:3105`. Preflight health was honestly `degraded`: database/WebMCP were healthy, while the configured DeepSeek and Solari capabilities remained pending because no live usage/session had yet been persisted. Capabilities returned no blocker codes.

### Exactly one submission

One—and only one—mutation request was sent:

```bash
curl -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:3105' \
  --data-binary @/tmp/tracegate-f3-request.json \
  http://127.0.0.1:3105/api/evaluations
```

The request returned HTTP `202` in `0.060614` seconds with `queued`, one run ID, and initial cursor `1`. No retry or second POST occurred.

Immediately after the response supplied the evaluation ID, the live SSE endpoint was opened with `Accept: text/event-stream`. It emitted the ready frame, heartbeats, and live milestones from cursor `7` through terminal cursor `38`. Cursors `1`–`6` could occur before an evaluation-specific SSE URL was knowable; the authoritative JSON events endpoint subsequently returned the complete contiguous `1`–`38` history with no next cursor.

The snapshot was polled read-only until terminal, then snapshot, report, trace, events, and post-run capabilities were fetched from the built API. No provider retry or replay was initiated.

## Authoritative outcome

### Agent/model execution

- Run duration: `62,546 ms` (`2026-09-02T08:48:34.679Z` to `2026-09-02T08:49:37.225Z`).
- Model iterations: `4`.
- Tool calls: `4`; browser actions: `3`.
- Token usage: `17,022` prompt, `946` completion, `17,968` total.
- Dispatched successful tool completions:
  - `navigate`, orchestration, `3,773 ms`;
  - `click`, `semantic_ui`, `6,423 ms`;
  - `wait`, orchestration, `4,148 ms`;
  - `finish`, orchestration, `21 ms`.
- The semantic click was both dispatched and successful. Snapshot/report readiness agreed: `semantic_ui` discovered `1`, admitted `1`, invoked `1`, succeeded `1`, failed `0`.
- `llms.txt` and JSON-LD were discovery-only (`discovered=1`, `admitted/invoked=0`). Page WebMCP, configured MCP, and visual fallback were unused.

### Fresh evidence and deterministic grade

- Fresh evidence capture completed in two attempts.
- Assertion count: `1`; unverifiable count: `0`.
- Persisted redacted final display URL: `https://www.talon.ba/register`.
- Deterministic grade: `passed` with no failure.
- Authoritative assertion result: `passed` — “Final URL origin/path matched; query parameter planId was present once and its value matched.”
- Snapshot and report both returned run `completed/passed` and aggregate requested `1`, passed `1`, failed `0`, inconclusive `0`, cancelled `0`, nonterminal `0`, potential leaks `0`.
- End-to-end pass rate and gradeable-observable-state success were both `1/1` for this single observation.

The only run warning was `passive_policy_blocked` during discovery: blocked passive browser activity was observed, but trustworthy page evidence remained valid. It was preserved in both snapshot and report and did not become a fabricated task failure or success signal.

### Solari acknowledgement, release, SSE, and DB

- `run.browser.ready` recorded Solari Browser in `us-west` with recording disabled.
- The browser session row and provider-create-attempt row both contained a non-empty provider session identifier; only that boolean fact was inspected.
- Post-run capabilities changed DeepSeek to `verified` from a persisted live usage milestone and Solari to `verified` from a live session acquisition.
- Release milestone: `releasing → released`, `confirmed: true`.
- Browser-session DB state: `released`, confirmation `1`, release timestamp present, replay `not_requested`.
- Provider attempt: `released`, potential leak `0`.
- Event history: 38 contiguous events, including four iterations, four tool starts/completions, four usage updates, evidence captured, grade completed, release confirmed, `run.passed`, and `evaluation.completed`.
- Run-step history: 34 contiguous steps.
- Database cardinality: one evaluation, one run, one browser session, one evidence row, and one grade row.
- Identifier/secret-like scans of event and run-step JSON found zero rows containing API-key, bearer-token, WebSocket/CDP URL, or provider-session-ID markers.

After the terminal state, the production process was interrupted once with Ctrl-C. The pnpm wrapper reported interruption exit `1`; a loopback probe confirmed the server was no longer listening. A final DB audit found:

- unresolved browser sessions: `0`;
- unresolved provider attempts: `0`;
- potential-leak runs: `0`;
- nonterminal runs: `0`.

The built server was then restarted read-only against the same terminal DB and `GET /evaluations/<redacted-evaluation-id>` returned HTTP `200` in `1.042178` seconds. Its server-rendered HTML contained the TraceGate client-loading shell, not the hydrated terminal report. Database cardinality remained `1/1/1` for evaluation/run/browser session, so the read did not create provider work. The server was stopped again; a final probe found no listener, zero unresolved browser sessions, and zero nonterminal runs. This is useful route availability evidence but **not** evidence that a browser UI consumed the live SSE milestones or rendered the final warning/grade correctly.

## Gate conclusion and remaining conditions

**The real Solari/DeepSeek provider path is validated for one bounded semantic-only run. The full source-plan F3 milestone and F4 readiness remain blocked only on a browser-observed UI live-update/projection gate, not on provider/model/browser execution, grading, persistence, or cleanup.** This gate does not establish repeated-run reliability or independence by observation.

Still unverified/deferred:

- browser-observed UI consumption of live milestones and agreement of the hydrated terminal warning, trace, readiness, and grade projections;
- after that UI gate, F4's three independent sessions, aggregate reconstruction, duplicate-run audit, and equal-evidence attribution under repeated execution;
- SSE subscription to the earliest post-submission cursors is structurally impossible before the POST returns its evaluation ID, so reconnect/history recovery remains essential; complete history was verified through the JSON endpoint, while live SSE was observed from cursor 7;
- page WebMCP, configured MCP, visual fallback, optional models, recording/replay, cancellation, queue saturation, restart recovery, and reconnect/gap UI behavior;
- provider-grade egress enforcement and perfect DNS-rebinding prevention remain documented hardening limitations;
- the non-fatal passive-policy warning should be tracked across F4 rather than suppressed.
