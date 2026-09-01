# TraceGate PoC Plan — Focused Critique

**Reviewed:** `docs/plans/tracegate-poc-build-2026-09-01.md` (the plan)
**Baseline:** generated plan response inside `prompt-exports/oracle-plan-2026-09-01-090032-tracegate-poc-plan-9-a919.md` (the export), sections `# 1`–`# 10` only
**Date:** 2026-09-01

## Scope and stance

The plan departs from the export on four points that the user's brief makes authoritative, and those departures are **correct and not re-litigated here**: TanStack Start in `apps/web` (export: Fastify + Vite SPA), the Classic Tee / size M store scenario (export: `support-ticket-triage-v1`), Drizzle/libSQL (export: raw SQL migrations + `better-sqlite3`-shaped SQLite), and the brief's nine-package boundary (export: five packages). Where those substitutions created new seams the export never had to answer, that is called out below as a gap, not as a reason to revert.

Everything else in the export is treated as a baseline of implementation-bearing detail the plan should have carried forward.

Severity: **B** = blocks correct implementation or produces wrong reported numbers; **H** = will cause a lane-blocking rework or an unsafe default; **M** = will cause avoidable churn or an ambiguous hand-off.

---

## 1. Implementation-bearing content lost, weakened, or generalized

### 1.1 (B) The legal-transition tables were replaced by arrow chains, and the result makes startup recovery illegal

Export `§3.5` gives explicit per-state legal transition lists for both machines, including three non-obvious edges:

```text
queued            → completed        # startup-interruption terminalization
grading           → completed        # only if no lease was ever acquired
releasing_browser → completed | cancelled
```

Plan `§6.1`/`§6.2` replaces these with a linear chain plus two prose sentences ("Any nonterminal state may enter `releasing_browser` when a session may exist"). Consequences:

- Plan `§6.4` requires startup recovery to "terminalize interrupted runs as inconclusive `infrastructure/process_interrupted`". Under the plan's chain, a `queued` run's only exits are `acquiring_browser` and `cancelled`. **The recovery path the plan mandates has no legal transition.** Same for a run interrupted in `discovering`, a state the plan added and the export did not have.
- `TG-007`'s deliverable is `packages/evaluation/src/transitions.ts`, a compare-and-set legality table. Agent A now has to re-derive that table from prose, and Agent D's `compareAndSetStatus` repository has no authoritative list to validate against.

**Correction:** restore an explicit `from → {to}` table for both machines, extended with the plan's `discovering` state and an explicit `* → completed` recovery edge flagged as reachable only from the recovery path (not from normal execution), so illegal-transition tests can assert on it.

### 1.2 (B) The failure-condition → outcome → category/code table was dropped; the plan's categories carry no outcome semantics

Export `§3.5` maps nine concrete conditions to `(outcome, category/code)` — e.g. blocked cross-origin navigation → `failed / policy_budget.navigation_blocked`; demo repeatable 5xx → `inconclusive / target_app.unavailable`; provider protocol error → `inconclusive / model_provider.provider_protocol_error`.

Plan `§6.3` lists twelve bare category names and never maps any of them to `passed | failed | inconclusive`. It also renames the taxonomy (adds `navigation`, `ambiguity`, `tool_error`, `timeout`, `incorrect_state`, `unsupported_interface`; drops `target_app` and `policy_budget`) without re-deriving the mapping. The new names are *outcome-ambiguous in exactly the cases that matter*:

- `navigation` — a policy-blocked off-origin navigation is `failed` (agent's fault); a navigation that fails because the tunnel dropped is `inconclusive`.
- `timeout` — wall-clock exhaustion is `failed`; a Solari CDP connect timeout is `inconclusive`.
- `tool_error` — a stale-ref error is recoverable and neither; an exhausted retry is `failed`.

This is the single most load-bearing table in the document, because it decides what lands in the numerator and denominator of the reliability figure the whole PoC exists to produce. Losing it hands three lanes independent authority to guess.

**Correction:** restore the export's table verbatim, re-keyed onto the plan's twelve categories, and add the plan-specific rows the export lacked: demo challenge provisioning failure, `stale_element` retry exhaustion, WebMCP schema drift, and grader revision-mismatch. Add an invariant test: every `(category, code)` pair has exactly one permitted outcome.

### 1.3 (H) Repository port method signatures were reduced to bare type names

Export `§3.4` freezes method-level semantics:

```text
compareAndSetStatus(expected, next, patch)
listRecoverable...
transactionallyFinalize...
EventRepository.append / listAfter / earliestCursor / latestCursor
```

Plan `§5.3` lists only `EvaluationRepository / RunRepository / EventRepository`. These are frozen at `TG-006` by Agent A and implemented at `TG-010` by Agent D, then consumed by Agent A's orchestrator — the highest-contention seam in the whole build. `earliestCursor` in particular is the only way `§8.3`'s "verify the cursor is retained before sending SSE headers" step can be implemented, and it no longer appears anywhere in the plan.

**Correction:** restore the method list into `§5.3`; it costs eight lines and removes a Wave-1 integration stall.

### 1.4 (H) Message-delta persistence lost both its threshold and its event type

Export `§3.6`: "Buffer by run; persist `run.agent_message` every 250 ms or 2 KiB, whichever occurs first."

Plan `§6.6`: "keep ephemeral; persist only a bounded final/periodic summary, never every token." But the plan's closed P0 event vocabulary (`§6.5`) contains **no event type for that summary** — it has `run.agent.iteration`, which is a turn marker, not a message. So the mapper is required to emit something the event schema cannot represent, and the live UI (`§10`: "current safe action summary") has no source.

**Correction:** add `run.agent.message` to the closed set and restore the 250 ms / 2 KiB flush rule (or state a replacement). Without a number here, Agent C picks one and Agent D's SSE backpressure bounds (`§8.3`: 256 events / 1 MiB) are untunable.

### 1.5 (H) Table constraints and indexes were dropped, removing enforcement of the plan's own duplicate-run invariant

Export `§3.12` specifies `runs` unique `(evaluation_id, model_id, repetition_index)`, `browser_sessions.run_id UNIQUE`, and indexes on `(evaluation_id, cursor)` and `(run_id, run_sequence)`. Plan `§8.1` lists tables as prose field summaries with no constraints or indexes at all.

Plan `§7.1` states "Never create a duplicate run row" as an invariant of the 429 requeue path, and `§16` tests for "no duplicate run IDs" — but with no unique constraint, that invariant is enforced only by application code under concurrent retry, which is precisely where it will fail.

**Correction:** restore the constraint/index list into `§8.1`, re-keyed for the plan's single-model config: `runs` unique on `(evaluation_id, run_index)`, `events` indexed on `(evaluation_id, cursor)` and `(run_id, run_sequence)`, `discovered_interfaces` indexed on `run_id`. See §2.9 and §4.4 for why `browser_sessions.run_id UNIQUE` should *not* be restored as-is.

### 1.6–1.12 (M) Smaller losses, with corrections

| # | Lost from export | Where the plan weakened it | Correction |
|---|---|---|---|
| 1.6 | "Repository writes are serialized through a single writer queue; reads use short-lived connections" (`§3.12`) | Plan `§8.1` keeps only WAL + busy timeout; single-writer appears only in the `§17` risk table | Move the single-writer-queue requirement into `§8.1` where Agent D implements `packages/db/src/client.ts`; with 3 concurrent runs each appending events, `SQLITE_BUSY` under libSQL is the default outcome otherwise |
| 1.7 | Two queue rules: capacity "never automatically increases during the same process after a limit error", and rotation among evaluations after each dispatch (`§3.7`) | Plan `§7.1` says "one process-global fair FIFO queue" and describes only downward degradation | Restore both. Also note "fair FIFO" and per-evaluation rotation are different policies; name one. For a PoC with one evaluation at a time, plain FIFO plus the ratchet is sufficient — say so explicitly rather than implying starvation handling that isn't built |
| 1.8 | `410 CursorExpired` returns snapshot URL + earliest available cursor (`§3.12`) | Plan `§8.3` mentions the status code only | Restore the response body; it is what makes the client's recovery deterministic instead of a blind refetch |
| 1.9 | "Dropped process notifications are harmless because reconnect **and periodic catch-up query** persisted events" (`§3.13`) | Plan `§8.3` keeps the heartbeat but not the catch-up | Make the 15 s heartbeat also perform a `latestCursor` comparison and drain. Without it, one dropped in-process notification silently stalls a live client until it happens to reconnect — an invisible failure during the demo video |
| 1.10 | Compatibility probe must exercise "parallel-tool behavior if exposed" (`§3.9`) | Plan `§7.4` probe list omits parallel tool calls | Restore, and see §4 — neither document ever forbids parallel tool calls, which is unsafe against a revision-locked `ElementRegistry` |
| 1.11 | "TypeScript 7 only if the compatibility suite passes" (`§3.1`) | Plan `§2`/`TG-001` says only "verify versions"; the named fallback disappeared | Restore the conditional and name the fallback version. TS 7 is the native port; `drizzle-kit`, the TanStack Start Vite plugin, and typed-lint rules are the likely breakages, and `TG-001` is an S-sized task with no stated escape hatch |
| 1.12 | "Persisted global integer cursor exposed as a decimal string through SSE `id`" (`§3.1`) | Plan states cursor-as-decimal-string and "UI deduplicates by `eventId`" but never says which value goes in the SSE `id:` field | State it. An implementer who puts `eventId` in `id:` breaks `Last-Event-ID` resumption while all the plan's other rules still appear satisfied |

---

## 2. Under-specified seams, unresolved decisions, contradictions, incorrect references

### 2.1 (H) Two graders and two failure analyzers across two ownership lanes — and one of them contradicts the core thesis

Plan `§15` file table:

- `packages/ai/src/{...,grader,failure-analyzer}.ts` — owned by Agent C
- `packages/grading/src/{demo-grader,failure-classifier,ai-fallback}.ts` — owned by Agent A

`packages/ai/src/grader.ts` is an incorrect reference: nothing in `§7.7` gives `ai` any grading role, and `§14` explicitly rejects model self-grading. `packages/grading/src/ai-fallback.ts` is worse — "AI fallback" for grading directly contradicts `§7.7` ("The model's summary is ignored", "P1 failure analysis … cannot modify the deterministic result") and `§11`'s never-cut list.

**Correction:** delete `packages/ai/src/grader.ts`; rename `packages/grading/src/ai-fallback.ts` to `explanation.ts` and state in one line that it consumes `FailureAnalyzer` output for display only and can never write `runs.outcome` or `grade_results.outcome`. Keep the `FailureAnalyzer` port in `ai` (it is a model call) and its policy wrapper in `grading`.

### 2.2 (H) The central redactor is a never-cut P0 control with no owner, no package, and no file

`§9.1` requires a "central redactor" used before persistence, logging, and SSE. It is consumed by `db` (payload writes), `ai` (event mapper), `solari` (session metadata), `evaluation` (failure records), and `apps/web` (SSE + logs). `§15` assigns it no file in any package. `§4.2` says `shared` depends only on Zod and platform types, and lists `shared`'s files as `{ids,config,states,events,api,ports}.ts` — no redactor.

Five consumers across four ownership lanes with no owner means four redactors, each with a different pattern list, and the `§16` redaction tests ("seeded with recognizable fake keys, CDP URLs, challenge tokens, replay URLs") can only cover whichever one the test author imported.

**Correction:** add `packages/shared/src/redaction.ts` (pure, Zod-adjacent, no I/O), owned by Agent A, frozen at `TG-006`, with the pattern registry as data. Require every event/payload write path to call it at the repository boundary so it cannot be bypassed. The same gap applies to the env/config schema: `apps/web/src/server/config.ts` (Agent D) validates the demo admin secret that Agent A's `packages/grading` consumes, while `.env.example` is Agent A's — name `shared` as the owner of the env schema too.

### 2.3 (H) `TG-002` cannot be done before `TG-006` as written — it requires most of `TG-008`

`TG-002` **Done when:** "One connectivity provider is selected, **real page/cart mutation works**, cleanup evidence and measured limits exist". Cart mutation requires the Classic Tee page, size selector, cart state, and challenge routing — that is `TG-008`, which depends on `TG-006`, which depends on `TG-002`. The plan contradicts itself internally: Wave 0 text says B spikes "against a **minimal** real Demo Store page".

**Correction:** rewrite `TG-002`'s Done-when to the minimum that actually gates the architecture: HTTPS reachability from a real Solari browser, one server-rendered form POST that mutates server state, one server-to-server admin read of that state, plus measured create/connect/release/concurrency/recording behavior. Name the artifact (e.g. `apps/demo/src/routes/__connectivity.tsx`) as a throwaway fixture that `TG-008` replaces. Same fix belongs in the export, which has the identical flaw.

### 2.4 (H) `callNativeTool` is inside the frozen P0 tool schema while WebMCP is P1, and nothing maps `interfaceMode` to the gate states

`§7.4` lists `callNativeTool` among the tools the model may call. `§11` puts WebMCP detection/invocation in P1. The tool set is a Zod contract frozen at `TG-006` and baked into the system prompt; adding or removing a tool at P1 changes the model's contract mid-build and invalidates Agent C's Wave-1 probe evidence.

Separately, `§5.2` defines `interfaceMode: "auto" | "semantic-only" | "native-allowed"` and `§7.6` defines gate states `unavailable | available_disabled | discover_only | allowlisted_demo_tools`. **No mapping between them is given**, and no owner is named for computing the gate (capabilities endpoint at startup? per-run probe in `discovery`? config validation in `evaluation`?). Manual acceptance item 10 ("Disable WebMCP; confirm the semantic path still completes") is unimplementable until this is decided.

**Correction:** freeze `callNativeTool` in the P0 schema but have it return a structured `unsupported_interface` tool error whenever the gate is not `allowlisted_demo_tools` — the tool surface then never changes between P0 and P1. Add a three-row table mapping `interfaceMode` → permitted gate states, and name `packages/discovery` as the gate's owner with `apps/web/api/capabilities` as its only publisher.

### 2.5 (M) The task seed is assigned but stored nowhere and consumed by nothing

`§7.1` step 4 assigns each run a "task seed". `§7.7`'s demo state contains "cart, mutation revision, run ID, creation/expiry timestamps, and scenario ID" — no seed. No other section reads it. It is a vestige of the export's `support-ticket-triage-v1` fixture generation, where the seed derived ticket/category/priority/note values.

**Correction:** either delete the seed, or define exactly what it varies in the fixed Classic Tee scenario (product ordering, distractor labels, DOM structure variant) and store it in demo state so the trace is reproducible. This is not cosmetic — see Q3/Q4 in §5: if all three runs get an identical store, the *only* source of run-to-run variance is model sampling, which the plan never configures.

### 2.6 (H) The grading path and the browser path share one origin, so tunnel flakiness manufactures `inconclusive` results

`§7.7`: "The grader calls a protected **same-origin** admin endpoint server-to-server." Both the grader and the demo run on the reviewer's machine; the public HTTPS origin exists solely so the *remote browser* can reach the demo. Routing grading through the tunnel means every tunnel hiccup during the final grade becomes `inconclusive` — the outcome class specifically designed to mean "TraceGate's fault", polluting the honest report with TraceGate's own connectivity noise.

There is also a security consequence neither document notes: in Sandbox-fallback mode the demo runs remotely, so `/admin/*` is internet-reachable, **and it sits inside the exact origin the agent is allowed to navigate to** (`§9.1` allowlists the demo origin). Bearer-secret gating is stated; browser-reachability of the grading evidence is not analyzed.

**Correction:** split `DemoConnectivityProvider` into `publicBaseUrl` (browser, allowlisted for the agent) and `adminBaseUrl` (grader; loopback whenever the demo is local). Require `/admin/*` to reject any request carrying `Origin`, `Referer`, or `Sec-Fetch-Mode: navigate`, and to 404 (not 401) without the bearer, so a navigating agent learns nothing. Add a manual acceptance step: navigate the agent to `{publicBaseUrl}/admin/...` and confirm it cannot read or mutate grading evidence.

### 2.7 (H) Nothing provisions the demo-side challenge state

`§7.1` step 4 assigns an "opaque demo challenge token hash" in the control plane. `§7.7` says demo state contains `runId`. But no step, route, or port creates that state on the demo side. Two silently different designs are compatible with the text:

- control plane calls `POST {adminBaseUrl}/admin/challenges {token, runId, scenarioId, expiresAt}` before navigation — needs a new admin route, a shared Zod schema, a failure classification (`target_app` / `inconclusive`), and a place in the run lifecycle (`§7.2`); or
- the demo lazily creates state on first `GET /runs/{token}` — in which case the demo cannot know `runId`, the challenge is creatable by anyone who guesses a token, and grading cannot validate the run binding `§7.7` requires.

**Correction:** specify explicit provisioning, add it to the `§7.2` lifecycle between `connecting_browser` and `navigate`, add its failure row to `§13`, and add challenge teardown/expiry sweeping (see §4.7).

### 2.8 (M) `TG-017` collapses four independently-ownable verification items into one multi-owner item

The export splits verification into `TG-017`–`TG-020`, one per lane, each with its own Done-when and key files. The plan folds them into a single `TG-017` "Four-lane verification wave" owned by everyone. That breaks the plan's own discipline — stable IDs referenced by dependencies, exclusive ownership, and independent sign-off — at the exact point where four agents are working simultaneously and `TG-018` gates on "each lane's evidence passes".

**Correction:** restore four IDs (`TG-017a..d` or renumber) with per-lane Done-when and evidence files, matching `docs/evidence/*-verification.md`, which `§15` already implies exists per lane.

### 2.9 (M) Run identity is still keyed on the export's model matrix

`§7.1` step 4 assigns "stable run index, **model, repetition**"; `§8.1`'s `runs` table carries "evaluation/**model/repetition**". Under the plan's `EvaluationConfigV1` there is a single `modelId` and a flat `requestedRuns` count, so `model` is constant across an evaluation and `repetition` is identical to `run index`. Three names for one concept will produce three different orderings in the report and the live grid.

**Correction:** `runs` carries `run_index` (unique with `evaluation_id`) and `model_id` (denormalized, for P1/P2). Drop `repetition`.

### 2.10 (H) `maxBrowserActions` is dead configuration, and the turn/tool-call ratio is under one

`§5.2` defaults: `maxModelTurns 15`, `maxToolCalls 25`, `maxBrowserActions 25`. `§7.4` says every tool call increments the tool-call count (step 1) and *mutating* calls additionally increment the browser-action count (step 5). Browser actions are therefore a strict subset of tool calls, so with both capped at 25 the action budget can never bind — it is unreachable configuration that will still appear in the UI as a live gauge (`§10`: "step/tool count against budget").

The turn budget is also inconsistent: 15 model turns against 25 tool calls allows fewer than two tool calls per turn, while the minimum viable Classic Tee path (navigate → inspect → click product → inspect → select M → inspect → add → inspect → finish) is already ~9 calls with zero recovery headroom.

**Correction:** restore the export's `maxToolCalls: 40` (and consider `maxModelTurns: 12`), keeping `maxBrowserActions: 25` so it is genuinely the tighter constraint on mutation. See §3.1 for the wall-clock default.

### 2.11 (M) The tool-invocation wrapper spans three packages and belongs to none

`§7.4` assigns tool *definitions* to `packages/ai` and "action policy, budgets, loop completion" to `packages/agent`, while execution lands in `packages/solari`'s `BrowserController`. The eight-step per-call sequence in `§7.4` (count → validate → cancel/deadline → origin policy → action count → timeout → bounded result → emit milestones) is a single wrapper, and the plan never says which package holds it. Agent C owns both `ai` and `agent`, so this will get resolved — but `§15` lists `packages/agent/src/policy.ts` *and* `packages/ai/src/tools.ts` with overlapping responsibility, and `§16`'s "URL-policy matrix" tests need one address.

**Correction:** one line in `§7.4`: `packages/agent` owns the executor that wraps a `BrowserController`; `packages/ai` only adapts that executor into `toolDefinition(...).server(...)` and owns nothing about policy or budgets.

---

## 3. Corrections — content the brief/task disproves, does not require, or a simpler design replaces

### 3.1 (H) Restore the 120 s wall-clock default; 90 s converts orchestration latency into false `failed` outcomes

The plan lowered `wallClockMs` from the export's 120 000 to 90 000 while `§6.2` classifies budget exhaustion as **`failed`** — "trusted evidence proves the goal was not achieved". Under this PoC's actual latency profile — OpenRouter streaming turns (seconds each) plus every browser action crossing CDP to a remote Solari browser plus a tunnel hop to the demo — 15 turns will routinely exceed 90 s for reasons that have nothing to do with the website under test.

That is not a tuning nit: it means the headline "end-to-end reliability" number measures TraceGate's own round-trip latency and reports it as a site failure, which `§11`'s never-cut list ("honest capability/outcome reporting") forbids.

**Correction:** default `wallClockMs: 120_000`, and add a rule to `§6.3`: budget exhaustion is `failed` only if at least one successful browser mutation occurred within the run; a run that exhausts wall-clock without completing a single action is `inconclusive / infrastructure.latency`. Record measured per-turn and per-action latency in the `TG-002`/`TG-003` evidence and re-tune the default at `TG-011` from real numbers, as `§5.2` already promises ("safety defaults to tune with evidence").

### 3.2 (M-H) `apps/demo` should not be TanStack Start

`§4.3` says "`apps/demo` may also use TanStack Start for consistency". The brief mandates TanStack Start for `apps/web`; nothing requires it for the target. The demo's requirements are: server-rendered semantic HTML with associated labels, three product pages, a form POST, server-held cart state, JSON-LD, `/llms.txt`, a gated `webmcp.ts` script, and an admin JSON endpoint. It has **no client-side routing, no client state, and no reason to ship a React bundle** — and `§7.6`'s WebMCP probing plus `§16`'s prompt-injection acceptance test are easier to reason about on a page with no framework hydration.

It must also be packaged into a Solari Sandbox in the fallback connectivity path (`§7.3` step 5), where a full TanStack Start build is meaningful extra weight and extra failure surface on the one path that is already the P0 blocker.

**Correction:** implement `apps/demo` as a single Node HTTP or Hono server rendering plain HTML (the export made the same call for a different reason — "separate application so only the target needs public exposure"). This also removes the risk that a TanStack Start client bundle in `apps/demo` accidentally makes the store *less* semantic than the thesis requires.

### 3.3 (H) A publicly deployed `apps/demo` replaces the tunnel/Sandbox spike as the P0 connectivity path

`§7.3` makes remote-browser-to-demo connectivity a blocking spike with two unproven options, and `§17` lists "Solari cannot reach demo" as a P0 blocker with "none" as the allowed degradation. Meanwhile `§3` records the user decision as "optimize for reliable **local judging**, not a public serverless deployment" — that decision is about the **control plane**, which holds the DB, the provider keys, and the Solari credentials. `§4.3` already states that only `apps/demo` is exposed publicly, and `§7.7` says the demo holds no secret the browser may see.

Deploying `apps/demo` to any free HTTPS host makes the target origin stable, removes open questions 1 and 2 from the critical path, turns `TG-002` from a blocking feasibility spike into a Solari-only entitlement measurement, and makes the README's "deployed/local URL" claim actually reproducible by a reviewer weeks later — a tunnel URL is dead the moment the build machine sleeps.

**Correction:** make "deploy `apps/demo` to a stable HTTPS origin" the primary connectivity path, tunnel the fallback, Sandbox the third option; keep the `DemoConnectivityProvider` abstraction unchanged. Note the coupling to §2.6: with a remote demo, the grader's `adminBaseUrl` is public and the bearer secret becomes an internet-exposed credential, so the admin hardening in §2.6 becomes mandatory rather than optional. If the user rejects public deployment for the demo, that must be recorded as an explicit decision in `§3`, because it is what keeps a P0 blocker on the critical path.

### 3.4 (M) `browser_sessions.run_id UNIQUE` should not be carried over

Restoring the export's `run_id UNIQUE` (see §1.5) would make the retry path in `§7.1` crash: a run whose session creation times out *after* the session was actually created, then retries, needs a second attempt row. See §4.4 for the full failure and the correct shape.

### 3.5 (M) "End-to-end reliability" overstates what three runs measure

`§7.8` names the primary metric "end-to-end reliability"; the export called the same quotient "end-to-end pass rate". The plan then has to spend a sentence walking it back ("Three-run results are labeled descriptive, not statistically significant"). Given `§11` lists honest reporting as never-cut, the label should not need a disclaimer.

**Correction:** rename to "end-to-end pass rate (passed / requested)" in the contract, the UI, and the README. Keep the descriptive-only labelling.

---

## 4. Absent from both documents

### 4.1 (B) Conversation-history growth is unbounded, and there is no observation-compaction rule

Both documents bound a *single* observation (`maxObservationBytes: 12_288`) and neither bounds the accumulated message history that TanStack AI `chat()` resends on every turn. With ~10–25 tool calls per run, each returning up to 12 KiB of observation text, the prompt grows to 100–300 KiB (roughly 30k–80k tokens) by the final turn. Consequences that will surface in `TG-009` and will look like model failure: rising latency per turn (which then trips the wall-clock budget — see §3.1), cost multiplying superlinearly across three runs, and eventual context-window rejection reported as `model_provider`.

**Correction:** specify history compaction in `packages/agent`: retain the latest observation verbatim; replace each superseded observation tool-result with a one-line stub (`"[observation revision 4 superseded; 37 elements]"`); retain tool *calls* and short results in full. Add a `maxHistoryBytes` budget alongside the existing ones, and a test asserting the request payload stays bounded across 15 turns. Relatedly, neither document has any per-evaluation spend ceiling; a `maxTotalTokens` guard belongs next to it.

### 4.2 (H) Model sampling parameters — the actual source of run-to-run variance — are never specified or persisted

The PoC's thesis is "a website working once is not enough; reliability requires repeated, isolated executions". With one model, one scenario, and (per §2.5) an identical store per run, **the only thing that makes run 2 differ from run 1 is model sampling**. Neither document mentions `temperature`, `top_p`, `seed`, or provider routing preferences, and neither persists them with the run.

This is also a truthfulness problem: a reviewer asking "why did run 2 fail?" cannot be answered without knowing the sampling configuration, and `§16` item 12 ("recalculate every displayed value from DB rows") cannot cover a parameter that is not stored.

**Correction:** add a `sampling` block to `EvaluationConfigV1` (temperature with an explicit default, top_p, optional provider routing pin), persist it on `evaluations`, display it on the report, and state in `§7.8` that the reliability figure is conditional on it. Note the interaction with OpenRouter provider routing: the same slug served by two different upstream providers is a second, invisible variance source — `§7.4` already probes "provider routing", so record the resolved provider per run.

### 4.3 (H) The TanStack Start substitution left no process entry point, no shutdown hook, and no singleton discipline

The export had `apps/control/src/server/main.ts` — an explicit process entry that ran migrations, then recovery, then started listening. The plan's `§15` lists `apps/web/src/server/{composition,sse,recovery,config}.ts` with **no entry point**, because TanStack Start owns the server entry. Unaddressed consequences:

- **Where do migrations and startup recovery run?** `§8.1` says migrations are "applied before accepting requests" and `§6.4` requires recovery before scheduling; under TanStack Start there is no user-owned `main()`, so this must be a module-level side effect or an explicit server-entry customization. Which one is a real decision that Agent D must make and Agent A must review.
- **Singleton lifetime.** The queue, the SSE subscriber registry, the in-memory `ElementRegistry`, the abort controllers, and the DB client are all process-global (`§7.1`, `§7.5`, `§8.3`). In dev mode, module re-evaluation on HMR yields two queues and two subscriber registries — runs will appear to hang and events will appear to vanish, with no error. This needs `globalThis` pinning and an explicit statement that judged runs use the built server, not dev.
- **Shutdown.** `§6.4` and `§9` require released sessions and no leaked browsers; nothing installs `SIGINT`/`SIGTERM` handlers to abort in-flight runs and release active Solari sessions with a bounded timeout. Ctrl-C during the demo currently leaks up to three cloud browsers, which `§16` item 13 then correctly refuses to accept.

**Correction:** add `apps/web/src/server/lifecycle.ts` (Agent D) owning: idempotent boot (migrate → recover → mark healthy), `globalThis`-pinned singletons, and signal handlers that drain the queue, abort runs, release leases with an independent timeout, and flush the final events. Add a manual acceptance step for Ctrl-C mid-run alongside the existing kill/restart step.

### 4.4 (H) A session created but never acknowledged has no cleanup path

`§7.2` persists `acquiring_browser`, then creates the Solari session, then validates and persists the session ID. If the create request times out or the connection drops **after** Solari allocated the browser, TraceGate never learns the session ID: nothing to release, nothing in `browser_sessions`, so `§16` item 13 (compare every acquired session to release records) cannot even see the leak, and the retry path in `§7.1` creates a second browser against a possibly-1 concurrency cap.

**Correction:** (a) write an attempt row *before* the create call keyed by a client-generated attempt ID, and mark it `unknown` on ambiguous failure; (b) key `browser_sessions` by attempt with a non-unique `run_id` index (this is why §3.4 rejects `run_id UNIQUE`); (c) add a provider-side sweep at startup and at the end of `TG-016`'s acceptance run — list active sessions where the Solari API permits and reconcile against persisted rows; (d) add a `§13` row: "Ambiguous session creation → record `unknown` attempt, treat as potential leak, do not retry until the sweep confirms no session exists".

### 4.5 (H) The cart predicates admit a passing flail

`§7.7` predicates: contains "Classic Tee", size exactly "M", quantity ≥ 1. An agent that adds Performance Tee, Running Shorts, and three Classic Tee M's satisfies all three and is graded `passed`. The task is "find Classic Tee, choose size M, and add it to the cart" — a cart with two extra products did not perform that task, and the report will claim a success the video will contradict.

**Correction:** add two predicates: cart contains exactly one line item, and quantity equals 1 (or state an explicit, justified tolerance). Store per-predicate results as `§7.7` already requires, so the report shows *which* predicate failed. Add the truth-table rows to `§16`'s grader tests.

### 4.6 (M) No owner for cross-lane test doubles

Wave 1 has Agent A testing the executor with "fake ports", Agent C running "fake and real browser ports", and Agent D rendering from persisted events. All three need a fake `BrowserProvider`/`BrowserController`, a fake `Grader`, and event fixtures. `§12` gives Agent A `tests/e2e` but nothing owns the doubles, so each lane writes its own and they drift apart from the frozen port semantics before `TG-011`.

**Correction:** `packages/shared/src/testing/` (or `packages/shared-testing`), owned by Agent A, frozen with the contracts at `TG-006`: in-memory `BrowserProvider`, scripted `BrowserController`, deterministic clock, and canonical event fixtures. Cheap at `TG-004`, expensive to retrofit at `TG-011`.

### 4.7 (M) Demo-side state has no durability story and no expiry sweep

`§7.7`'s demo state has `expiresAt` and nothing sweeps it. More importantly, its durability is unspecified: if it is an in-memory map (the obvious choice) then a demo restart — Sandbox recycle, tunnel reconnect, dev reload, deploy — mid-run destroys the grading evidence for every active run, producing `inconclusive` for reasons a reviewer will read as TraceGate flakiness. Neither document mentions it.

**Correction:** state the choice explicitly. For a PoC, in-memory plus "demo restart during an active run yields `target_app / evidence_lost` → `inconclusive`" is acceptable *if written down* and covered by a `§13` row; a small SQLite/JSON file is the alternative. Add a periodic expiry sweep and a cap on live challenges so a long session cannot grow the map without bound.

### 4.8 (M) Parallel tool calls are never forbidden, and the element registry cannot survive them

`§7.5` requires actions to target the latest observation revision and forbids fuzzy re-resolution. If the provider emits two tool calls in one turn (OpenRouter models commonly can), TanStack AI may execute them concurrently: both validate against revision *n*, the first mutates the DOM, the second acts on a stale page while still passing the revision check. That is exactly the "acting on the wrong control" failure `§7.5` is designed to prevent, and it will be intermittent and unreproducible.

**Correction:** state that P0 disables parallel tool calls at the adapter (or serializes tool execution through a per-run mutex) and re-observes after every mutating action; add it to the `TG-003` probe (restoring §1.10) and to `§16`'s element-ref tests.

### 4.9 (M) Cancellation of an in-flight provider stream has no defined behavior

`§6.4` requires that "no new model turn or grade begins after cancellation wins", and all ports take `AbortSignal`. Neither document says what happens to the **currently streaming** OpenRouter response if the pinned TanStack AI adapter does not propagate the signal into its underlying fetch — a real possibility for a pre-1.0 package. Without a rule, cancel-during-agent will hang in `running_agent` until the provider finishes, and the browser lease stays held past the user's cancel.

**Correction:** define a bounded abandonment: on cancellation, wait at most *n* seconds for the stream to end, then detach the consumer, mark the run `cancelled`, and proceed to release regardless — with a `run.warning` if the stream was abandoned. Add signal propagation to the `TG-003` probe's explicit checklist (`§7.4` already lists "cancellation"; make the pass criterion "abort observed at the socket, not just at the consumer").

---

## 5. Questions whose answers change the design or the implementation order

| # | Question | What changes based on the answer |
|---|---|---|
| Q1 | Can `apps/demo` be deployed to a stable public HTTPS origin, or must the demo be tunneled from the build machine? | Determines whether `TG-002` stays a P0-blocking feasibility spike on the critical path or shrinks to a Solari entitlement measurement. Also decides whether the README's demo URL survives the submission, and whether the admin bearer becomes internet-exposed (§2.6, §3.3). **Highest ordering impact of any question here.** |
| Q2 | Does `EvaluationConfigV1` freeze `modelId` (singular) or `models[]` at `TG-006`? | P1 is "Model selector plus Mistral/GPT-5 Mini" and P2 is "cross-model reliability matrix". Both need a plural config. Deciding at freeze costs nothing; deciding at `TG-014` breaks a frozen contract, the `runs` unique key, and every report projection. |
| Q3 | What is the task seed for in a fixed single-scenario store — and should the three runs see an identical store? | If identical: the seed is deleted (§2.5) and sampling is the only variance source (§4.2). If varied: the demo needs a deterministic per-seed layout generator, which is real `TG-008` work that is currently in nobody's estimate. |
| Q4 | What sampling configuration are the repeated runs meant to use, and is it part of the honest report? | Determines whether the reliability number is reproducible or a sampling artifact; adds fields to the frozen config and the report (§4.2). |
| Q5 | If the measured Solari cap turns out to be 1, is a sequential three-run evaluation still an acceptable demonstration of the thesis? | Changes the live-UI emphasis (three simultaneous cards vs a queue view), the wall-clock budget (3 × 120 s + overhead ≈ 7 min of video), and whether `§16` item 4's concurrency acceptance is even exercisable. Worth pre-deciding, because the answer arrives at `TG-002` and the UI is `TG-015`. |
| Q6 | Does grading traffic go over loopback or the public origin? | Decides whether tunnel/deployment flakiness can produce `inconclusive` grades, and whether the demo admin secret is a local-only or internet-facing credential (§2.6). |
| Q7 | Are parallel tool calls permitted for the selected model/provider route? | Decides whether `ElementRegistry` needs a per-run execution mutex and whether the adapter must be configured to disable them; must be answered inside `TG-003`, before `TG-009` (§4.8). |
| Q8 | Is `callNativeTool` part of the frozen P0 tool schema? | Decides whether the model-facing contract and system prompt change between P0 and P1, and whether Agent C's Wave-1 probe evidence stays valid (§2.4). |
| Q9 | Must a reviewer be able to re-run the PoC after the build machine is gone? | Governs Q1, the README's setup section, whether `.env.example` needs a "bring your own Solari account" path, and whether `docs/evidence/` is the primary artifact or a supplement. |

---

## Suggested edit list (smallest set that closes the blockers)

1. `§6.1`/`§6.2` — restore explicit legal-transition tables, including the recovery edge (§1.1).
2. `§6.3` — restore the condition → outcome → category/code table over the plan's twelve categories (§1.2).
3. `§5.2` — `wallClockMs: 120_000`, `maxToolCalls: 40`; add `sampling` and `maxHistoryBytes` (§2.10, §3.1, §4.1, §4.2).
4. `§5.3` — restore repository/event port method signatures (§1.3); add `packages/shared/src/redaction.ts` and `src/testing/` (§2.2, §4.6).
5. `§7.2` — insert challenge provisioning and the ambiguous-create attempt row (§2.7, §4.4).
6. `§7.7` — split `publicBaseUrl` / `adminBaseUrl`; add the two missing cart predicates (§2.6, §4.5).
7. `§8.1` — restore constraints and indexes, re-keyed to `(evaluation_id, run_index)`; non-unique `run_id` on session attempts; state the single-writer queue (§1.5, §1.6, §2.9, §3.4).
8. `§15` — delete `packages/ai/src/grader.ts`, rename `grading/ai-fallback.ts`, add `apps/web/src/server/lifecycle.ts` (§2.1, §4.3).
9. `TG-002` — rewrite Done-when to a minimal connectivity fixture (§2.3); `TG-017` — split into four lane-owned items (§2.8).
10. Answer Q1 and Q2 before `TG-006`; they are the only two questions whose answers change frozen contracts.
