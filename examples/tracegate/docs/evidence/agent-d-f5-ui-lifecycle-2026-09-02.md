# Agent D F5 UI/lifecycle manual validation — 2026-09-02

## Scope and method

This was a manual product validation against a fresh temporary SQLite database and the production build/server. A clean Google Chrome 152 profile was launched headless with a dedicated DevTools port and operated through raw Chrome DevTools Protocol commands. No browser test framework, test file, suite, retry, or repeated-run gate was used.

The one accepted evaluation used:

- public target: `https://www.iana.org/help/example-domains`
- task: `Inspect the public page without changing anything and finish after identifying its purpose.`
- visible-text criterion: `Example Domains`
- one run, one verified model option, automatic interface preference

A second browser tab held the same safe form solely to exercise admission while the accepted evaluation occupied capacity.

## Product observations

1. The first visible form submission navigated to the live evaluation page.
2. The hydrated page showed `RUNNING`, run state `PREPARING`, `0/1` progress, `LIVE UPDATES`, no warnings, evidence-derived interface cards, and the new visible `Cancel evaluation` control.
3. While that evaluation was running, the second visible form was submitted. Its resource timing recorded HTTP `409`; the form remained in place and showed the typed product-safe message `TraceGate is at capacity. Try again after an evaluation finishes.`
4. The fresh database contained exactly one evaluation, one run, one browser session, and one provider-create attempt. Therefore the rejected request created no evaluation, run, event, provider-attempt, or browser-session artifact.
5. The capacity response took about 14.6 seconds. During that wait, the accepted run completed before the required reload-and-cancel interaction could be performed. No second evaluation or retry was started.
6. A subsequent hard reload restored the committed terminal snapshot and re-established `LIVE UPDATES`. The page showed `COMPLETED`, `PASSED`, `1/1`, 100% reliability, no warnings, semantic UI `AVAILABLE` with `0` actual uses, and the other displayed interfaces `NOT OBSERVED`.

## Persistence and cleanup reconciliation

Final database state:

- evaluations: 1 `completed`; nonterminal: 0
- runs: 1 `completed` / `passed`; nonterminal: 0
- browser sessions: 1 `released`, release confirmed; unreleased: 0
- provider create attempts: 1
- events: 23, cursors 1 through 23, not truncated
- run steps: 19
- assertion evidence: 1
- grade results: 1
- run projection: `releaseStatus=released`, `potentialSessionLeak=false`, `toolCalls=1`, `browserActions=0`, warnings empty
- snapshot/report aggregates agreed: requested 1, started 1, passed 1, failed 0, inconclusive 0, cancelled 0, nonterminal 0, potential leaks 0
- report and trace interface metrics agreed: semantic UI discovered/admitted `1/1`, invoked/succeeded/failed `0/0/0`; all other channels `0/0/0`

The acknowledged Solari session was released and confirmed before process shutdown. Chrome and server listeners were both stopped.

## Mechanical surface inspection

Snapshot JSON, report JSON, trace JSON, paginated event JSON, and a live SSE sample were written only to the temporary validation directory and scanned without printing sensitive values. Each surface had:

- zero matches for the exact persisted provider session identifier
- zero matches for the configured OpenRouter or Solari credential values
- no provider-session, credential, authorization, API-key, CDP, WebSocket debugger, replay URL/token, raw DOM, outer HTML, or document HTML keys
- no `ws://` or `wss://` endpoint
- no `<html>` or doctype payload

The maximum string length was 415 characters in trace/event projections; snapshot and report maxima were 91 and 94 characters. The 52-byte SSE sample contained only the bounded ready frame.

## Production verification

- `pnpm --filter @tracegate/web typecheck` — PASS
- `pnpm --filter @tracegate/web build` — PASS (client and SSR production bundles)
- `pnpm db:migrate` with the fresh temporary `DATABASE_URL` — PASS
- production `pnpm start` on `127.0.0.1:4317` — PASS
- raw CDP browser session — PASS for visible submission, running hydration, capacity rejection, terminal projection, reload recovery, and cleanup inspection

## Gate result and residual risk

**F5 is not closed.** The manual run did not prove cancellation through the visible UI, terminal cancellation semantics, or running-state snapshot/SSE recovery because the single allowed run completed before those actions. The product cancellation path is implemented and was visibly enabled while running, but a later explicitly authorized one-run manual gate with a sufficiently long-running safe task is still required to validate cancellation end to end.

The cancellation endpoint acknowledges the in-memory abort request before the executor commits the `cancelling` transition. A process failure in that narrow interval could lose the accepted intent; closing this durably requires coordination with the A-owned evaluation transition contract and was not addressed across ownership boundaries.
