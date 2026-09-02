# F4 repeated-run real-provider validation — Talon — 2026-09-02

## Decision

**F4's repeated provider/API/SSE/DB gate passed.** One evaluation requested exactly three concurrent independent runs through the production-built TraceGate API. All three acquired distinct acknowledged Solari sessions, ran the configured DeepSeek model, captured fresh assertion evidence, received deterministic **PASS** grades, and reached provider-confirmed release. Final state contained no leak, unresolved provider attempt/session, or nonterminal run.

The three evidence captures intentionally converged on the same evidence hash. After correction `c8f79c2`, each persisted evidence row and grade row remained bound to its own distinct run ID and agreed with that run's stored evidence hash. This directly validates the formerly blocked identical-evidence attribution case for this execution.

This is one evaluation containing three independent observations, not a general reliability guarantee. Browser-hydrated UI consumption, replay, page/configured MCP, visual fallback, optional models, cancellation, reconnect/restart, and queue saturation were not validated.

## Scope and controls

- External target: `https://www.talon.ba`.
- Task, submitted verbatim: **“Navigate to Pricing, select the Standard plan, and finish on the registration page.”**
- Assertion: expected `https://www.talon.ba/register` plus exactly one occurrence of `planId=12` using `origin_path_and_query_parameter_equals`.
- Model: `deepseek/deepseek-v4-flash-0731`.
- Interface mode: `semantic-only`.
- Requested runs/concurrency: `3/3`.
- Recording: not requested.
- Runtime budgets: 120,000 ms wall clock, 15 model turns, 40 tool calls, 25 browser actions, 15,000 ms tool timeout, 12,288 observation bytes, 96,000 history bytes, and 100,000 tokens per run.
- Fresh database: `/tmp/tracegate-f4-talon-20260902-d754a61.db`; it did not exist before the gate.
- Exactly one evaluation POST was made. No retry, replacement evaluation, provider replay, or additional run was initiated.
- Automated tests were not created, edited, compiled as claimed evidence, or run.
- No B-, C-, or D-owned file was edited.

A production-source scan over `apps`, `packages`, and `scripts` again returned zero matches for `talon`, `talon.ba`, `planId`, or `Standard plan`. The target and assertion were external request data only.

Provider session identifiers and credentials are omitted. Session identity was audited only through counts, uniqueness, non-empty acknowledgement, run foreign-key binding, and release state. No raw provider identifier was copied into durable evidence.

## Production commands

```bash
cd examples/tracegate
test ! -e /tmp/tracegate-f4-talon-20260902-d754a61.db
mise exec -- pnpm build
DATABASE_URL=file:/tmp/tracegate-f4-talon-20260902-d754a61.db mise exec -- pnpm db:migrate
DATABASE_URL=file:/tmp/tracegate-f4-talon-20260902-d754a61.db mise exec -- pnpm db:check
DATABASE_URL=file:/tmp/tracegate-f4-talon-20260902-d754a61.db \
  TRACEGATE_PORT=3106 mise exec -- pnpm start
curl -H 'Accept: application/json' http://127.0.0.1:3106/api/health
curl -H 'Accept: application/json' http://127.0.0.1:3106/api/capabilities
curl -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:3106' \
  --data-binary @/tmp/tracegate-f4-request.json \
  http://127.0.0.1:3106/api/evaluations
curl -N -H 'Accept: text/event-stream' \
  http://127.0.0.1:3106/api/evaluations/<redacted-evaluation-id>/events
```

Results:

- required provider credentials were present, checked without printing their values;
- all 11 production packages built successfully; `@tracegate/e2e` was excluded;
- migration `0000` applied and Drizzle reported `Everything's fine`;
- fresh-DB health was HTTP `200 degraded`, accurately reflecting model/Solari pending before live evidence;
- capabilities were HTTP `200`, database verified, model/Solari pending, and blocker codes empty;
- the only evaluation POST returned HTTP `202` in `0.032215` seconds with three run IDs and queued cursors `1`–`3`.

SSE was attached immediately after the POST exposed the evaluation ID. It emitted a ready frame, two heartbeats, and 79 unique live milestones from cursor `17` through terminal cursor `95`. The authoritative JSON events endpoint returned all 95 contiguous cursors `1`–`95` with no next cursor. The trace endpoint returned 45 projected items with no next cursor. Snapshot polling observed all three runs concurrently in `running_agent`, then independent grading/release completion, and terminal evaluation status after the polling window's final 24.359 seconds.

## Per-run results

All three runs started within `1 ms`, providing direct concurrency evidence. They finished within a `2,498 ms` spread.

| Run index | Outcome | Duration | Iterations | Tool calls | Browser actions | Prompt / completion / total tokens | Warning |
|---:|---|---:|---:|---:|---:|---:|---|
| 0 | PASS | 42,316 ms | 3 | 3 | 2 | 15,070 / 1,171 / 16,241 | `passive_policy_blocked` |
| 1 | PASS | 39,829 ms | 3 | 3 | 2 | 15,088 / 1,119 / 16,207 | `passive_policy_blocked` |
| 2 | PASS | 42,327 ms | 3 | 3 | 2 | 14,996 / 1,075 / 16,071 | `passive_policy_blocked` |

Combined recorded usage was 45,154 prompt, 3,365 completion, and 48,519 total tokens.

Each run dispatched the same safe tool sequence successfully:

| Run | `navigate` | semantic `click` | `finish` |
|---:|---:|---:|---:|
| 0 | 3,955 ms | 9,723 ms | 9 ms |
| 1 | 3,369 ms | 10,437 ms | 43 ms |
| 2 | 3,130 ms | 10,099 ms | 39 ms |

The warning on every run was the preserved non-fatal discovery warning: blocked passive browser activity was observed while trustworthy page evidence remained valid. No run had an authoritative failure record.

Per-run interface usage agreed across snapshot, report, terminal tool evidence, and DB reconstruction:

- semantic UI: discovered `1`, admitted `1`, invoked `1`, succeeded `1`, failed `0`;
- `llms.txt`: discovered `1`, admitted/invoked `0`;
- JSON-LD: discovered `1`, admitted/invoked `0`;
- page WebMCP, configured MCP, and visual fallback: all zero.

The report aggregate therefore recorded semantic UI discovered/admitted/invoked/succeeded `3/3/3/3`, `failed=0`; it did not claim use of the unsupported channels.

## Evidence/grade attribution after `c8f79c2`

The final database contained:

- three run rows with three distinct run IDs;
- three assertion-evidence rows with three distinct evidence `run_id` values;
- three grade rows with three distinct grade `run_id` values;
- exactly **one distinct evidence hash** across all three evidence and grade rows.

For run indexes 0, 1, and 2 independently:

- `assertion_evidence.run_id = runs.id` was true;
- `grade_results.run_id = runs.id` was true;
- run, evidence, and grade evidence hashes agreed;
- capture attempts were `2`;
- unverifiable count was `0`;
- redacted final URL was `https://www.talon.ba/register`;
- evidence assertion status was `observed`;
- grade outcome/assertion were `passed/passed`;
- the grade stated: “Final URL origin/path matched; query parameter planId was present once and its value matched.”

Each run also had 31 events with a complete distinct run-sequence set `0`–`30`. There was no cross-run overwrite, missing grade, evidence consumption by the wrong run, or projection mismatch. The identical-hash runtime blocker corrected by `c8f79c2` is resolved for this real concurrent execution.

## Sessions, aggregates, and cleanup

- `run.browser.ready`: 3 events.
- Browser session rows: `3`; distinct provider session identifiers: `3`.
- Every session identifier was non-empty and bound to its corresponding run.
- Provider-create attempts: one per run; all `released`, leak flag `0`.
- Browser releases: `3/3 released`, `release_confirmed=1`, release timestamp present.
- Replay status: `not_requested`; recording requested: `0`.
- Post-run capabilities: DeepSeek verified from persisted live model usage; Solari verified from live session acquisition.

Authoritative snapshot/report/evaluation-completed aggregates agreed:

- requested `3`, started `3`;
- passed `3`, failed `0`, inconclusive `0`, cancelled `0`, nonterminal `0`;
- potential leaks `0`;
- end-to-end pass rate `3/3 = 1`;
- gradeable observable-state success `3/3 = 1`.

Final durable cardinality was one evaluation, three runs, three browser sessions, three evidence rows, three grade rows, 95 events, and 87 run steps. Event/run-step scans found zero API-key, bearer-token, WebSocket/CDP URL, or provider-session-ID markers.

The foreground production server was stopped once with Ctrl-C. The pnpm wrapper returned interruption exit `1`; a loopback probe confirmed no listener remained. Final DB queries returned:

- unresolved browser sessions: `0`;
- unresolved provider attempts: `0`;
- potential-leak runs: `0`;
- nonterminal runs: `0`.

## Gate conclusion and residual scope

**The explicitly authorized F4 repeated provider/API/SSE/DB gate passed 3/3.** Independent concurrent session acquisition, per-run continuation, deterministic grading, aggregate denominators, identical-evidence run attribution, and confirmed cleanup are verified for this evaluation.

This evidence does not close the previously unobserved browser-hydrated live UI projection criterion, nor does it validate replay, page WebMCP, configured MCP, visual fallback, optional models, cancellation, reconnect/restart recovery, queue saturation, provider-grade egress enforcement, or perfect DNS-rebinding prevention. Those remain separate gates or documented limitations.
