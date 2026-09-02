# Agent D F3 live UI validation — 2026-09-02

## Decision

**PASS — the remaining F3 live-UI projection gate is closed.**

A separately authorized, single evaluation/run was submitted through the production-built TraceGate product UI and observed in the same ephemeral browser from initial running state through hydrated terminal state. The UI stayed on `Live updates`, rendered durable progress, warnings, interface readiness and usage, the terminal grade, the assertion-blind trace, and cleanup state consistently with the redacted API projections and fresh database.

This UI-attached run ended **INCONCLUSIVE**, not PASS: a dispatched semantic click was blocked after a same-origin non-idempotent XHR was observed, and fresh admitted-origin evidence could not be re-established. TraceGate therefore rendered both configured assertions as unverifiable rather than guessing. This is an honest terminal observation of the UI gate, not a second provider-success claim. F3's earlier real-provider/API/DB subgate already recorded a deterministic PASS in `f3-real-provider-talon-2026-09-02.md`; this run supplies the previously missing browser-attached UI evidence.

No production change was required. No Talon-specific production behavior was added.

## Isolation and exact request

- Fresh temporary database: `/tmp/tracegate-f3-agent-d.4SCrrM/tracegate.db`.
- Initial database counts: evaluations `0`, runs `0`, events `0`.
- Product server: production build on `http://127.0.0.1:3060`.
- Target entered through the visible form: `https://www.talon.ba`.
- Task entered verbatim: **“Navigate to Pricing, select the Standard plan, and finish on the registration page.”**
- Runs: `1`; concurrency remained `1`; recording remained disabled.
- Criterion 1: final origin/path equals `https://www.talon.ba/register`.
- Criterion 2: final origin/path equals `https://www.talon.ba/register` with exactly one `planId=12`.
- Exactly one submit-button activation and exactly one observed `POST /api/evaluations`.
- Final fresh-DB counts: evaluations `1`, runs `1`, events `44`, grade results `1`, assertion-evidence records `0`.
- Evaluation, run, browser-provider session, and Chrome target identifiers are intentionally omitted.

## Browser method

Google Chrome `152.0.7977.65` was launched with a new disposable profile and `--headless=new`. A one-off inline Node process used raw Chrome DevTools Protocol over the browser's loopback debugging endpoint; no Playwright, test framework, test file, or test suite was used.

The CDP process operated the rendered React form controls, verified native form validity, activated the visible `Measure reliability` button once, enabled Chrome Network observation to count the single mutation request, stayed connected across the client-side route transition, and sampled the hydrated DOM only when meaningful state changed. After terminal state, the visible `Run details` and `Execution evidence and limitations` disclosure controls were expanded and inspected. A terminal screenshot was captured only in the temporary directory for manual visual inspection and was not committed.

## Observed live product state

The browser observed these durable transitions without refresh or reconnect:

1. Evaluation `running`, connection `Live updates`; run `preparing`; `Prepare` active; cleanup `not started`.
2. Run `exploring`; `Prepare` done and `Explore` active.
3. Run `working`; Semantic UI, `llms.txt`, and JSON-LD became available from discovery evidence; the assertion-blind trace began hydrating.
4. Semantic UI usage advanced from `1` through `6` actual completed tool events while tool calls, model iterations, browser actions, and trace items updated live.
5. Evaluation `completed`; progress `1/1`; run `inconclusive`; every pipeline stage marked done; connection still `Live updates`.

Hydrated terminal product projection:

- Run: completed / inconclusive.
- Time: `95.8s`; model iterations: `7`; tool calls: `6`; browser actions: `6`.
- Run failure notice: “A dispatched state-changing tool failed and fresh admitted-origin evidence could not be re-established”.
- Warning: “Blocked passive browser activity was observed; trustworthy page evidence remains valid”.
- Semantic UI: `used`; actual uses `6`; `5 completed · 1 failed`; time in use `30.2s`; reliability when used `0/1`.
- `llms.txt`: available, discovery-only, `0` uses.
- JSON-LD: available, discovery-only, `0` uses.
- Page WebMCP and configured MCP: not observed, `0` uses.
- Both success criteria: `unverifiable` — “No trustworthy final browser evidence was available.”
- Assertion-blind trace: `31` items, including seven model iterations and six paired tool start/completion milestones; the last completion was rendered product-safely as a blocked action.
- Run details: `Cleanup: released`.
- Environment section: evidence committed for one run; secret-bearing connection details were not shown.

The page did not render credentials, raw provider connection data, or provider session identifiers.

## API and database reconciliation

The redacted snapshot API returned:

- evaluation `completed`;
- aggregate requested `1`, started `1`, passed `0`, failed `0`, inconclusive `1`, cancelled `0`, nonterminal `0`, potential leaks `0`;
- run `completed/inconclusive`, tool calls `6`, browser actions `6`, release status `released`, potential-session-leak `false`;
- semantic usage discovered/admitted/invoked/succeeded/failed = `1/1/6/5/1`;
- `llms.txt` and JSON-LD = discovered `1`, admitted/invoked `0`;
- WebMCP, configured MCP, and visual fallback = `0/0/0`.

The redacted report API returned both criteria as `unverifiable` with `evidence_invalid`; no trustworthy final browser evidence was available. The trace API returned `31` bounded assertion-blind items. Post-run capabilities marked database, model, Solari, and WebMCP checks verified with no blockers.

Fresh-DB reconciliation returned:

- exactly one evaluation and one run, both terminal;
- run outcome `inconclusive`;
- run release status `released`, potential session leak `0`;
- browser-session release status `released`, release confirmed `1`, recording requested `0`, replay status `not_requested`;
- one `evaluation.completed`, one `run.inconclusive`, one `run.release.status_changed`, six `run.tool.started`, and six `run.tool.completed` events;
- zero assertion-evidence rows, consistent with the UI/report's evidence-invalid inconclusive grade rather than an invented gradeable observation.

Provider session identity was neither selected from the database nor included in any evidence output.

## Commands and results

Commands ran from `examples/tracegate` with Node `26.1.0` and pnpm `12.0.0`:

```bash
pnpm --filter @tracegate/db typecheck
pnpm --filter @tracegate/db build
pnpm --filter @tracegate/ui typecheck
pnpm --filter @tracegate/ui build
pnpm --filter @tracegate/web typecheck
pnpm --filter @tracegate/web build
```

All six passed. The web production build completed both client and SSR bundles.

```bash
DATABASE_URL=file:/tmp/tracegate-f3-agent-d.4SCrrM/tracegate.db \
TRACEGATE_PORT=3060 pnpm start

curl -sS http://127.0.0.1:3060/api/health
curl -sS http://127.0.0.1:3060/api/capabilities
sqlite3 /tmp/tracegate-f3-agent-d.4SCrrM/tracegate.db '<redacted count/status-only queries>'
```

Migrations applied successfully. Pre-submit health was honestly `degraded` because configured model/Solari capabilities were pending their first persisted live usage/session milestones; blocker codes were empty. After the run, both capabilities were verified. The server was stopped only after terminal API/DB reconciliation and confirmed release.

Browser command shape:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --remote-debugging-port=9223 \
  --user-data-dir=/tmp/tracegate-f3-agent-d.4SCrrM/chrome-profile \
  --no-first-run --no-default-browser-check \
  --disable-background-networking --disable-sync about:blank

node --input-type=module --eval '<one-off raw-CDP visible-form/live-projection driver>'
```

The CDP driver reported `SUBMITTED_ONCE` and `SUBMISSION_POSTS 1`, reached terminal state, and exited successfully. Automated tests were not created, modified, or run.

## Scope and next gate

The missing F3 UI-attached live-consumption requirement is now observed and reconciled. **Full F3 is closed.** F4 remains a separate, explicitly authorized repeated-independent-run and equal-evidence-attribution gate; it was not started here.
