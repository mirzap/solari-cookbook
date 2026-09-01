# TraceGate functional-app implementation plan

**Source of truth:** 2026-09-01
**Product boundary:** local functional proof of concept
**Current status:** generic V2 shared contracts passed in TG-004R at `89e2c93`; application-lane WIP remains quarantined and must be integrated against that surface

## 1. Product outcome

TraceGate is a local application for evaluating whether a browser-capable model can complete a bounded task on a public HTTPS site.

A user supplies:

- one public HTTPS start URL;
- one bounded natural-language prompt;
- one to twenty deterministic browser-observable assertions;
- model, run-count, concurrency, and recording options within configured bounds.

Supported assertions are:

- final URL equality or origin/path equality;
- visible document text or title checks;
- accessibility-semantic role/name/count checks;
- checked, selected, expanded, disabled, or bounded non-sensitive value state.

TraceGate runs real isolated Solari Browser sessions, uses the verified DeepSeek/OpenRouter path, drives the page through a constrained semantic tool surface with an experimental capability-gated read-only WebMCP adapter when available, captures fresh browser evidence after action execution stops, grades deterministically, persists results in local Drizzle/libSQL, streams live state through snapshot plus SSE, and presents separate run traces and assertion reports.

A **PASS** means only that every declared browser-observable assertion was true in the accepted fresh capture. It is not proof of arbitrary backend state, durable external effects, identity, authorization, payment, publication, or business truth.

## 2. Functional definition of done

The app is functionally complete when:

1. The local configure UI accepts and validates URL, exact origins, prompt, assertions, model, runs, and concurrency.
2. A valid evaluation atomically creates its evaluation row, run rows, and queued milestones.
3. Real Solari sessions execute through a fresh controller per run.
4. `deepseek/deepseek-v4-flash-0731` runs through the pinned TanStack/OpenRouter adapter.
5. The model receives the assertion-free V2 execution DTO and only dynamically available safe semantic tools. A site WebMCP tool appears only after read-only adapter admission; raw page tool descriptors never reach the model.
6. Fresh post-action evidence evaluates URL/text/semantic/state assertions deterministically.
7. PASS, FAIL, and INCONCLUSIVE follow the frozen precedence below.
8. Every acknowledged Solari session is closed/released in `finally`, including failure and cancellation paths.
9. Drizzle/libSQL stores authoritative evaluations, runs, events, evidence summaries, grades, cleanup state, and bounded traces.
10. The live UI recovers from refresh or SSE reconnect by refetching the authoritative snapshot.
11. A typed report shows per-run outcomes, assertion results, raw counts, denominators, usage, duration, warnings, and limitations.
12. One real end-to-end run, repeated runs, and focused functional verification are green without Demo-specific production dependencies.

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
- experimental read-only WebMCP discovery/invocation with explicit user opt-in, capability admission, and semantic-browser fallback.

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
- a minimal WebMCP contract checkpoint adding sanitized `WebMcpToolDescriptorV1`, bounded closed-schema inputs/results, and `invokeWebMcpReadOnly` to the dynamic safe-tool surface.

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

Discovery uses the active browser/controller path where practical and remains bounded and untrusted. WebMCP is experimental and off by default. When the user opts in, discovery may sanitize current-origin tool descriptors; admission requires a declared read-only tool, a bounded supported input schema, no credential/sensitive/destructive fields, no arbitrary destination, and a local allow decision. Page annotations are hints rather than proof. Invocation remains inside the current anonymous session with request guards armed; observable prohibited traffic/effects block and make the run INCONCLUSIVE. Results are bounded, redacted, explicitly untrusted, and never grade directly. Rejected/unavailable tools are omitted and the agent falls back to semantic browser controls.

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
navigate, inspect, click, type, select, pressKey, scroll, wait, invokeWebMcpReadOnly, finish
```

Unavailable tools are omitted dynamically. `invokeWebMcpReadOnly` is present only for admitted sanitized current-origin tools; tool identity and input are revalidated immediately before invocation, and raw descriptors/results remain untrusted. All proposals execute FIFO and are revalidated against the current observation revision, cancellation, budgets, origin, and obvious-effect policy immediately before dispatch. `finish` is only the model’s belief and never grades the run.

Fresh grading evidence is captured only after the model stream is terminal and the action queue is empty. Use a bounded quiet interval and repeated canonical capture; if the page remains unstable, evidence is truncated/ambiguous/unsupported, or capture fails, the affected assertion is unverifiable.

Outcome precedence:

1. committed cancellation → CANCELLED;
2. observed prohibited action/request → INCONCLUSIVE;
3. missing, invalid, unstable, ambiguous, truncated, unsupported, or otherwise unverifiable required evidence → INCONCLUSIVE;
4. complete fresh evidence with every assertion true → PASS;
5. complete fresh evidence with any assertion false → FAIL.

Model summaries and beliefs never influence grading.

## 9. Persistence, API, SSE, and UI

Use a clean V2 Drizzle `0000` migration on a recreated local libSQL database. Historical spike databases are disposable; do not add V1 readers or conversion machinery.

Persist bounded:

- evaluation config, exact origins, prompt, assertions, and specification hash;
- run states, model/provider metadata, usage, timings, warnings, and cleanup status;
- practical preflight/interception capability evidence;
- discovery summaries and assertion evidence summaries;
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

- configure: URL, origins, prompt, assertions, model/runs/concurrency, limitations;
- live: evaluation/run state, bounded trace, warnings, evidence capture, cleanup, reconnect state;
- report: prompt/target, assertions, per-run results, PASS/FAIL/INCONCLUSIVE reasons, raw counts and denominators, durations/usage, cleanup state, and observable-state limitation.

## 10. Short implementation path

```text
TG-004R shared V2 contracts — PASS at 89e2c93
  → F1 integrate quarantined lane WIP against V2 contracts
  → F2 parallel functional slices: DB/API/UI + browser + agent + evaluation/grading
  → F3 one real end-to-end Solari/DeepSeek run
  → F4 repeated runs and truthful report
  → F5 functional verification and cleanup audit
```

These are implementation phases, not a new hardening bureaucracy. A concrete red compile/test/run result blocks the next phase; an unimplemented deferred hardening feature does not.

### F1 — WIP integration rebaseline

Each owner reviews only its quarantined paths, keeps reusable infrastructure, removes production Demo/V1 assumptions, compiles against TG-004R, and commits a path-isolated handoff. Do not blanket-stage or reset the dirty tree. Agent A regenerates the sole lockfile only after intended manifests are settled.

Before the integration freeze, Agent B runs one bounded real public-site safety smoke using currently measured capabilities: exact-origin navigation, fresh anonymous session, best-effort public DNS preflight, observable unsafe-request blocking, fresh evidence capture, and release. The evidence must record both successful controls and known coverage gaps. It is not dependent on new provider/proxy features.

### F2 — Parallel functional slices

- **Agent A — evaluation/grading/integration:** `packages/evaluation`, `packages/grading`, shared fixes only for concrete contract defects, root integration, lockfile, and end-to-end tests. Implement atomic submission, one-evaluation queue, executor, precedence, aggregates, and finally cleanup.
- **Agent B — browser/discovery/fixture:** `packages/solari`, `packages/discovery`, `apps/demo`, and browser-safety evidence. Implement provider/controller lifecycle, exact-origin/practical request guards, semantic observations, capability-gated WebMCP discovery/invocation adapter, fresh capture, semantic fallback, and fixture-only Demo tests.
- **Agent C — AI/agent:** `packages/ai`, `packages/agent`, and model evidence. Implement the pinned DeepSeek/OpenRouter adapter, assertion-blind prompt layers, dynamic safe tools including only admitted sanitized read-only WebMCP calls, FIFO/current-revision checks, budgets, cancellation, and bounded event mapping.
- **Agent D — data/product UI:** `packages/db`, `packages/ui`, `apps/web`, and persistence/UI evidence. Implement clean V2 migration/repositories, loopback API, snapshot/SSE, configure/live/report UI, and separate agent trace versus grading report.

### F3 — One real run

Compose all four lanes and complete one public HTTPS task through real Solari and the verified DeepSeek model. Require fresh evidence, deterministic grade, durable snapshot/report, live UI updates, and acknowledged-session release.

### F4 — Repeated runs/report

Run a bounded repeated evaluation, verify no duplicate runs or shared session state, recalculate raw counts and denominators from persisted rows, and show truthful PASS/FAIL/INCONCLUSIVE reporting.

### F5 — Functional verification

Run focused package tests, workspace typecheck/test/build, clean-DB migration, local UI flow, one real credentialed run, repeated-run aggregation, refresh/reconnect, assertion non-flow canaries, Demo-independence checks, redaction seeds, cancellation, and cleanup audit.

## 11. Verification commands

```bash
cd examples/tracegate
node --version                 # v26.1.0
pnpm --version                 # 12.0.0
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:check
pnpm test:e2e:local
pnpm test:e2e:solari
pnpm verify
```

Credentialed runs must report configured success or a concrete failure; they may not silently skip. Claims in UI/docs/evidence must match measured output.

Required focused coverage:

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
| Agent A | TraceGate root config, `AGENTS.md`, `packages/shared`, `packages/evaluation`, `packages/grading`, `tests/e2e`, lockfile, integration evidence |
| Agent B | `packages/solari`, `packages/discovery`, `apps/demo`, browser/Solari evidence |
| Agent C | `packages/ai`, `packages/agent`, model/agent evidence |
| Agent D | `packages/db`, `packages/ui`, `apps/web`, persistence/UI evidence |

No agent edits, stages, formats, resets, or commits another lane’s WIP. Shared changes go through Agent A and require a concrete cross-lane contract reason. Only Agent A regenerates `pnpm-lock.yaml`, after manifests settle, using Node `26.1.0` and global pnpm `12.0.0`.

The immediate next action is **F1: lane-local rebaseline of quarantined WIP against TG-004R**, followed by the four parallel F2 assignments above.
