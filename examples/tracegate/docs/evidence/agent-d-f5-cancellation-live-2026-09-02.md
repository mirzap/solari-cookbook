# Agent D final F5 live cancellation validation — 2026-09-02

## Scope and method

Validated integrated commits `00725bc` and `42e6608` through the production-built product with a fresh temporary SQLite database. One clean Google Chrome 152 profile was launched headless with a dedicated DevTools port and operated through raw Chrome DevTools Protocol commands. No browser test framework, test file, suite, retry, or second evaluation was used.

The single evaluation was configured through the visible product form with:

- public target: `https://www.iana.org/domains`
- task: `Inspect the public Domain Names overview, open Root Zone Management, then open Protocol Registries, and finish without changing anything.`
- visible-text criterion: `Protocol Registries`
- exactly three requested runs
- concurrency one
- the sole product-exposed model

The deterministic admission classifier returned `admitted_read_only_task` before the live submission.

## Timeline and product flow

All timestamps are UTC.

- `11:05:32.238`: clicked the visible `Measure reliability` control once.
- `11:05:32.369`: browser-observed evaluation POST response, HTTP 202.
- `11:05:32.364`: evaluation durable `startedAt`.
- `11:05:32.371`: run 1 durable `startedAt`.
- `11:05:33.756`: the run 1 Solari session was durably acknowledged.
- `11:05:50.026`: initiated a hard reload of the evaluation page.
- `11:06:01.807`: hydrated UI showed authoritative `RUNNING`, run states `WORKING / WAITING / WAITING`, progress `0/3`, semantic UI `USED`, `LIVE UPDATES`, no warnings, and an enabled `Cancel evaluation` control.
- `11:06:11.287`: clicked `Cancel evaluation` exactly once.
- `11:06:11.331`: the post-admission active-run transition from `running_agent` to `releasing_browser` was committed.
- `11:06:11.332`: browser-observed cancellation response, HTTP 202.
- `11:06:12.107`: provider release status was committed.
- `11:06:12.112`: active run cancellation was committed.
- `11:06:12.115` and `11:06:12.117`: the two never-dispatched run cancellations were committed.
- `11:06:12.125`: evaluation cancellation was committed last.

The D runtime contract awaits A's durable `running → cancelling` admission before it delivers the queue abort. The persisted post-abort release transition at `11:06:11.331` therefore also precedes the HTTP 202 response at `11:06:11.332`. Terminal evaluation cancellation followed all three durable run cancellations.

## Terminal UI and projection reconciliation

The hydrated terminal product showed:

- evaluation `CANCELLED`
- all three runs `CANCELLED`
- progress `3/3`
- reliable outcomes `0/3`
- inconclusive `0`
- reliability `0%`
- `LIVE UPDATES`
- no cancellation control after terminalization
- each report row: `Cancelled before fresh, independent verification completed.`
- active-run time `39.7s`; never-dispatched run times `—`
- six bounded assertion-blind trace items, all belonging to the active run

Snapshot and report agreed:

- requested 3
- started 3 under the frozen contract meaning every terminal run transitioned out of `queued`
- passed 0, failed 0, inconclusive 0, cancelled 3, nonterminal 0
- potential leaks 0
- end-to-end rate `0/3`
- gradeable observable-state denominator 0 and value null

Only run 1 has a non-null `startedAt`. Runs 2 and 3 have null `startedAt`, zero iterations, zero tool calls, zero browser actions, null token usage, null outcome/failure/grade, release status `not_started`, and no provider attempt, browser session, model event, evidence row, grade row, or run step. The shared aggregate's `started` counter is intentionally transition-based and does not claim that these two runs were dispatched.

Run 1 alone has:

- one provider-create attempt
- one acknowledged browser session
- confirmed `released` status
- terminal `cancelled`, null outcome/failure/grade
- two model iterations, one completed semantic invocation, one browser action
- no assertion evidence and no grade
- potential-session-leak false

Report and trace interface projections agreed: semantic UI discovered/admitted/invoked/succeeded/failed `1/1/1/1/0`; every other interface had zero usage. Event cursors were contiguous from 1 through 23 and terminal ordering was active release, three run cancellations, then evaluation cancellation.

## Database counts and cleanup

Final fresh-DB counts:

- evaluations: 1
- runs: 3
- events: 23
- provider-create attempts: 1
- browser sessions: 1
- assertion evidence: 0
- grade results: 0
- nonterminal evaluations: 0
- nonterminal runs: 0
- unreleased sessions: 0
- runs marked with a potential leak: 0

Run-step counts were 15 / 0 / 0 by configured run index. Chrome and production-server listener counts were both zero after shutdown.

## Mechanical redaction inspection

The final snapshot, report, trace, paginated event JSON, and SSE ready frame were written only under the temporary validation directory and scanned without printing sensitive values. Every surface had:

- zero exact matches for the persisted provider session identifier
- zero exact matches for configured OpenRouter or Solari credentials
- no provider-session, credential, authorization, API-key, CDP, WebSocket debugger, replay URL/token, raw DOM, outer HTML, or document HTML keys
- no `ws://` or `wss://` endpoint
- no HTML document or doctype payload

Maximum string lengths were 137 characters in snapshot/report and 102 characters in trace/events. The terminal SSE sample was a 52-byte bounded ready frame; the browser had already demonstrated live SSE recovery after the running-state hard reload.

## D-owned defect found and corrected

Never-dispatched cancelled runs carried a duration measured from queue creation under the frozen run contract. The product UI previously displayed that duration as if those runs had executed. The D-owned UI now renders time as `—` whenever `startedAt` is null. No A-owned run or aggregate semantics were changed.

## Production verification

Commands ran from `examples/tracegate` with Node 26.1.0 / pnpm 12.0.0 available on `PATH`:

```bash
pnpm --filter @tracegate/web typecheck
pnpm --filter @tracegate/web build
DATABASE_URL=file:<fresh-temp>/f5.db pnpm db:migrate
DATABASE_URL=file:<fresh-temp>/f5.db TRACEGATE_PORT=4319 NODE_ENV=production pnpm start
pnpm --filter @tracegate/db typecheck
pnpm --filter @tracegate/db build
pnpm --filter @tracegate/web typecheck
pnpm --filter @tracegate/web build
```

All typechecks, builds, migration, and production starts passed. No automated tests or additional provider sessions were run.

## Decision

**F5 closes for the scoped live cancellation gate.** HTTP 202 followed durable cancellation admission; authoritative running-state reload/SSE recovery worked; active cleanup was provider-confirmed; queued runs were terminalized without dispatch artifacts; cancellation produced no evidence or grades; terminal ordering, aggregates, UI, API projections, trace, and database records reconciled; and no leak or nonterminal row remained.
