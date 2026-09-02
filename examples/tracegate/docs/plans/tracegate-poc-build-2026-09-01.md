# TraceGate functional-app implementation plan

**Source of truth:** 2026-09-01
**Product boundary:** local functional proof of concept
**Current status:** the scoped functional P0 plan is complete through F3, F4, and F5; all lane commits are integrated, F3 includes provider/API/DB plus live-UI observation, F4 passed `3/3`, and F5 closed durable cancellation, running reload/SSE recovery, queue rejection, redaction, truthful terminalization, and confirmed cleanup; configured MCP passed only its documented loopback/stub manual boundary, while page WebMCP invocation remains externally unavailable/unverified because Solari did not expose `document.modelContext` and semantic fallback/fresh-evidence authority passed instead

## 1. Product outcome

TraceGate tells developers whether their app or public site is ready for the agent era: **can agents use it reliably?** It repeats outcome-oriented tasks in independent sessions, verifies fresh browser-observable results deterministically, explains failure paths, and measures which interfaces agents discover and use.

The concise canonical product reference is `docs/product/tracegate-product.md`.

A developer supplies:

- one public HTTPS start URL;
- one bounded natural-language prompt;
- one to twenty deterministic browser-observable assertions;
- model, run-count, concurrency, and recording options within configured bounds;
- an interface strategy plus optional page WebMCP and explicitly configured unauthenticated MCP endpoints.

Supported assertions are:

- final URL equality or origin/path equality;
- visible document text or title checks;
- accessibility-semantic role/name/count checks;
- checked, selected, expanded, disabled, or bounded non-sensitive value state.

TraceGate is designed to run isolated Solari Browser sessions through the DeepSeek/OpenRouter path. The implemented agent surfaces are semantic/accessibility UI, page WebMCP, and developer-configured MCP through bounded untrusted adapters. `llms.txt` and JSON-LD are discovery-only readiness signals in this POC; they are not provided to the agent. Visual fallback is not implemented as a functional agent path. TraceGate captures fresh browser evidence after action execution stops, grades deterministically, persists local results, streams live state, explains divergence, and reports interface usage and repeatability. Bounded real-provider validation completed for F3 and F4; broader site/task coverage, optional models, visual fallback, replay, and live page-WebMCP invocation remain unsupported, deferred, or externally unverified.

A **PASS** means only that every declared browser-observable assertion was true in the accepted fresh capture. It is not proof of arbitrary backend state, durable external effects, identity, authorization, payment, publication, or business truth.

## 2. Functional definition of done

The app is functionally complete when:

1. The local configure UI accepts URL, exact origins, task, assertions, model, runs, concurrency, interface strategy, and optional unauthenticated MCP endpoints/tool allowlists.
2. A valid evaluation atomically creates its evaluation row, run rows, and queued milestones.
3. Real Solari sessions execute through a fresh controller per run.
4. `deepseek/deepseek-v4-flash-0731` runs through the pinned TanStack/OpenRouter adapter.
5. The model receives the assertion-free V2 execution DTO and only dynamically admitted tools. Page WebMCP and configured MCP appear only through separate bounded read-only adapters; raw descriptors and results remain untrusted.
6. Fresh post-action evidence evaluates URL/text/semantic/state assertions deterministically.
7. PASS, FAIL, and INCONCLUSIVE follow the frozen precedence below.
8. Every acknowledged Solari session is closed/released in `finally`, including failure and cancellation paths.
9. Drizzle/libSQL stores authoritative evaluations, runs, events, evidence summaries, grades, cleanup state, and bounded traces.
10. The live UI recovers from refresh or SSE reconnect by refetching the authoritative snapshot.
11. A typed readiness report shows repeatability, per-run outcomes, assertion results, failure paths, interface discovery/admission/invocation metrics, raw denominators, usage, duration, warnings, and limitations.
12. One real end-to-end run and a repeated-run readiness report work without Demo-specific production dependencies.

## 3. Preserved measured facts

Historical evidence remains truthful and useful:

- TG-000 established the public cookbook fork and workspace. This is retained history, not a current product deliverable.
- TG-001 verified Node `26.1.0`, global pnpm `12.0.0`, and exact dependency pins.
- TG-002 proved real Solari connectivity, Cloudflare Quick Tunnel for the fixture, at least five observed concurrent sessions, and recording/replay capability.
- TG-003 verified `deepseek/deepseek-v4-flash-0731` through pinned TanStack/OpenRouter. Optional models remain unverified.
- TG-005 proved local libSQL/Drizzle transactions, snapshots, ordered persisted events, publish-after-commit process-local SSE, and refetch recovery are feasible.
- TG-006 is retained as the historical V1 checkpoint.
- TG-002R is retained as a strict-hardening probe. It found that provider-side or forced-proxy pre-connect actual-IP enforcement across every browser-process protocol, perfect DNS-rebinding prevention, and provider inventory reconciliation were not established. Those are documented limitations and deferred hardening, not functional-app blockers.
- TG-004R passed at `89e2c93` and is the current generic V2 shared-contract baseline.

Measured evidence is append-only in meaning. No historical result may be relabeled as proof of a capability it did not test.

## 4. Product boundary and limitations

### Included

- anonymous public HTTPS sites;
- exact user-declared navigation origins;
- semantic browsing and non-sensitive search/filter/presentation interactions;
- deterministic observable-state grading;
- one active evaluation with bounded run concurrency;
- local loopback control plane and local database;
- real Solari and verified DeepSeek/OpenRouter execution;
- Demo Store only as a deterministic positive/adversarial fixture;
- page WebMCP discovery/invocation with explicit user opt-in, capability admission, and semantic fallback;
- explicitly configured unauthenticated MCP over loopback HTTP or HTTPS Streamable HTTP with endpoint/tool allowlists;
- semantic/accessibility UI plus implemented page WebMCP and configured-MCP paths;
- discovery-only `llms.txt` and JSON-LD readiness signals, explicitly not agent inputs;
- per-interface discovery, admission, invocation, success, and failure metrics.

Visual fallback, replay availability, and optional models are excluded from current functional capability claims. Compatibility schema values may remain readable but are not presented as verified product surfaces.

### Prohibited by the product policy

- login, signup, credentials, passwords, one-time codes, or account recovery;
- purchase, payment, checkout, booking confirmation, trading, or donations;
- messages, email, chat sends, comments, reviews, or publication;
- destructive actions, irreversible submits, or unknown-effect activation;
- uploads, downloads, permissions, clipboard/device access, or external protocols;
- collection or entry of sensitive personal, financial, health, authentication, or regulated data;
- arbitrary JavaScript, selectors, XPath, CDP, storage, cookies, headers, filesystem, network, provider APIs, or unrestricted/write-capable WebMCP invocation exposed to the model.

### Explicit limitations

P0 provides practical defense in depth, not provider-grade whole-browser network confinement. It does **not** guarantee:

- pre-connect actual-IP enforcement for every browser/browser-process protocol;
- perfect DNS-rebinding or SSRF prevention;
- a forced outbound proxy or provider-side destination policy;
- visibility into every browser-process request or alternate network path;
- that a nominal GET has no backend side effect;
- provider inventory/reconciliation for an unidentified ambiguous create;
- backend business truth beyond captured browser-observable state.

The configure UI, report, README, and evidence must state these limitations clearly.

## 5. Architecture

```text
Loopback browser
  → apps/web
      → V2 validation and practical target preflight
      → atomic evaluation submission
      → one-evaluation FIFO scheduler
          → Solari BrowserProvider
          → fresh BrowserController from BrowserControllerFactory
          → discovery and semantic observation
          → SafeAgentToolPort
          → TanStack/OpenRouter DeepSeek agent
          → fresh assertion evidence capture
          → pure deterministic grader
          → cleanup/release in finally
      → Drizzle/libSQL repositories
      → authoritative snapshot/report/trace
      → persisted events → publish-after-commit SSE
```

Dependency direction remains:

```text
shared
  ↑ db, solari, discovery, ai, agent, grading
  ↑ evaluation
  ↑ apps/web composition
```

Production packages do not import `apps/demo` or Demo admin/challenge/cart grading code.

## 6. Authoritative V2 contracts

Preserve the useful TG-004R surface rather than reopening it without a concrete compile blocker:

- `PublicEvaluationConfigV2` and exact public HTTPS origins;
- bounded URL/text/semantic/state assertion DSL;
- strict assertion-free `AgentExecutionInputV2`;
- separately injected `SafeAgentToolPort`;
- explicitly untrusted observations and tool results;
- transient canonical capture separated from redacted durable evidence;
- pure `GradeInputV2` / `GradeResultV2`;
- atomic evaluation submission and run transition ports;
- browser provider, controller factory, evidence capture, repositories, clock, IDs, and canonical fakes;
- typed capacity errors and explicit release confirmation;
- bounded snapshot, report, trace, event, and aggregate schemas;
- sanitized page `WebMcpToolDescriptorV1` and bounded WebMCP invocation;
- `ConfiguredMcpEndpointV1`, locally admitted `ConfiguredMcpToolDescriptorV1`, `ConfiguredMcpDiscoveryResultV1` / `ConfiguredMcpReadinessV1`, bounded invocation/result schemas, `ConfiguredMcpClientPort`, and `mcp-preferred` mode without endpoint URLs entering the agent DTO;
- separate selected-tool configuration and runtime admitted/denied decisions; raw MCP schemas/results remain explicitly untrusted;
- dynamic `invokeConfiguredMcpReadOnly` action/result variants alongside WebMCP and browser tools;
- interface source/mode on tool milestones and `InterfaceUsageSummary` across semantic UI, page WebMCP, configured MCP, `llms.txt`, JSON-LD, and visual fallback in trace/report projections.

Assertion-origin values may exist only in local authoring, persistence, grading, and report paths. They must not flow into model prompts, tool definitions/results, model history/events, agent traces, or evaluated-target traffic. Assertion-only canaries test provenance/non-flow; coincidental words independently present in the user task or page are not leakage.

Browser text, roles, names, ARIA, and attributes remain page-authored untrusted content even when capture integrity is trusted. They can satisfy assertions but never authorize an unsafe effect.

## 7. Practical target and action safety

Before scheduling:

1. Parse an absolute HTTPS URL with no credentials.
2. Require the start origin to be in the exact declared origin set.
3. Reject IP-literal hosts, localhost, `.local`, malformed hosts, and unsupported ports.
4. Perform a best-effort A/AAAA public-address preflight and reject obvious private, loopback, link-local, reserved, or mixed public/private answers.
5. Reject prompts that explicitly request prohibited actions or contain known secret/sensitive patterns.
6. Record that DNS and remote-browser routing may change after preflight.

For each run:

- create a fresh anonymous Solari session and fresh controller;
- block service-worker registration/control where the available browser capability supports it;
- restrict main-frame navigation to exact declared HTTPS origins;
- use observable request interception to block non-GET/HEAD requests, request bodies, WebSocket, beacon, downloads, and external protocols;
- block obvious auth, password, payment, purchase, messaging, file, permission, destructive, submit, and sensitive controls before dispatch;
- deny stale, unknown, ambiguous, or clearly unsafe semantic actions;
- treat an observed prohibited action/request as INCONCLUSIVE;
- record interception coverage and gaps honestly rather than claiming complete browser egress control.

Discovery remains bounded and untrusted. Page WebMCP sanitizes current-origin descriptors and invokes only locally admitted read-only tools inside the guarded anonymous browser session. Developer-configured MCP is a separate C-owned client path: P0 accepts only explicitly configured unauthenticated loopback HTTP or HTTPS Streamable HTTP endpoints, rejects credentials/query secrets, discovers only selected tool names, emits a sanitized admitted/denied decision, exposes bounded closed read-only inputs/results, and closes the client after each run. Authenticated enterprise MCP is deferred. MCP declarations are hints, raw schemas/results remain untrusted, MCP results never grade directly, rejected/unavailable tools are omitted, and semantic controls remain the fallback.

A Solari create is attempted once. A definitive no-session capacity response may lower later concurrency. A timeout/disconnect/malformed ambiguous create is not retried; the run becomes INCONCLUSIVE and records potential-leak evidence. Lack of provider inventory reconciliation does not block the functional app. Every acknowledged provider session ID still requires close/release attempts and explicit cleanup state.

## 8. Execution and deterministic grading

Per run:

```text
persist acquiring state
→ acquire one Solari session
→ construct and connect a fresh controller
→ install practical navigation/request/action guards
→ navigate and capture initial untrusted observation
→ run assertion-blind semantic agent
→ drain/cancel the serialized action queue
→ capture fresh browser assertion evidence
→ grade deterministically
→ close controller
→ release acknowledged session in finally
→ persist terminal result and publish committed milestone
```

The safe tool upper bound is:

```text
navigate, inspect, click, type, select, pressKey, scroll, wait,
invokeWebMcpReadOnly, invokeConfiguredMcpReadOnly, finish
```

Unavailable tools are omitted dynamically. `invokeWebMcpReadOnly` is present only for admitted sanitized current-origin tools; tool identity and input are revalidated immediately before invocation, and raw descriptors/results remain untrusted. All proposals execute FIFO and are revalidated against the current observation revision, cancellation, budgets, origin, and obvious-effect policy immediately before dispatch. `finish` is only the model’s belief and never grades the run.

Fresh grading evidence is captured only after the model stream is terminal and the action queue is empty. Use a bounded quiet interval and repeated canonical capture; if the page remains unstable, evidence is truncated/ambiguous/unsupported, or capture fails, the affected assertion is unverifiable.

Outcome precedence:

1. committed cancellation → CANCELLED;
2. observed prohibited action/request → INCONCLUSIVE;
3. an explicit agent disposition of `policy_refused`, `blocked`, or `needs_input` → INCONCLUSIVE;
4. missing, invalid, unstable, ambiguous, truncated, unsupported, or otherwise unverifiable required evidence → INCONCLUSIVE;
5. complete fresh evidence with every assertion true → PASS;
6. complete fresh evidence with any assertion false → FAIL.

The persisted deterministic grade is authoritative. Model summaries, assertion truth viewed in isolation, terminal UI state, and completion belief never rewrite PASS/FAIL/INCONCLUSIVE. A policy refusal cannot grade as success.

## 9. Persistence, API, SSE, and UI

Use a clean V2 Drizzle `0000` migration on a recreated local libSQL database. Historical spike databases are disposable; do not add V1 readers or conversion machinery.

Persist bounded:

- evaluation config, exact origins, prompt, assertions, and specification hash;
- run states, model/provider metadata, usage, timings, warnings, and cleanup status;
- practical preflight/interception capability evidence;
- discovery summaries, assertion evidence summaries, and per-interface usage metrics;
- grades, failures, aggregate inputs, and redacted agent-trace milestones;
- event cursor/run sequence ordering.

Do not persist raw CDP/replay URLs, credentials, authorization, full DOM/HTML, arbitrary page dumps, raw provider bodies, or the transient raw canonical URL used for grading.

Loopback API:

```text
GET  /api/health
GET  /api/capabilities
POST /api/evaluations
GET  /api/evaluations/:id
GET  /api/evaluations/:id/report
GET  /api/evaluations/:id/trace
GET  /api/evaluations/:id/events
```

The snapshot is authoritative. SSE publishes only committed redacted events and is a live notification/projection channel. Refresh, reconnect, gap, overflow, or process restart triggers snapshot refetch.

UI states:

- configure: URL, origins, task, assertions, model/runs/concurrency, interface strategy, page WebMCP, and configured MCP endpoints/tool allowlists;
- live: plain-language evaluation state, interface being used, bounded trace, warnings, evidence capture, cleanup, and reconnect state;
- readiness report: repeatability, per-run outcomes and failure paths, assertion evidence, interface usage, raw denominators, duration/usage, cleanup, and observable-state limitation. Primary UI copy translates internal cursor/revision/DTO/policy vocabulary into developer-facing language.

## 10. Short implementation path

```text
TG-004R shared V2 contracts — PASS at 89e2c93
  → F1/F2 lane implementations integrated
  → F2C runnable composition + page/configured MCP + readiness metrics
  → F3 one real end-to-end Solari/DeepSeek readiness run
  → F4 repeated independent runs and readiness report
  → F5 manual functional verification and cleanup audit
```

These are implementation phases, not a new hardening bureaucracy. A concrete red build, typecheck, migration, or manual runtime result blocks the next phase; an unimplemented deferred hardening feature does not.

### F1 — WIP integration rebaseline — complete

The initial A/B/C/D functional slices are integrated in linear history. Preserve lane ownership and regenerate the sole lockfile only after any new configured-MCP/composition manifests settle.

Before the integration freeze, Agent B runs one bounded real public-site safety smoke using currently measured capabilities: exact-origin navigation, fresh anonymous session, best-effort public DNS preflight, observable unsafe-request blocking, fresh evidence capture, and release. The evidence must record both successful controls and known coverage gaps. It is not dependent on new provider/proxy features.

### F2 — Parallel functional slices

- **Agent A — evaluation/grading/integration:** `packages/evaluation`, `packages/grading`, shared fixes only for concrete contract defects, root integration, lockfile, and manual composition inspection. Implement atomic submission, one-evaluation queue, executor, precedence, aggregates, finally cleanup, interface modes, and metrics.
- **Agent B — browser/discovery/fixture:** `packages/solari`, `packages/discovery`, `apps/demo`, and browser-safety evidence. Implement provider/controller lifecycle, exact-origin/practical request guards, semantic observations, page WebMCP discovery/invocation, fresh capture, discovery-only readiness signals, and fixture-only Demo support. Visual fallback is not part of the current functional path.
- **Agent C — AI/agent:** `packages/ai`, `packages/agent`, and model evidence. Implement the pinned DeepSeek/OpenRouter adapter, assertion-blind prompt layers, dynamic safe tools including only admitted sanitized read-only WebMCP calls, FIFO/current-revision checks, budgets, cancellation, and bounded event mapping.
- **Agent D — data/product UI:** `packages/db`, `packages/ui`, `apps/web`, and persistence/UI evidence. Implement clean V2 migration/repositories, loopback API, snapshot/SSE, configure/live/report UI, and separate agent trace versus grading report.

### F2C / P0 — Runnable readiness composition — pre-provider gate passed

- **A:** shared prompt/network/completion/queue contracts landed at `647e4dd`; evaluation now merges closed discovery/provider warnings and continues safely runnable peer runs after an individual run error while selecting the lowest configured failed index deterministically.
- **B:** browser/discovery stabilization landed at `e478598`, including shared public-network classification, assertion-only capture, policy causality, and discovery-only metadata.
- **C:** agent/provider/configured-MCP stabilization landed at `ef7e1fb`, including explicit completion dispositions, bounded provider warnings, shared destination admission before requests, and exhaustive cleanup attempts.
- **D:** persistence/product UI stabilization landed at `443c5e7`; correction `c8f79c2` replaces evidence-hash identity with per-run async invocation context plus committed-evidence verification, derives semantic readiness consistently from authoritative deduplicated dispatched terminal evidence, and fences shutdown on every in-flight reservation-to-transaction settlement.

Re-audited and verified on 2026-09-02: frozen install, environment parsing, all eleven production package builds, clean temporary-DB migration/check, built-server startup, health/capabilities reads, bounded missing-evaluation response, unsafe-prompt rejection with zero evaluation/run/event rows, product-shell render, and hostile-Host rejection. At that pre-provider checkpoint, no automated tests or real provider sessions were run.

The three former D blockers are resolved in code. Equal evidence hashes no longer carry run identity. Semantic positive readiness is derived only when the first deduplicated terminal completion proves actual dispatch through the admitted semantic tool surface, and the same rule is used by runtime finalization, DB reconstruction, and UI projection. Shutdown sets closing synchronously, rejects new reservations, waits for all already-registered submission settlements, then waits for queue idle before provider/database close.

### F3 — One real run — fully closed 2026-09-02

One semantic-only evaluation was submitted through the production-built API against `https://www.talon.ba` using the configured DeepSeek model and one origin/path plus `planId=12` assertion. The independent run completed `passed` after four model iterations, four successful dispatched tool calls, three browser actions, two-attempt fresh evidence with zero unverifiable assertions, and 17,968 total tokens. Snapshot/report projections agreed, the complete durable event history contained 38 contiguous events, live SSE covered cursors 7–38 after the POST returned the evaluation ID, and the sole `passive_policy_blocked` warning remained visible and non-fatal. Solari acquisition and model usage advanced their capabilities to verified; release was provider-confirmed with zero unresolved sessions/attempts, potential leaks, or nonterminal runs after server shutdown. No Talon-specific production source was found. See `docs/evidence/f3-real-provider-talon-2026-09-02.md`.

A separately authorized D-owned browser-attached run then observed the hydrated product UI from running through terminal state with durable live updates, warnings, interface metrics, assertion-blind trace, grade, and released cleanup matching API/DB projections. That UI run honestly ended INCONCLUSIVE after trustworthy final evidence was lost; the product did not invent a PASS or evidence row. Together with the earlier deterministic PASS provider/API/DB run, this closes F3 without turning either observation into a general reliability claim. See `docs/evidence/agent-d-f3-ui-live-2026-09-02.md`.

### F4 — Repeated runs/report — provider/API/SSE/DB gate passed 2026-09-02

Under direct authorization, one evaluation requested three runs at concurrency three against the same external Talon task/assertion. All three started within 1 ms, acquired distinct acknowledged Solari sessions, completed `passed`, and reached provider-confirmed release. Durations were 42,316/39,829/42,327 ms; each run used three model iterations, three successful dispatched tools, two browser actions, fresh two-attempt evidence with zero unverifiable assertions, and preserved one non-fatal `passive_policy_blocked` warning. Aggregate requested/started/passed was `3/3/3`; failed, inconclusive, cancelled, nonterminal, and potential leaks were zero; both declared denominators were `3/3`.

All three captures shared exactly one evidence hash. The DB nevertheless contained three distinct run-bound evidence rows and three distinct run-bound grade rows; for every configured run index, run/evidence/grade hashes agreed and the URL/query assertion passed. This real concurrent observation validates `c8f79c2`'s run-scoped identical-evidence correction. Three distinct provider sessions and three create attempts were confirmed released, with zero unresolved sessions/attempts after shutdown. Live SSE covered cursors 17–95 and authoritative JSON history covered all contiguous cursors 1–95. See `docs/evidence/f4-repeated-run-talon-2026-09-02.md`.

F4 does not claim general reliability beyond these three observations and does not validate browser-hydrated UI, replay, page/configured MCP, visual fallback, optional models, cancellation, reconnect/restart, or queue saturation.

### F5 — Functional verification — closed 2026-09-02

C `7eb59a8` manually validated the narrow unauthenticated configured-MCP client with a real loopback Streamable HTTP fixture and deterministic public-DNS/transport stubs: explicit opt-in, request-by-request admission, read-only enforcement, bounded/redacted untrusted results, truthful truncation, cleanup attempts, and grading isolation passed. It does not prove an external public/authenticated MCP service, connection-pinned DNS, or provider-grade egress.

B evidence `749eb3a` records that the managed browser did not expose current page WebMCP, so descriptor admission/invocation/result handling remain externally blocked and unverified. The same real run proved truthful `0/0/0/0/0` page metrics, semantic fallback, model-prose non-authority, fresh-evidence grading, and confirmed release. Visual fallback remains unavailable.

D `d041c79` added the cancellation API/control and manually passed hydrated running state, queue 409 with no rejected-request artifacts, terminal hard reload, redaction, and cleanup. The run completed before running-state reload or visible cancellation could be exercised. D follow-up `00725bc` now awaits A's `requestCancellation(...): Promise<boolean>` before synchronously delivering the queue abort and allowing HTTP 202.

A now makes durable `running → cancelling` the acceptance linearization point, stops new dispatch after admission, drains active runs, and transactionally cancels every never-dispatched queued run through an already-aborted executor path that cannot acquire resources or grade. `cancelling → cancelled` requires trustworthy durable cancellation and confirmed acknowledged-session release for every cancellation-required run; any rejection, wrong/nonterminal record, leak, or unconfirmed cleanup instead attempts `cancelling → failed`. CAS/reread reconciliation preserves terminal non-overwrite and internal idempotence without promising repeated-route idempotence. Production composition, fresh migration/check, and an empty-DB built-server gate pass without a provider session. See `docs/evidence/f5-agent-a-integration-2026-09-02.md` for the prior blocker and `docs/evidence/f5-agent-a-cancellation-implementation-2026-09-02.md` for the implementation checkpoint. Automated tests remain paused.

D final validation `dd5161e` exercised the production-built UI against a fresh DB with three runs at concurrency one. A hard reload recovered authoritative running state and live SSE; the visible cancel action returned HTTP 202 only after durable `running → cancelling`; the active acknowledged Solari session released successfully; the active run and two never-dispatched rows then committed `cancelled` with no evidence or grades; and the evaluation committed `cancelled` last. Snapshot/report/trace/events/UI reconciled, queue/redaction gates remained clean, and zero leaks or nonterminal rows remained. See `docs/evidence/agent-d-f5-cancellation-live-2026-09-02.md`.

## 11. Current verification commands

The current user directive prohibits creating, modifying, or running automated tests. Use compilation and manual product inspection only:

```bash
cd examples/tracegate
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm env:check
mise exec -- pnpm build       # production build graph; excludes @tracegate/e2e
DATABASE_URL=file:/tmp/tracegate-p0.db mise exec -- pnpm db:migrate
DATABASE_URL=file:/tmp/tracegate-p0.db mise exec -- pnpm db:check
DATABASE_URL=file:/tmp/tracegate-p0-server.db mise exec -- pnpm start
```

Package `typecheck` scripts currently include paused automated-test sources in some workspaces, so they are not checkpoint evidence while the test prohibition is active. Production `build` configurations are the compile authority for this phase. Do not run `db:generate` unless an intentional schema change requires it.

Manual inspection verified clean DBs, health/capabilities/snapshot/report/trace/events/SSE behavior, browser-hydrated live projection and running reload, real semantic interface metrics, fresh deterministic grading, single and three-concurrent-run Solari/DeepSeek evaluations, identical-evidence run attribution, aggregate denominators, queue rejection without artifacts, durable UI cancellation, terminal reload, redaction, and confirmed cleanup. Configured MCP passed only its documented loopback/stub manual boundary; page WebMCP invocation remains unavailable/unverified with semantic fallback observed. No fixture output or hard-coded result satisfied provider grading.

Review focus:

- V2 config and assertion bounds;
- assertion provenance/non-flow;
- URL/text/semantic/state truth tables and INCONCLUSIVE cases;
- atomic submission/transitions and queue bounds;
- exact-origin and practical unsafe-request/action blocking;
- WebMCP descriptor sanitization, read-only admission, unsafe/malformed rejection, untrusted bounded result handling, semantic fallback, and fresh-evidence-only grading;
- fresh capture and unstable/ambiguous evidence;
- real Solari/DeepSeek lifecycle and finally release;
- clean V2 DB, authoritative snapshot, publish-after-commit SSE, reconnect recovery;
- raw aggregate counts/denominators;
- Demo fixture usefulness and production Demo independence;
- seeded credential/CDP/replay/full-DOM redaction checks.

## 12. Deferred hardening and non-goals

Post-functional-app work may add:

- provider-side destination policy or a forced outbound proxy;
- pre-connect actual-IP enforcement across all browser/browser-process protocols;
- stronger DNS pinning and rebinding prevention;
- exhaustive browser-process egress classification;
- provider inventory and ambiguous-create reconciliation;
- HTTP create idempotency/retry semantics;
- replay UX and optional models after fresh verification;
- distributed queues, multi-process SSE, remote databases, user accounts, or hosted control plane;
- richer assertions that preserve deterministic grading.

Still out of scope: credentialed/private sites, financial or messaging workflows, uploads/downloads, destructive actions, unrestricted/write-capable WebMCP invocation, arbitrary scripts/selectors, and any claim of backend business truth.

## 13. Ownership and repository discipline

Paths remain exclusive:

| Owner | Paths |
|---|---|
| Agent A | TraceGate root config, `AGENTS.md`, `packages/shared`, `packages/evaluation`, `packages/grading`, dormant `tests/e2e` ownership, lockfile, integration evidence |
| Agent B | `packages/solari`, `packages/discovery`, `apps/demo`, browser/Solari evidence |
| Agent C | `packages/ai`, `packages/agent`, model/agent evidence |
| Agent D | `packages/db`, `packages/ui`, `apps/web`, persistence/UI evidence |

No agent edits, stages, formats, resets, or commits another lane’s WIP. Shared changes go through Agent A and require a concrete cross-lane contract reason. Only Agent A regenerates `pnpm-lock.yaml`, after manifests settle, using Node `26.1.0` and global pnpm `12.0.0`.

No remaining P0 code gate is identified within the scoped local functional plan. Repeated route cancellation may still return documented HTTP 409 after the durable status leaves `running`; internal CAS/reread reconciliation remains idempotent and terminal-safe. External page-WebMCP invocation, authenticated/external configured MCP, visual fallback, replay, optional models, provider-grade whole-browser egress, stronger DNS pinning, and broader recovery remain unsupported, externally blocked, or deferred rather than incomplete hidden requirements.
