# TraceGate PoC Build: Implementation Plan

## 1. Goal and delivery definition

Build a polished, fully functional, local-first TraceGate proof of concept that proves one thesis: **a website working once for an AI agent is not enough; reliability requires repeated, isolated executions**.

A reviewer must be able to configure the controlled store task, launch three independent Solari Browser runs, watch real TanStack AI/OpenRouter tool activity, receive independently graded PASS/FAIL/INCONCLUSIVE outcomes, inspect traces and discovered interfaces, and see an honest aggregate reliability report. The judged source must live under `examples/tracegate/` in a public GitHub fork of `solari-sdk/solari-cookbook`. The implementation may take two focused build days plus an optional polish day; it is not allowed to substitute scripted or fabricated runs for a broken core integration.

### Definition of done

The required judged path is:

```text
TraceGate web app
  → create evaluation and 3 durable run records
  → bounded scheduler
  → 3 independent Solari Browser sessions
  → semantic observation + TanStack AI tool loop
  → controlled Demo Store
  → deterministic cart-state grading
  → persisted milestones and metrics
  → resumable SSE live view
  → truthful report and per-run trace
  → guaranteed browser cleanup
```

The implementation must preserve these explicit exclusions: no authentication, users, organizations, billing, teams, RBAC, settings, admin, BYOK, API-key UI, CI/cron, notifications, email, GitHub integration, custom workflows, remote MCP/A2A, generic agent frameworks, site crawling/indexing, production secret vault, or arbitrary target credentials.

---

## 2. Evaluation of the initial plan

### What the initial plan gets right

- The product thesis, primary user journey, controlled demo, independent grading, and repeated-run aggregation are unusually clear.
- It correctly makes Solari Browser, TanStack AI structured tools, semantic observation, deterministic grading, SSE, persistence, and trace inspection P0.
- It correctly treats WebMCP, Sandbox, replay, model comparison, and visual extras as capability-gated enhancements.
- It separates model self-reported completion from the actual grade.
- It identifies the main security boundary: website content, discovery metadata, schemas, and tool results are untrusted.

### What must be refined

1. **Eight workers are too fragmented for four concurrent agents.** Shared contracts, integration order, and exclusive path ownership must be frozen before fan-out. The refined plan groups the original responsibilities into four lanes without deleting the requested package boundaries.
2. **The first critical path is connectivity, not UI.** Solari Browser runs remotely and cannot reach a developer machine’s `localhost`; the demo must be exposed through a verified HTTPS tunnel or a Solari Sandbox preview before the vertical slice can work.
3. **Account capabilities must drive concurrency.** The current Free limit of three browsers matches the default demo, but the scheduler must start from measured capacity and degrade safely after `429 ConcurrencyLimitExceeded`.
4. **TanStack AI events are not the product event log.** Raw AG-UI events must be mapped, redacted, coalesced, persisted, and then projected through TraceGate SSE. Token deltas should not become durable rows.
5. **Run outcomes need an `inconclusive` state.** Solari/provider/grading failures must not be counted as website task failures, and cancelled/inconclusive runs must remain visible in denominators.
6. **Replay URLs cannot be durable data.** Solari replay finalization is asynchronous and presigned URLs expire; persist stable session/replay status only and request fresh access on demand.
7. **Version assumptions need a gate.** Node 26 and TypeScript 7 are current, but pnpm 12 is still pre-release as of this plan. Use an exact stable pnpm 11 release unless pnpm 12 is stable and passes the compatibility spike.
8. **The original build phases are too sequential.** Replace them with parallel waves separated by four integration checkpoints: feasibility, contract freeze, single-run vertical slice, and repeated-run feature completion.

---

## 3. Current state and verified constraints

The local workspace was empty at planning start: no code, manifests, Git history, `AGENTS.md`, conventions, or prior plans existed. Before implementation, `TG-000` must establish a public GitHub fork of `solari-sdk/solari-cookbook` and place the complete TraceGate workspace under `examples/tracegate/`. Until that gate passes, paths in this document are relative to the future TraceGate project root; the current planning file is relocated to `examples/tracegate/docs/plans/` during the gate.

### User decisions

- Optimize for reliable **local judging**, not a public serverless deployment.
- Build a real functional PoC even if it takes a couple of days.
- Assume **four concurrent implementation agents**.
- Show only real measured run outcomes; never manufacture a failure or favorable comparison.

### External constraints to design around

- Solari session creation returns `sessionId`, `wsEndpoint`, `cdpEndpoint`, and expiry metadata. `GET /sessions/:id` is not dependable for reconstruction; store the safe create metadata needed for cleanup.
- Use CDP with `playwright-core.connectOverCDP` by default because it is less tightly coupled than Solari’s native Playwright/Patchright wire version. Treat the credential-bearing endpoint as an in-memory secret.
- Browser release is asynchronous. Cleanup must be idempotent and replay finalization must be polled after release with backoff.
- Solari’s current documented Free limits are three browsers, one Sandbox, and one-hour sessions. The actual account entitlement is an implementation-time fact, not an assumption.
- A cloud browser cannot access local `localhost`. A tunnel is the preferred P0 connectivity path; one reusable Sandbox preview is the fallback. Per-run Sandboxes remain P2 and must not block Browser-only P0.
- TanStack AI currently exposes `chat()`, Zod-backed `toolDefinition(...).server(...)`, `maxIterations()`, AG-UI events, structured output, usage hooks, and SSE helpers. It is pre-1.0, so pin `@tanstack/ai`, `@tanstack/ai-react`, and `@tanstack/ai-openrouter` as a tested compatible set.
- `maxIterations()` counts model turns, not tool calls. TraceGate must separately enforce wall-clock, tool-call, browser-action, navigation-policy, and cancellation budgets.
- The requested OpenRouter model slugs exist and advertise tools and structured output: `deepseek/deepseek-v4-flash-0731`, `mistralai/mistral-small-2603`, and `openai/gpt-5-mini`. Each is enabled only after a production-shaped compatibility probe.
- WebMCP remains experimental, Chromium/secure-context dependent, and API-unstable. The current draft entry point is `document.modelContext`. Semantic HTML is the required execution baseline; WebMCP is a non-blocking P1 gate.

---

## 4. Resolved architecture

### 4.1 Repository layout

Retain the brief’s package boundaries so product responsibilities stay legible, and add one `evaluation` package because orchestration needs an exclusive owner and must not live inside UI routes.

```text
solari-cookbook/
└── examples/
    └── tracegate/
        ├── apps/
        │   ├── web/                 # TanStack Start configure/live/report + server routes
        │   └── demo/                # controlled Demo Store target
        ├── packages/
        │   ├── shared/              # Zod contracts, IDs, states, events, ports
        │   ├── db/                  # Drizzle/libSQL schema and repositories
        │   ├── solari/              # session lifecycle, CDP controller, replay
        │   ├── discovery/           # semantic refs, llms.txt, JSON-LD, WebMCP
        │   ├── ai/                  # TanStack AI/OpenRouter, models, tools, events
        │   ├── agent/               # run context, budgets, prompt/policy
        │   ├── grading/             # deterministic grader and failure explanation
        │   ├── evaluation/          # queue, orchestrator, aggregation
        │   └── ui/                  # shadcn/Base UI primitives and tokens
        ├── tests/e2e/
        ├── docs/
        │   ├── plans/
        │   └── evidence/
        ├── turbo.json
        ├── pnpm-workspace.yaml
        ├── package.json
        └── README.md
```

### 4.2 Dependency direction

```text
shared
  ↑
  ├── db
  ├── solari
  ├── discovery
  ├── ai
  ├── agent
  ├── grading
  ├── evaluation
  ├── ui
  └── demo

apps/web (composition root)
  └── imports all server packages and ui

tests/e2e
  └── imports public package entry points and app test harnesses
```

Rules:

- `shared` depends only on Zod and platform types.
- Feature packages depend on `shared`, not on each other’s concrete implementations. Cross-package behavior is expressed through ports.
- `evaluation` may depend on public ports/types from `shared`; concrete `db`, `solari`, `agent`, and `grading` adapters are injected by `apps/web`.
- `ai` is the only package that imports TanStack AI/OpenRouter.
- `solari` is the only package that imports Solari SDK or Playwright/CDP.
- `db` is the only package that opens libSQL/SQLite.
- `apps/web` is the production composition root and owns server routes, SSE connections, startup migration, known-lease tracking, and process shutdown.
- Client code may not import server implementations, provider keys, Solari metadata, CDP endpoints, demo admin secrets, or replay capabilities.
- Packages import only other packages’ public `src/index.ts` exports.

### 4.3 Application topology

Use React with TanStack Start/Router for `apps/web`, Tailwind CSS plus shadcn/ui and Base UI through `packages/ui`, and TanStack Query only where persisted snapshot fetching benefits from cache/retry semantics. Use TanStack Start server routes for JSON and SSE. Run it as a long-lived local Node process for judging; do not optimize this PoC for serverless execution. Keep `apps/demo` deliberately smaller: a standalone Node HTTP server rendering semantic HTML and JSON endpoints, with no React hydration requirement. It is independently addressable and only its public browser origin is exposed through the selected tunnel/Sandbox preview.

```text
Browser reviewer → apps/web on loopback
                         │
                         ├── libSQL/SQLite
                         ├── OpenRouter
                         ├── Solari API/CDP
                         └── HTTPS public demo URL → apps/demo
```

Server-only environment is validated once at boot: `OPENROUTER_API_KEY`, `SOLARI_API_KEY`, `DATABASE_URL` (default local file), `DEMO_PUBLIC_URL`, `DEMO_ADMIN_URL`, and `DEMO_ADMIN_SECRET`. No key is accepted from client input.

---

## 5. Shared contract freeze

`packages/shared` is the first integration deliverable. Zod v4 schemas are authoritative and TypeScript types are inferred. After checkpoint `TG-006`, only the integration owner edits shared contracts; changes require an impact note, fixture updates, and a synchronized rebase.

### 5.1 Core entities

Define and export:

- `Evaluation`, `EvaluationConfig`, `EvaluationStatus`
- `Run`, `RunStatus`, `RunOutcome`, `FailureRecord`
- `RunEvent`, `EventEnvelope`, `RunStep`
- `AgentAction`, `AgentObservation`, `CompactElement`
- `DiscoveredInterface`, `DiscoveryEvidence`
- `GradeResult`, `GradePredicate`, `FailureAnalysis`
- `ModelDefinition`, `ModelCapabilityCheck`, `RuntimeCapability`
- API request/response/error schemas and runtime port interfaces

### 5.2 Evaluation configuration

```text
EvaluationConfigV1
- schemaVersion: 1
- target:
    kind: "tracegate-demo-store"
    publicBaseUrl: absolute HTTPS URL reachable by Solari Browser
    adminBaseUrl: server-only URL; loopback for tunnel mode, protected preview origin for Sandbox fallback
    scenarioId: "classic-tee-size-m-v1"
- goal: non-empty string, max 1,000
- successCriterion: non-empty string, max 1,000
- modelIds: non-empty array of verified ModelId, max 3
  # P0 UI submits exactly one; the shape avoids a frozen-contract break for P2 comparison
- requestedRunsPerModel: integer 1...5, default 3
- requestedConcurrency: integer 1...5, default 3
- interfaceMode: "auto" | "semantic-only" | "native-allowed"
- recordingRequested: boolean
- sampling:
    temperature: number, default 0.2
    topP: number, default 1
    providerRouting: optional allowlisted OpenRouter preference
- budgets:
    wallClockMs: 15_000...300_000, default 120_000
    maxModelTurns: 1...30, default 15
    maxToolCalls: 1...100, default 40
    maxBrowserActions: 1...60, default 25
    toolTimeoutMs: 1_000...30_000, default 15_000
    maxObservationBytes: 2_048...32_768, default 12_288
    maxHistoryBytes: 16_384...262_144, default 96_000
    maxTotalTokens: positive integer, default chosen at TG-003 from measured usage
- allowedOrigins: exact-origin array containing target.publicBaseUrl origin
```

These are safety defaults to tune with evidence, not claimed benchmarks.

### 5.3 Runtime ports

```text
BrowserProvider.acquire(request, signal) → BrowserLease
BrowserLease.release(reason) → ReleaseResult        # idempotent
BrowserController.navigate/observe/click/type/select/pressKey/scroll/wait
DiscoveryController.discover(page, policy, signal) → DiscoveryEvidence
AgentRunner.run(context, signal) → AgentRunResult    # never a grade
Grader.grade(context, signal) → GradeResult
FailureAnalyzer.analyze(context, signal) → FailureAnalysis
EvaluationRepository / RunRepository
  - create / get
  - compareAndSetStatus(expected, next, patch)
  - listRecoverable
  - transactionallyFinalize(outcome, grade, event)
EventRepository
  - append(input) → persisted EventEnvelope
  - listAfter(evaluationId, cursor, limit)
  - earliestCursor(evaluationId)
  - latestCursor(evaluationId)
ReplayService.getStatus / requestFreshAccess
```

All asynchronous methods accept `AbortSignal`. Cleanup uses a fresh short timeout signal, never the already-aborted run signal.

`packages/shared/src/redaction.ts` owns the pure central redactor and pattern registry used at the repository boundary and by logs/SSE. `packages/shared/src/env.ts` owns the validated environment shape. `packages/shared/src/testing/` owns canonical fake ports, deterministic clock, scripted browser controller, and event fixtures so all four lanes test the same frozen semantics.

---

## 6. State, outcome, and event semantics

### 6.1 Evaluation state machine

| From | Legal next states |
|---|---|
| `queued` | `running`, `cancelling`, `failed` |
| `running` | `cancelling`, `completed`, `failed` |
| `cancelling` | `cancelled`, `completed`, `failed` |
| `completed`, `cancelled`, `failed` | none |

- `completed`: every run is terminal, regardless of pass/fail/inconclusive.
- `cancelled`: cancellation prevented at least one run from completing normally.
- `failed`: evaluation-level orchestration failed; crash/startup recovery semantics are deferred.
- `cancelling → completed` is legal when all run terminal commits won before cancellation.
- Terminal states are immutable.

### 6.2 Run state machine

| From | Legal next states |
|---|---|
| `queued` | `acquiring_browser`, `cancelled`, `completed` (recovery only) |
| `acquiring_browser` | `connecting_browser`, `releasing_browser`, `cancelled`, `completed` (no acknowledged lease/recovery) |
| `connecting_browser` | `discovering`, `releasing_browser`, `cancelled`, `completed` (recovery only) |
| `discovering` | `running_agent`, `releasing_browser`, `cancelled`, `completed` (recovery only) |
| `running_agent` | `grading`, `releasing_browser`, `cancelled`, `completed` (recovery only) |
| `grading` | `releasing_browser`, `cancelled`, `completed` (only without lease or recovery) |
| `releasing_browser` | `completed`, `cancelled` |
| `completed`, `cancelled` | none |

Normal execution follows the linear happy path. Recovery-only edges are schema-reserved for post-submission work, are not implemented in Submission P0, and must be rejected from ordinary orchestration. Any state may enter `releasing_browser` only when a lease may exist.

A completed run has one outcome:

- `passed`: deterministic cart predicates all pass.
- `failed`: trusted evidence proves the goal was not achieved, including a valid budget exhaustion or wrong cart state.
- `inconclusive`: infrastructure, provider protocol, target availability, or grading evidence prevented a trustworthy result.

A cancelled run has no outcome. Cleanup failure never overwrites a grade; it adds a warning and `potentialSessionLeak`.

### 6.3 Failure classification

Use stable categories plus a code, phase, retryability, redacted message, and optional redacted cause chain:

- `navigation`
- `ambiguity`
- `tool_error`
- `timeout`
- `incorrect_state`
- `unsupported_interface`
- `infrastructure`
- `model_provider`
- `grading`
- `policy`
- `cancellation`
- `unknown`

Outcome mapping is frozen with the taxonomy:

| Condition | Outcome | Category/code |
|---|---|---|
| correct cart predicates | `passed` | none |
| wrong/missing cart state | `failed` | `incorrect_state/task_incorrect` |
| model finishes before cart mutation | `failed` | `incorrect_state/task_not_completed` |
| off-origin or forbidden action blocked | `failed` | `policy/navigation_blocked` |
| wall/action/tool budget exhausted after at least one successful browser mutation | `failed` | `timeout/budget_exhausted` |
| wall clock expires before any successful browser action because provider/CDP latency consumed the budget | `inconclusive` | `infrastructure/latency_budget_exhausted` |
| stale-element retries exhausted | `failed` | `tool_error/stale_element_exhausted` |
| WebMCP absent/schema drift with semantic fallback available | no terminal outcome | `unsupported_interface/webmcp_degraded` warning |
| Solari acquisition/CDP connection unavailable | `inconclusive` | `infrastructure/solari_unavailable` |
| OpenRouter malformed/protocol failure | `inconclusive` | `model_provider/provider_protocol_error` |
| demo challenge provisioning or repeatable target 5xx | `inconclusive` | `infrastructure/target_unavailable` |
| grade evidence missing, corrupt, stale, or revision-mismatched | `inconclusive` | `grading/invalid_evidence` |
| user cancellation | no outcome | `cancellation/user_requested` |

Every category/code pair has exactly one permitted outcome in tests. Recoverable conditions such as one stale ref do not terminalize a run. The deterministic causal classifier is P0. The separate structured model explanation from the original brief is P1 and uses cautious language; it cannot change the outcome/category.

### 6.4 Submission cancellation and shutdown scope

P0 does not expose cancellation as a judged-path requirement. Run timeouts and process shutdown use one evaluation-level `AbortController`: stop starting work, abort provider/browser operations where supported, then execute each known lease’s `finally` cleanup with an independent timeout. If a simple cancel button fits after the repeated-run slice, it triggers the same mechanism without promising transactional race semantics.

Complex cancel linearization, queued-versus-grading race resolution, clone/recovery behavior, and automatic startup reconciliation are post-submission hardening. The plan retains `cancelling`/`cancelled` contract values so later work does not require a schema break, but these paths cannot delay Submission P0.

### 6.5 Persisted event envelope

```text
EventEnvelopeV1
- schemaVersion: 1
- eventId: UUIDv7
- cursor: decimal string backed by SQLite integer primary key
- evaluationId: UUIDv7
- runId: UUIDv7 | null
- runSequence: non-negative integer | null
- type: closed EventType
- occurredAt: producer UTC timestamp
- recordedAt: persistence UTC timestamp
- payload: event-specific validated, redacted object
```

Ordering and delivery:

- `cursor` is the authoritative total persisted order; `runSequence` is monotonic per run.
- `eventId` is unique and duplicate appends are idempotent.
- State transition plus matching event append occurs in one DB transaction.
- The P0 UI loads an authoritative snapshot, remembers its latest cursor, then applies new SSE milestones idempotently by `eventId`; full durable cursor replay is deferred.
- `occurredAt` is display metadata, not ordering authority.

P0 event types preserve the brief’s product vocabulary; cancellation/recovery event variants are reserved for later hardening:

```text
evaluation.created / started / cancel_requested / completed / cancelled / failed
run.queued / started / status_changed / browser.ready
run.discovery.completed / agent.iteration / agent.message
run.tool.started / tool.completed / usage.updated
run.grade.started / grade.completed
run.passed / failed / inconclusive / cancelled
run.replay.ready / replay.status_changed / warning
system.capability.changed / recovery.performed (reserved, hardening only)
```

### 6.6 TanStack AI event mapping

Do not expose `toServerSentEventsResponse(chatStream)` directly to the reviewer UI. Consume the stream server-side and map it:

| TanStack/AG-UI source | TraceGate behavior |
|---|---|
| `RUN_STARTED` | enter `running_agent` if not already emitted |
| message deltas | keep ephemeral for optional live text; persist only the bounded final/iteration summary, never token deltas |
| `TOOL_CALL_START` + complete args | validate/redact and append one `run.tool.started` |
| tool result/end | append one summarized `run.tool.completed` |
| usage callback | accumulate and emit throttled `run.usage.updated` |
| `RUN_FINISHED` | flush summary and move to grading |
| `RUN_ERROR`/malformed event | classify, preserve safe diagnostic, then cleanup |
| unknown event | emit bounded warning, never persist the raw object |

---

## 7. Execution design

### 7.1 Durable run expansion and queue

On `POST /api/evaluations`:

1. Validate configuration and capability gates.
2. Create the evaluation, N run rows, and `run.queued` milestones in one repository operation.
3. Assign stable `runIndex`, denormalized `modelId`, and opaque demo challenge token hash. The fixed store is identical across repetitions; variance comes from persisted sampling/provider configuration, not hidden layout changes.
4. Enqueue only after durable creation. HTTP idempotency-key semantics are post-submission hardening.

P0 accepts one active evaluation at a time, so the scheduler uses one process-global FIFO queue in durable creation order; no unused cross-evaluation fairness mechanism is built. A run consumes a permit immediately before Solari session creation. Effective capacity is:

```text
min(requested concurrency, configured maximum, measured Solari capacity)
```

Start at one until the Solari spike records a safe cap. On `429 ConcurrencyLimitExceeded`, release the local permit, lower capacity by one (floor one), honor `Retry-After` or use capped exponential backoff with jitter, and requeue the same run. After three acquisition attempts or its deadline, mark it inconclusive. After a limit error, effective capacity never increases again in the same process; only an explicit capability refresh or restart may reset it. Never create a duplicate run row.

### 7.2 Solari lifecycle

For every run:

```text
persist acquiring_browser
  → create Solari Browser through the verified SDK path (recording only if capability-verified)
  → validate create response
  → immediately persist safe session ID/region/timestamps, never CDP capability URL
  → connect over CDP with timeout
  → provision run challenge through DemoAdminPort on adminBaseUrl
  → install popup/dialog/download/navigation policy handlers
  → navigate to run-specific publicBaseUrl challenge URL
  → discover interfaces and observe
  → execute TanStack AI loop
  → deterministic grade
  → close CDP client
  → release Solari session
  → free queue permit
  → poll replay status briefly
  → persist terminal outcome + cleanup/replay status
```

All paths after receiving a provider session ID run release in `finally`: connection failure, model error, timeout, shutdown, grading failure, or persistence error. Release is idempotent; already released/not found is success. Every successfully acknowledged session must have a release result before final acceptance. Ambiguous create-response reconciliation and provider-side session sweeping remain post-submission hardening.

### 7.3 Connectivity gate

Before the vertical slice:

1. Start the production-shaped `apps/demo` locally.
2. Expose it through the available HTTPS tunnel.
3. From a real Solari Browser, prove DNS/TLS, render a temporary semantic connectivity form, submit one server-state mutation, and verify it through a server-to-server admin read.
4. Record tunnel command, origin shape, latency, teardown, and redacted evidence. Full Classic Tee/cart proof occurs at the single-run checkpoint.
5. If the tunnel is unavailable/unreliable, run one reusable Demo Store process in a Solari Sandbox and expose `sandbox.previewUrl(port)`; repeat the proof.
6. Freeze the selected `DemoConnectivityProvider` and allowed origin.

If both paths fail, P0 is blocked. Do not use local Playwright or scripted results as a judged-path substitute. A per-run Sandbox remains optional P2; a single reusable Sandbox used only to host the demo is a connectivity fallback, not the agent runtime.

### 7.4 TanStack AI agent loop

`packages/ai` owns adapter construction, model registry, Zod-backed TanStack tool definitions, structured output, AG-UI consumption, and usage normalization. `packages/agent` owns trusted prompt layering, `AgentRunContext`, budgets, action policy, and loop completion semantics.

Use `openRouterText(modelId)` first; the Responses adapter is enabled only if the spike proves equivalent tools/stream behavior. The compatibility probe must exercise the production-shaped path: multiple and provider-proposed parallel tool calls, tool errors, strict structured output, streaming event order, socket-level cancellation propagation, usage callbacks, provider routing, and malformed responses. P0 serializes tool execution through a per-run mutex and forces a fresh observation after each mutating action; parallel model proposals never execute browser mutations concurrently. Only verified models appear in the selector; at least DeepSeek must pass for P0.

The model can call only:

```text
navigate
inspect
click
type
select
pressKey
scroll
wait
callNativeTool     # only for normalized, policy-allowed WebMCP tools
finish             # belief only, never a grade
```

No arbitrary JavaScript, CSS selectors, XPath, CDP, HTTP headers, network requests, filesystem paths, session IDs, or replay capabilities are model-visible.

`packages/agent` owns the single executor wrapper over `BrowserController`; `packages/ai` only adapts that executor into TanStack `toolDefinition(...).server(...)` definitions.

Every tool call:

1. increments the tool-call count, including invalid calls;
2. validates Zod input;
3. checks cancellation and monotonic wall-clock deadline;
4. enforces exact-origin/action policy;
5. increments browser-action count where applicable;
6. runs under a per-tool timeout;
7. returns a bounded structured result explicitly labeled untrusted;
8. emits redacted start/completion milestones.

`finish({ completed, summary })` ends acting intent but grading always follows. The agent runner compacts conversation history before each model turn: keep the latest observation verbatim, replace superseded observation results with a one-line revision/element-count stub, retain tool calls and short results, and refuse a new turn if `maxHistoryBytes` or `maxTotalTokens` is exhausted. Persist sampling parameters and the resolved OpenRouter provider per run so repeated results are auditable. On cancellation, wait only a short spike-verified grace period for the provider stream; then detach the consumer, emit a warning, mark cancelled, and release the browser even if the upstream socket does not close.

### 7.5 Compact semantic observation and refs

`inspect` returns `AgentObservationV1`:

```text
revision, redacted URL, title, bounded visibleText,
nativeTools[], elements[], discoverySummary, truncated
```

Each element includes an opaque ref such as `e:7:12`, role, accessible name, disabled/checked/selected/expanded state, and allowlisted attributes. It never contains a raw selector.

The run-scoped `ElementRegistry`:

- increments revision on each observation;
- orders elements deterministically by DOM order and prioritizes visible enabled controls;
- retains internal handles/locator recipes only in memory;
- accepts actions only against the latest revision;
- rechecks connected/visible/semantic identity before acting;
- returns recoverable `stale_element` or `ambiguous_element` errors and requires a new observation;
- never fuzzy-resolves a stale ref to a different control;
- supports the main frame in P0 and reports cross-origin iframe controls as unavailable.

Normalize whitespace, redact query/challenge tokens, cap interactive elements (initially 100), and truncate UTF-8 observations at field boundaries within `maxObservationBytes`.

### 7.6 Discovery and trust policy

At initial navigation and meaningful URL/state changes:

- always build semantic controls;
- fetch only same-origin `/llms.txt`, max 64 KiB, no cross-origin redirect; persist status/hash/size/bounded preview;
- parse current-page `application/ld+json`, max 64 KiB combined; persist discovered schema types and safe metadata;
- probe WebMCP only when capability/configuration allows it.

WebMCP gate states:

```text
unavailable | available_disabled | discover_only | allowlisted_demo_tools
```

Invocation additionally requires a secure context, current confirmed API, exact controlled-demo origin, supported bounded JSON Schema, exact allowlisted tool names (`search_products`, `get_product`, `add_to_cart`, `view_cart`), and the same time/count/redaction budgets as semantic tools.

| `interfaceMode` | Discovery/invocation behavior |
|---|---|
| `semantic-only` | WebMCP gate is `available_disabled`; `callNativeTool` returns structured `unsupported_interface` |
| `auto` | discover; invoke only when runtime gate reaches `allowlisted_demo_tools`, otherwise semantic fallback |
| `native-allowed` | require `allowlisted_demo_tools` at config validation or reject the evaluation |

`packages/discovery` owns the per-run gate and `apps/web` publishes its capability summary. `callNativeTool` remains in the frozen P0 tool schema so the model-facing contract does not change; it fails safely unless invocation is allowed. Descriptions, schemas, arguments, and results remain untrusted. Absence or schema drift emits a warning and falls back to semantic UI without changing the P0 path.

### 7.7 Controlled Demo Store and grading

Implement exactly the brief’s scenario: **find Classic Tee, choose size M, and add it to the cart**.

Each run receives an opaque challenge URL:

```text
{publicBaseUrl}/runs/{opaqueChallengeToken}
```

The Demo Store exposes Classic Tee, Performance Tee, and Running Shorts; a Classic Tee product page with S/M/L controls; add-to-cart; and cart view. It uses semantic HTML, associated labels, status announcements, JSON-LD Product/Offer metadata, `/llms.txt`, and gated WebMCP registration when supported.

Server-side demo state is explicitly provisioned before browser navigation through `DemoAdminPort.createChallenge` and isolated by hashed challenge token. It contains the cart, mutation revision, run ID, creation/expiry timestamps, and scenario ID. For P0 it may be an in-memory bounded store, but it must cap live challenges, sweep expired entries, and classify a demo restart during an active run as `infrastructure/target_evidence_lost` → inconclusive.

The browser never receives the demo admin secret. The grader calls `adminBaseUrl` server-to-server; in preferred tunnel mode this is loopback while only `publicBaseUrl` is tunneled. In Sandbox fallback it is a protected preview URL. Admin routes reject requests with navigation-shaped `Origin`/`Referer`/`Sec-Fetch-Mode`, return 404 without the bearer, and never appear in navigation links. The grader validates the shared response schema, run ID, challenge hash, freshness, and revision.

Deterministic grade predicates:

```text
cart contains exactly one line item
that line item is product "Classic Tee"
variant/size is exactly "M"
quantity is exactly 1
```

All must pass. Valid evidence with wrong/missing state is `failed`; unavailable or invalid evidence is `inconclusive`. The model’s summary is ignored. Store per-predicate results and bounded expected/actual summaries atomically with the terminal outcome.

P1 failure analysis uses a separate TanStack AI structured-output call with the brief’s cautious categories and cannot modify the deterministic result.

### 7.8 Reliability aggregation

Always show raw counts:

```text
requested, started, passed, failed, inconclusive, cancelled, potential leaks
```

Primary metric:

```text
end-to-end pass rate = passed / requested runs
```

Also show, clearly labeled:

```text
gradeable task success = passed / (passed + failed)
```

Display numerator and denominator next to every percentage and state that the result is conditional on the persisted model, sampling, and resolved provider configuration. A zero denominator is “Not available.” Inconclusive/cancelled runs are never silently omitted. Three-run results are labeled descriptive, not statistically significant. Median duration/steps use terminal measured runs and state their included statuses. Tool/interface counts come from persisted run steps, never hard-coded values.

---

## 8. Persistence, API, and streaming

### 8.1 Drizzle/libSQL design

Use `@libsql/client`, Drizzle ORM, and Drizzle Kit with local `file:` SQLite for development. Enable WAL, foreign keys, and bounded busy timeout. Serialize writes through one process-local writer queue and use short-lived read transactions; three concurrent runs must not compete through ad hoc writers. Keep the schema compatible with remote libSQL/Turso but do not introduce a remote DB in P0.

Initial tables:

- Drizzle migration journal/files generated by Drizzle Kit; no custom migration hash system in Submission P0.
- `capability_checks`: kind, subject, status, bounded details JSON, checked timestamp.
- `evaluations`: brief fields plus schema version, config JSON, status, start/finish timestamps, failure JSON.
- `runs`: evaluation ID, unique `run_index` within evaluation, denormalized model ID, resolved provider, status/outcome, timing, iterations/tool calls/browser actions, token usage, grader/failure fields, replay status, potential leak.
- `run_steps`: run sequence, event/action type, redacted payload JSON, interaction mode, observation summary, duration, timestamp.
- `events`: autoincrement cursor, event ID, evaluation/run IDs, run sequence, type/version/timestamps, redacted payload JSON.
- `discovered_interfaces`: run, kind (`webmcp`, `llms_txt`, `semantic`, `json_ld`), name, bounded metadata JSON, timestamp.
- `browser_sessions`: run ID, provider session ID after successful creation, region, recording/release/replay status, safe metadata, acquire/release timestamps. Never store CDP endpoints or presigned replay URLs. Ambiguous-create attempt reconciliation is deferred; Submission P0 must still release every session whose ID was successfully received.
- `grade_results`: run, scenario, evidence revision, predicates JSON, outcome, timestamp.

Constraints/indexes are explicit: unique `(evaluation_id, run_index)` on runs; unique `event_id`; indexes on `(evaluation_id, cursor)` and `(run_id, run_sequence)` for events; indexes on `run_id` for browser sessions and discovered interfaces. Unknown usage/cost remains `NULL`, never zero. Use Drizzle repositories for atomic run/result writes, milestone append, report queries, and snapshot reads.

Apply the initial Drizzle migration before accepting requests. Migration hash verification, rollback automation, recovery scans, and event-retention/pruning policies are post-submission hardening.

### 8.2 Server API

TanStack Start server routes:

| Route | Responsibility |
|---|---|
| `GET /api/capabilities` | runtime, model, connectivity, Solari, recording/replay, WebMCP gates |
| `POST /api/evaluations` | validate, create run rows, enqueue |
| `GET /api/evaluations/:id` | authoritative snapshot/report plus latest event cursor |
| `GET /api/evaluations/:id/events` | live TraceGate milestone SSE after snapshot |
| `POST /api/runs/:id/replay-access` | P1: request current short-lived replay access without persistence |
| `GET /api/health` | liveness, migration, and scheduling health |

All bodies/responses use shared Zod schemas. Errors contain stable code, safe message, request ID, retryability, and field issues.

### 8.3 Submission P0 SSE

Use a deliberately small transport:

```text
persist product milestone/run step
  → publish it through process-local pub/sub
  → SSE to the live page
```

The live route first fetches `GET /api/evaluations/:id` for the authoritative snapshot and latest cursor, then opens SSE for new events. On disconnect it refetches the snapshot and reconnects with capped backoff. Send a 15-second heartbeat, dispose subscriptions on disconnect, bound each serialized milestone, and never stream/persist raw token deltas.

Durable arbitrary-cursor replay, `410 CursorExpired`, query/subscribe race elimination, retained-event catch-up, sophisticated slow-consumer backpressure, and event pruning are post-submission hardening. SQLite remains the trace/report source of truth; it is not used as a distributed event broker in Submission P0.

---

## 9. Security and replay

### 9.1 Trust hierarchy

```text
TraceGate policy
  → user goal and budgets
    ---------------- untrusted boundary ----------------
    → page content, semantic observation, llms.txt, JSON-LD
    → WebMCP metadata/schemas/results
    → model-proposed arguments and provider errors
```

Required controls:

- exact-origin allowlist before and after navigation;
- allow only HTTP(S); reject credentials in URLs and `file:`, `data:`, `javascript:`, `blob:`, browser-internal schemes, unexpected ports/origins;
- block downloads, off-origin popups, permissions, clipboard reads, and file chooser interactions;
- no arbitrary page JavaScript, network, filesystem, shell, or secrets tools;
- central redactor removes known secrets, authorization headers, CDP capabilities, challenge tokens, replay URLs, and suspicious query values before persistence/logging/SSE;
- bound every observation, discovery document, tool schema/result, provider error, and trace payload;
- system prompt explicitly labels website/discovery content untrusted and unable to change policy;
- `apps/web/src/server/lifecycle.ts` owns idempotent boot and shutdown around TanStack Start: migrate → create one DB/queue/SSE/abort-controller instance → mark healthy;
- judged runs use the built server, not HMR dev mode;
- `SIGINT`/`SIGTERM` stop dispatch, abort active runs, release known leases with a bounded independent timeout, flush terminal warnings/events, then close the DB;
- local control plane binds to loopback, rejects unexpected `Origin`/`Host` on mutations, and requires explicit unsupported configuration to bind publicly.

### 9.2 Replay lifecycle

Replay state is independent of run outcome:

```text
not_requested | unsupported | recording | pending | ready | failed
```

- Request recording only when capability-verified and configured.
- Persist stable Solari session/replay reference and status, never the presigned URL.
- Release the browser permit before background replay reconciliation.
- P1 polls for a bounded spike-verified window after release; show `ready`, `pending`, `unsupported`, or `failed` honestly.
- When ready, request/open replay access without persisting the presigned URL and return `Cache-Control: no-store` plus `Referrer-Policy: no-referrer`.
- Background/startup reconciliation, automatic expired-URL refresh, and durable replay lifecycle recovery are post-submission hardening.
- Keep the URL only in component memory and clear it when playback closes.
- Never put it in DB, SSE, logs, analytics, exports, clipboard defaults, or TraceGate-controlled browser history.
- Refresh once on expiry; continued failure is an actionable replay error and never changes the run outcome.

---

## 10. UX specification

### Configure/landing

Keep a short hero and immediately show the prefilled evaluation form. Display capability status without turning the page into a settings screen. DeepSeek is selected when verified; other models appear only after their probes pass. Runs default to three/max five. Start is disabled only for P0 blockers (no demo connectivity, no verified model, or unhealthy DB), with an explicit explanation.

### Live execution

Show all run cards simultaneously with:

- run number/model/status and elapsed time;
- explicit Solari Browser → Discovery → LLM → Tool pipeline;
- interface mode (WebMCP/Semantic UI);
- current safe action summary;
- step/tool count against budget;
- queued/running/terminal counts;
- replay/cleanup warning state;
- reconnect status while retaining/refetching the last snapshot;
- optional simple cancel action only if it does not delay the judged run path.

Do not add live video. Screenshot thumbnails are P2 unless Solari makes capture trivial.

### Report

Top-level report includes raw counts, end-to-end pass rate with denominator, gradeable success, median time/steps, native calls, UI actions, model, and capability evidence timestamp. Add a prominent `EXECUTION ENVIRONMENT` card showing Solari Browser, acknowledged independent-session count, model/resolved provider, active interface mode, recording/replay status, WebMCP availability, `llms.txt`, and JSON-LD types from measured data. Run rows show deterministic predicates, failure category/explanation, interaction chain, usage when known, cleanup status, trace, and replay action. Inconclusive/cancelled runs stay beside PASS/FAIL. Agent interfaces (`WebMCP`, `llms.txt`, Semantic UI, JSON-LD, vision fallback) are a first-class section, not buried logs.

Use the requested developer-tool visual direction: compact cards, strong typography, subtle borders, monospace traces, clear status text/icons, light theme first with robust dark mode, reduced motion, keyboard operation, visible focus, semantic headings/tables, and status communicated by more than color. Avoid generic AI gradients, glowing blobs, robot art, and excessive glass.

### Submission assets

The README opens with the thesis and local/deployed demo URL, then a short real GIF/video, repeated-reliability rationale, architecture diagram, agent-interface explanation, TanStack AI responsibilities, Solari Browser/Sandbox/Recording roles, exact setup/probe commands, capability limitations, and truthful sample traces. The 30–60 second video follows configure → three visible Solari runs → measured report → failed/inconclusive trace and replay when available → optional measured native-vs-UI result. If all runs pass, show that real outcome; a separate previously captured real failure may be labeled as an example but never edited into the live evaluation. Finish with “Built with Solari.”

---

## 11. Scope cut line

### Submission P0 — must work before enhancements

- public cookbook fork with TraceGate under `examples/tracegate/`;
- controlled Demo Store and hardened deterministic cart evidence;
- TanStack Start configure/live/report UI;
- OpenRouter + verified DeepSeek through TanStack AI tools;
- one acknowledged, independently isolated Solari Browser per run;
- semantic observation, opaque refs, bounded tool vocabulary and budgets;
- one real end-to-end vertical slice, then three repeated executions;
- basic measured concurrency limiter;
- PASS / FAIL / INCONCLUSIVE with explicit denominators;
- persisted run/result/trace milestones in Drizzle/libSQL;
- simple snapshot + live SSE progress;
- semantic interface count plus cheap `llms.txt` and JSON-LD detection/display;
- guaranteed `finally` cleanup for every acknowledged browser session;
- polished report including execution-environment evidence;
- README, architecture diagram, real GIF/video, and submission checklist.

### High-value P1 — implement in this order after repeated P0

1. Solari recording/replay when the spike proves entitlement and API behavior.
2. Interface-report polish for `llms.txt`/JSON-LD and WebMCP detection.
3. Model selector, Mistral/GPT-5 Mini, and usage accounting for probe-verified models.
4. Allowlisted WebMCP invocation if supported.
5. Structured failure explanation in a separate non-authoritative model call.

Replay/WebMCP/model-option absence never blocks Submission P0.

### P2 — optional comparison and visual polish

Per-run Solari Sandbox; native-vs-UI comparison using measured values; screenshots; cost calculation; cross-model reliability matrix; polished animations. Exclude arbitrary external URLs unless a separate SSRF/security design is completed.

### Post-submission hardening — specified but not on the build critical path

Durable arbitrary-cursor SSE replay; cursor expiration/retention; advanced backpressure; HTTP idempotency semantics; complex cancellation races; crash/startup recovery; ambiguous browser-create reconciliation/provider sweeps; replay URL refresh/reconciliation; migration hash/rollback automation; event retention/pruning; cross-evaluation fairness; production deployment/tenancy.

### Never cut

Deterministic grading, Solari-backed judged runs, cleanup of acknowledged sessions, bounded/redacted persisted traces, result denominators, server-only secrets, URL/action policy, and honest capability/outcome reporting.

---

## 12. Four-agent collaboration model

### Exclusive ownership

| Agent | Exclusive paths | Responsibilities |
|---|---|---|
| **A — Integration/evaluation** | root configs, `packages/shared`, `packages/evaluation`, `packages/grading`, `tests/e2e`, final lockfile | contracts, state/event semantics, queue/orchestrator, grader, aggregation, merge owner |
| **B — Solari/target/discovery** | `packages/solari`, `packages/discovery`, `apps/demo` | connectivity spike, Demo Store, CDP/ref observation, lifecycle, cleanup, replay, WebMCP discovery |
| **C — AI/agent runtime** | `packages/ai`, `packages/agent` | TanStack/OpenRouter probe, models, prompts, tools, budgets, event mapping, failure-analysis call |
| **D — Data/product UI** | `packages/db`, `packages/ui`, `apps/web` | Drizzle/libSQL, repositories, TanStack Start API/SSE, configure/live/report UI |

Only Agent A edits `packages/shared`, root workspace config, or `pnpm-lock.yaml` after contract freeze. Agent C may finish earlier than other lanes; after its owned acceptance criteria pass, it supports integration through tests or reviewed change requests rather than editing another owner’s files directly.

### Conflict and merge discipline

- No agent edits another lane’s paths or performs drive-by formatting.
- Cross-lane needs use frozen ports; temporary concrete imports are rejected.
- Contract changes name affected schemas/events, compatibility impact, and fixtures; they land only at checkpoints.
- Agents omit independent lockfile edits; Agent A regenerates it after manifest merge.
- Every merge includes commands/evidence and redaction review.
- Red verification, an unmatched browser session, or a secret-shaped fixture in persistence blocks the next wave.
- Measured result rows are immutable; no manual editing to improve the submission.

### Parallel waves

**Wave 0 — feasibility and contracts (all four in parallel after runtime preflight)**

- A: draft shared Zod contracts/state machines.
- B: Solari/CDP/connectivity/concurrency/replay spike against a minimal real Demo Store page.
- C: TanStack/OpenRouter streaming tool-loop probes for all three models.
- D: Drizzle/libSQL milestone persistence, authoritative snapshot, and simple TanStack Start pub/sub SSE feasibility.

**Checkpoint 1 (`TG-006`)**: select connectivity, record account/model capabilities, pin dependencies, freeze contracts, create `AGENTS.md`, and acknowledge ownership.

**Wave 1 — single-run vertical slice**

- A: transitions, queue shell, run executor, deterministic cart grader.
- B: Demo Store, Solari lease, semantic controller/refs.
- C: DeepSeek agent loop/tools/budgets/event mapper.
- D: migrations/repositories, API/SSE, minimal configure/live UI.

**Checkpoint 2 (`TG-011`)**: merge shared → DB → demo/Solari/discovery → AI/agent → evaluation/grading → app composition; regenerate lockfile; prove one real run end-to-end.

**Wave 2 — repeated reliability and report**

- A: N-run orchestration, aggregation, outcome/failure classifier, and only minimal abort/finally cleanup semantics.
- B: three-session acknowledged cleanup plus semantic/llms.txt/JSON-LD/WebMCP-availability evidence; begin replay only after P0 lane acceptance.
- C: required provider failure handling and security; optional models/usage/failure explanation are non-blocking P1.
- D: simple snapshot/SSE projection and complete configure/live/report/environment-evidence UI.

**Checkpoint 3 (`TG-016`)**: prove a real three-run evaluation at measured safe concurrency, truthful denominators, trace visibility, and zero unaccounted sessions.

**Wave 3 — verification and submission polish**

Each agent hardens its lane in parallel; A performs final merge, full suite, leak/security review, README, screenshots/video evidence, and explicit P1/P2 omissions.

---

## 13. Error and edge-case matrix

| Case | Required behavior |
|---|---|
| No verified model | disable start and show probe evidence |
| No Solari-to-demo route | mark P0 blocked; never substitute local results |
| Empty/invalid run count | reject before durable creation |
| DB busy/full/corrupt | stop new scheduling, preserve active cleanup, surface evaluation failure |
| Solari 429 | reduce capacity and bounded requeue without duplicate run |
| Missing/invalid CDP endpoint | release session, mark inconclusive |
| Demo challenge provisioning fails | do not navigate; mark target unavailable/inconclusive and cleanup |
| Demo process restarts/evidence disappears | target evidence lost/inconclusive; expiry sweep bounds stale state |
| Disconnect after possible cart mutation | attempt deterministic grade only if trusted evidence is available; always cleanup |
| Popup/dialog/download | dismiss/block per policy and emit warning |
| Cross-origin redirect | abort action and classify policy failure |
| Stale/ambiguous ref | recoverable tool error; require fresh inspect |
| Oversized observation/schema/result | deterministic truncation plus `truncated` flag |
| Provider malformed event | abort agent, classify protocol error, keep raw data ephemeral only |
| Usage absent | persist NULL, display unavailable |
| Model claims success but cart is wrong | deterministic fail |
| Grader evidence missing/corrupt | inconclusive, not fail |
| Refresh/SSE disconnect | refetch authoritative snapshot and reconnect live stream |
| Replay never finalizes | pending/failed replay only; grade unchanged |
| Zero gradeable runs | no gradeable percentage; show raw statuses |
| WebMCP unavailable/changed | warning and semantic fallback |
| Synthetic fault tests | isolated DB/evidence; never normal report pipeline |

Deferred error cases—duplicate HTTP create/idempotency, ambiguous Solari create acknowledgement, cancellation races, cursor expiry/slow-consumer recovery, and process-crash reconciliation—belong to post-submission hardening and must not expand Submission P0.

---

## 14. Tradeoffs and rejected alternatives

| Decision | Rejected alternative and rationale |
|---|---|
| TanStack Start long-lived local process | Fastify/Vite split would violate the requested application stack and add an unnecessary framework |
| Requested packages grouped under four owners | Eight independent workers create contract churn; collapsing everything into five packages would obscure explicit brief responsibilities |
| CDP default | native wire may be faster but is more version-sensitive |
| Persisted TraceGate events before SSE | direct TanStack SSE bypasses durable ordering, redaction, reconnect, and reporting vocabulary |
| SSE | WebSockets add bidirectional complexity; cancellation is ordinary HTTP |
| Drizzle/libSQL | raw SQLite migrations would violate the required persistence stack |
| Server challenge state | browser-only localStorage is simpler but gives the grader a weaker and less auditable source of truth |
| Deterministic store grader | model self-grading cannot prove correctness |
| Opaque semantic refs | selectors/arbitrary JS are brittle and unsafe |
| Explicit inconclusive outcome | folding infrastructure errors into FAIL corrupts website reliability measurements |
| Fresh replay access | durable presigned URLs expire and are bearer capabilities |
| No automatic interrupted retry | reruns can duplicate side effects and change denominators |
| Tunnel first, one Sandbox fallback | per-run Sandbox conflicts with account limits and is P2 |
| Semantic baseline | WebMCP is still experimental and cannot be the critical path |

---

## 15. File-by-file impact

After TG-000, all paths in this section are relative to `solari-cookbook/examples/tracegate/`; the planning-stage file is moved into that subtree.

| Path | Planned responsibility |
|---|---|
| root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.node-version`, `.npmrc` | exact toolchain pins, Turbo tasks, frozen lockfile policy |
| `AGENTS.md` | four-lane ownership, commands, contract-change/merge rules |
| `.env.example` | server-only OpenRouter/Solari/DB/demo/tunnel variables without values |
| `packages/shared/src/{ids,config,env,states,events,api,ports,redaction}.ts`, `testing/*` | frozen Zod/type source, central redactor/env schema, canonical fake ports/fixtures |
| `packages/db/src/{schema,client,migrate,repositories}.ts` and `drizzle.config.ts` | Drizzle/libSQL schema, initial migration, evaluation/run/step/report repositories |
| `packages/solari/src/{client,browser-provider,browser-controller,replay}.ts` | create/connect/release/replay and safe browser action adapter |
| `packages/discovery/src/{observation,element-registry,semantic,llms-txt,json-ld,webmcp,policy}.ts` | bounded discovery and untrusted-interface normalization |
| `packages/ai/src/{provider,models,compatibility,event-mapper,tools,failure-analyzer}.ts` | TanStack/OpenRouter-only integration, tool adapters, usage/events, explanation model call |
| `packages/agent/src/{run-context,runtime-budget,prompt,runner,policy,trace}.ts` | product-owned execution semantics around AI/browser ports |
| `packages/grading/src/{demo-grader,failure-classifier,explanation}.ts` | deterministic evidence/outcome authority plus display-only wrapper over AI explanation; explanation cannot write run/grade outcomes |
| `packages/evaluation/src/{transitions,queue,orchestrator,run-executor,aggregation}.ts` | submission run lifecycle, bounded scheduling, outcomes, truthful report math |
| `packages/ui/src/*` | shadcn/Base UI primitives, status/trace/metric components, tokens |
| `apps/demo/src/{server,html,challenge-store,scenario,webmcp}.ts` | plain semantic store, isolated bounded cart state, hardened admin provisioning/evidence routes, discovery assets |
| `apps/web/src/routes/{index,evaluations.$id,runs.$id}.tsx` | configure/live/report route states |
| `apps/web/src/routes/api/*` | capabilities/evaluations/snapshot/events/health routes; P1 replay route only when enabled |
| `apps/web/src/server/{composition,sse,config,lifecycle}.ts` | concrete wiring, simple pub/sub stream, startup migration, known-lease signals/shutdown |
| `apps/web/src/lib/{api-client,event-projection}.ts` | typed client and idempotent event reducer/reconnect |
| `tests/e2e/*` | local and credentialed Solari vertical, repeated-run, snapshot/SSE, grading, interface-evidence, known-session cleanup tests |
| `docs/evidence/*` | redacted spike and acceptance evidence only |
| `README.md` | deployed/local URL, video/GIF, thesis, architecture, Solari/TanStack explanation, setup |

Each package also gets a manifest, TypeScript config, public `index.ts`, and colocated tests owned by its lane.

---

## 16. Verification strategy

### Commands

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e:local
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:check
pnpm probe:runtime
pnpm probe:models
pnpm probe:solari
pnpm test:e2e:solari
pnpm verify
```

Credentialed probes may report “not configured” during normal development, but the final P0 evidence must include successful configured runs. `pnpm verify` must not silently skip a configured suite.

### Automated coverage required before Submission P0

- Zod accept/reject fixtures for frozen API/config/action/result schemas.
- Submission state transitions, bounded queue capacity/retry/permit release, and no duplicate run IDs.
- Element-ref invalidation, observation truncation, exact-origin URL policy.
- TanStack event mapping, malformed provider events, and absent usage handling.
- Demo grader truth table, including exact-one-line-item and model-self-report irrelevance.
- PASS/FAIL/INCONCLUSIVE mapping and zero-denominator aggregation.
- Initial Drizzle migration plus evaluation/run/step snapshot queries.
- Snapshot load, new SSE milestone projection, refresh/refetch/reconnect.
- Redaction seeded with fake API keys, CDP URLs, challenge tokens, and replay URLs.
- Fifteen-turn history compaction and serialized parallel tool proposals.
- Admin-route navigation rejection and challenge provisioning/expiry.

Advanced cancellation races, startup recovery, idempotency, arbitrary cursor replay/expiration, slow-consumer backpressure, migration hashes, and retention are explicitly excluded from Submission P0 tests.

### Manual acceptance

1. Confirm the public GitHub repository is visibly a fork of `solari-sdk/solari-cookbook` and TraceGate is under `examples/tracegate/`.
2. Prove Solari can load and mutate the selected public demo route.
3. Run one DeepSeek execution and inspect real tool calls, deterministic grade, persisted trace, and release.
4. Run three repetitions; confirm unique acknowledged sessions/challenge state and no cross-run cart leakage.
5. Confirm observed concurrency never exceeds the measured cap and 429 degradation does not duplicate runs.
6. Close/reopen the live UI; confirm it refetches the authoritative snapshot and reconnects to new milestones.
7. Put hostile instructions in Demo Store content; confirm no off-origin navigation or secret access.
8. Mutate DOM between inspect and action; confirm stale ref fails safely.
9. Disable WebMCP; confirm semantic execution and interface evidence still work.
10. If replay is enabled, open it and verify no replay URL appears in SQLite, SSE, logs, history, or export.
11. Recalculate every displayed numerator, denominator, median, step count, interface count, and execution-environment field from DB/capability data.
12. Compare every acknowledged provider session to release records; any unreleased acknowledged session blocks acceptance.
13. Attempt browser navigation to public `/admin/*`; confirm it exposes no grading evidence while server-to-server grading works.
14. Send Ctrl-C/SIGTERM during active runs; confirm known leases receive bounded abort/release attempts before exit.
15. Record the video using only a real evaluation. A previously captured real failure may be shown separately only when clearly labeled; never splice it into the live result.

Spike and final evidence under `docs/evidence/` records exact versions/lockfile hash, timestamp/environment, connectivity route, Solari capacity/recording/replay behavior, per-model compatibility, WebMCP result, commands, and exit status. It must omit capabilities and secrets.

---

## 17. Risks and capability gates

| Risk | Gate/mitigation | Allowed degradation |
|---|---|---|
| Solari cannot reach demo | tunnel then Sandbox preview spike | none for P0; block honestly |
| account cap below 3 | measure and configure queue | sequential/lower-concurrency real runs |
| recording unavailable | capability probe | runs work; replay labeled unsupported |
| one optional model incompatible | per-model probe | hide that model |
| DeepSeek/all models incompatible | production-shaped probe | P0 blocked until one passes |
| TanStack API drift | exact compatible pins and adapter boundary | atomic upgrade only |
| CDP incompatibility | remote smoke test before fan-out | P0 blocked until adapter works |
| WebMCP absent/drifts | discover-only gate and normalization | semantic UI continues |
| SQLite unhealthy | single writer/short transactions/health gate | stop scheduling, cleanup active runs |
| replay finalization delayed | bounded P1 poll and honest pending state | evaluation completes, replay pending/omitted |
| prompt injection | restricted refs/tools/origins/redaction | unsafe action returns policy error |
| contract churn | freeze and sole owner | checkpointed change only |
| schedule pressure | explicit cut line | drop P2, then unstarted P1; never weaken P0 truth |

---

## 18. Implementation order and execution index

Size: **S** focused task, **M** roughly half an agent-day, **L** roughly one agent-day. Estimates are planning guidance, not measured outcomes.

### TG-000 — Public cookbook fork and project placement
- **Goal:** Establish the compliant judged repository before implementation begins.
- **Done when:** GitHub identifies the public repository as a fork of `solari-sdk/solari-cookbook`; the complete TraceGate workspace and this plan live under `examples/tracegate/`; the fork URL, upstream remote, submission branch, and visibility are recorded. If the current workspace is not that fork, stop and ask the user for the fork URL or permission to create it before coding.
- **Key files:** cookbook Git metadata, `examples/tracegate/docs/plans/tracegate-poc-build-2026-09-01.md`
- **Dependencies:** None
- **Size:** S

### TG-001 — Runtime/workspace preflight
- **Goal:** Verify exact Node, stable pnpm, TypeScript, Turbo, TanStack Start/AI, React, Zod, Drizzle/libSQL, Solari, and Playwright versions.
- **Done when:** Exact compatible pins, Corepack command, workspace scripts, and version evidence are approved; no dependency uses a floating range. TypeScript 7 is used when the full toolchain passes; if its native compiler/plugin compatibility blocks the vertical slice, pin the latest TypeScript 6 release, record the deviation, and do not mix compiler versions across packages.
- **Key files:** root configs, `docs/evidence/runtime.md`
- **Dependencies:** TG-000
- **Size:** S

### TG-002 — Solari/connectivity/entitlement spike
- **Goal:** Prove real Solari reachability to a minimal production-shaped demo fixture and measure create/CDP/release/concurrency/recording/replay plus tunnel/Sandbox connectivity.
- **Done when:** A temporary `__connectivity` semantic form is loaded from a real Solari Browser, its POST mutates server state, a server-to-server admin read verifies the mutation, one connectivity provider is selected, and cleanup/limit evidence exists—or P0 is explicitly blocked. Full Classic Tee/cart behavior belongs to TG-008.
- **Key files:** `apps/demo/src/__connectivity.ts`, `packages/solari`, `docs/evidence/solari-connectivity.md`
- **Dependencies:** TG-001
- **Size:** M

### TG-003 — TanStack/OpenRouter compatibility spike
- **Goal:** Test the pinned TanStack package family and all three exact model slugs with the production-shaped streaming tool loop.
- **Done when:** Each model has verified/failed evidence for tools, strict schema, usage, cancellation, error mapping, and at least DeepSeek or one declared P0 model passes.
- **Key files:** `packages/ai/src/compatibility.ts`, `docs/evidence/models.md`
- **Dependencies:** TG-001
- **Size:** M

### TG-004 — Shared contracts draft
- **Goal:** Define Zod entities, API/event envelopes, states, typed errors, and runtime ports.
- **Done when:** Closed variants and legal transitions have fixtures and all downstream lanes can compile against public surfaces.
- **Key files:** `packages/shared/src/*`
- **Dependencies:** TG-001
- **Size:** M

### TG-005 — Drizzle snapshot/milestone/SSE feasibility
- **Goal:** Prove Drizzle/libSQL writes, authoritative evaluation snapshots, persisted trace milestones, and simple process-local pub/sub SSE in TanStack Start.
- **Done when:** A spike creates and reads an evaluation snapshot, persists ordered run steps, publishes a new milestone live, and refresh/reconnect recovers through a fresh snapshot.
- **Key files:** `packages/db`, `apps/web/src/server/sse.ts`, `docs/evidence/persistence.md`
- **Dependencies:** TG-001, TG-004
- **Size:** S

### TG-006 — Contract and architecture freeze
- **Goal:** Incorporate spike facts, freeze contracts, select connectivity, pin dependencies, and authorize four-way fan-out.
- **Done when:** Fixtures pass, lockfile is generated, `AGENTS.md` records ownership, every gate has an explicit result, and all agents acknowledge interfaces.
- **Key files:** root configs, `AGENTS.md`, `packages/shared`, `pnpm-lock.yaml`, `docs/evidence`
- **Dependencies:** TG-002, TG-003, TG-004, TG-005
- **Size:** S

### TG-007 — Evaluation runtime and grader shell
- **Goal:** Implement the bounded one-evaluation queue, run executor, deterministic cart grader, outcome mapping, and fake-port tests.
- **Done when:** Submission state/queue/aggregation tests pass and the executor guarantees `finally` cleanup on every path after receiving a provider session ID.
- **Key files:** `packages/evaluation`, `packages/grading`
- **Dependencies:** TG-006
- **Size:** L

### TG-008 — Demo/Solari/discovery vertical slice
- **Goal:** Implement isolated Demo Store state, Solari lease/CDP controller, semantic observations, opaque refs, and safe actions.
- **Done when:** A real Solari Browser opens an isolated challenge, selects M, adds Classic Tee, exposes grade evidence, and releases without capability leakage.
- **Key files:** `apps/demo`, `packages/solari`, `packages/discovery`
- **Dependencies:** TG-006
- **Size:** L

### TG-009 — AI/agent vertical slice
- **Goal:** Implement DeepSeek `chat()` loop, prompts, Zod tools, independent budgets, finish semantics, and event mapping.
- **Done when:** Fake and real browser ports complete the loop; budget/timeout, malformed stream, bounded-history, serialized-tool, and redaction tests pass.
- **Key files:** `packages/ai`, `packages/agent`
- **Dependencies:** TG-006
- **Size:** L

### TG-010 — DB/API/simple SSE/minimal UI
- **Goal:** Implement the initial Drizzle migration/repositories, TanStack Start APIs, snapshot + process-local SSE, and minimal configure/live projection.
- **Done when:** An evaluation is durably created, rendered from its snapshot, receives live persisted milestones, and refetches/reconnects after refresh.
- **Key files:** `packages/db`, `apps/web`, `packages/ui`
- **Dependencies:** TG-006
- **Size:** L

### TG-011 — Single-run vertical checkpoint
- **Goal:** Compose Wave 1 into one real DeepSeek/Solari evaluation.
- **Done when:** One run performs real browser actions, persists trace/events, grades independently, renders live/report state, and confirms release.
- **Key files:** `apps/web/src/server/composition.ts`, `tests/e2e/single-run.test.ts`, lockfile
- **Dependencies:** TG-007, TG-008, TG-009, TG-010
- **Size:** M

### TG-012 — Repeated orchestration and truthful reporting
- **Goal:** Expand to three isolated runs, aggregate measured outcomes, classify PASS/FAIL/INCONCLUSIVE, and compute report metrics.
- **Done when:** Mixed/pass/inconclusive fixtures reconcile exactly and a real three-run evaluation completes at safe measured capacity with good 3/3 and mixed-result presentation.
- **Key files:** `packages/evaluation`, `packages/grading`, `tests/e2e/repeated-runs.test.ts`
- **Dependencies:** TG-011
- **Size:** M

### TG-013 — Submission cleanup and interface evidence
- **Goal:** Verify cleanup of every acknowledged session and surface semantic control count, `llms.txt`, JSON-LD, and WebMCP availability in the report.
- **Done when:** acknowledged sessions all have release results, interface evidence is measured/persisted/displayed, and unavailable WebMCP leaves semantic execution unchanged.
- **Key files:** `packages/solari`, `packages/discovery`, `apps/demo`
- **Dependencies:** TG-011
- **Size:** M

### TG-014 — High-value P1 enhancements (non-blocking)
- **Goal:** First add capability-verified Solari recording/replay, then interface-report polish, optional models/usage, allowlisted WebMCP invocation, and structured failure explanation as time permits.
- **Done when:** each started enhancement is either verified end-to-end or honestly labeled unsupported/omitted; replay URLs remain ephemeral and no enhancement changes deterministic outcomes. This item is not a dependency of Submission P0.
- **Key files:** `packages/solari`, `packages/discovery`, `packages/ai`, `packages/agent`, `apps/web`
- **Dependencies:** TG-011
- **Size:** M

### TG-015 — Complete product UX
- **Goal:** Finish capability-aware configure, simultaneous live run cards, report/traces/interfaces, snapshot reconnect, execution-environment evidence, 3/3/mixed-result states, and visual/accessibility polish.
- **Done when:** every P0 state and degradation is understandable, keyboard-accessible, responsive, and driven only by persisted data.
- **Key files:** `apps/web`, `packages/ui`
- **Dependencies:** TG-011
- **Size:** L

### TG-016 — P0 feature-complete checkpoint
- **Goal:** Merge the required TG-012/TG-013/TG-015 lanes and establish a real repeated-run candidate; TG-014 remains non-blocking.
- **Done when:** full local suite passes, a real three-run Solari evaluation completes, counts/denominators reconcile, and all sessions are accounted for.
- **Key files:** composition root, `tests/e2e`, lockfile, `docs/evidence`
- **Dependencies:** TG-012, TG-013, TG-015
- **Size:** M

### TG-017A — Evaluation/grading verification
- **Goal:** Verify submission state transitions, deterministic predicates, failure mapping, and report arithmetic.
- **Done when:** every category/code maps to one outcome, all displayed counts reconcile to rows, and cleanup warnings never rewrite grades.
- **Key files:** `packages/evaluation/**/*.test.ts`, `packages/grading/**/*.test.ts`, `docs/evidence/evaluation-verification.md`
- **Dependencies:** TG-016
- **Size:** M

### TG-017B — Solari/discovery verification
- **Goal:** Validate measured concurrency, acknowledged-session cleanup, ref safety, interface evidence/fallback, and replay only when enabled.
- **Done when:** every acknowledged session is released, no capability leaks remain, and semantic execution survives unavailable WebMCP.
- **Key files:** `packages/solari/**/*.test.ts`, `packages/discovery/**/*.test.ts`, `docs/evidence/solari-verification.md`
- **Dependencies:** TG-016
- **Size:** M

### TG-017C — AI/agent verification
- **Goal:** Re-run enabled-model probes and validate history/token bounds, serialized tools, timeout/shutdown signal propagation, prompt injection, provider errors, and redaction.
- **Done when:** enabled models still pass, request history remains bounded across 15 turns, and unsafe/malformed inputs fail closed without leaking data.
- **Key files:** `packages/ai/**/*.test.ts`, `packages/agent/**/*.test.ts`, `docs/evidence/agent-verification.md`
- **Dependencies:** TG-016
- **Size:** M

### TG-017D — DB/SSE/UI verification
- **Goal:** Validate the initial migration, snapshot/milestone persistence, refresh/reconnect, known-lease shutdown cleanup, accessibility, environment evidence, and report/degraded states.
- **Done when:** local E2E passes across normal refresh/reconnect, Ctrl-C cleanup of known leases, 3/3, mixed outcomes, and zero-denominator cases.
- **Key files:** `packages/db/**/*.test.ts`, `apps/web/**/*.test.tsx`, `docs/evidence/product-verification.md`
- **Dependencies:** TG-016
- **Size:** M

### TG-018 — Submission acceptance and polish
- **Goal:** Produce the reproducible judged candidate, README, architecture diagram, real screenshots/video, and explicit capability/cut-line disclosure.
- **Done when:** `pnpm verify` and configured probes pass; manual acceptance and leak audit are signed off; README accurately describes measured Solari/WebMCP/replay/model support; no P1/P2 omission is misrepresented.
- **Key files:** `README.md`, `AGENTS.md`, `docs/evidence`, this plan
- **Dependencies:** TG-017A, TG-017B, TG-017C, TG-017D
- **Size:** M

Critical path: `TG-000 → TG-001 → (TG-002, TG-003, TG-004 → TG-005) → TG-006 → (TG-007..TG-010) → TG-011 → (TG-012, TG-013, TG-015) → TG-016 → (TG-017A..TG-017D) → TG-018`. `TG-014` begins only after the single-run slice and must never block this path.

---

## 19. Challenge Submission Checklist

The submission is not complete until every applicable item is checked with a link or redacted evidence:

- [ ] Public GitHub repository is visibly a fork of `solari-sdk/solari-cookbook`.
- [ ] TraceGate source, plan, README, and evidence live under `examples/tracegate/`.
- [ ] Submission branch/repository is public and reproducibly installable.
- [ ] README includes thesis, architecture, setup, exact run/probe commands, and measured capability limitations.
- [ ] Real GIF/video shows configuration, three Solari runs, report, and trace/replay when available.
- [ ] Execution Environment card and evidence prove real Solari Browser sessions and selected model/interface.
- [ ] Every acknowledged Solari session used for acceptance has a release result.
- [ ] No fabricated, edited, or hard-coded evaluation result is presented as measured.
- [ ] AI-assisted development is disclosed accurately.
- [ ] X or LinkedIn post is published; immediately before posting, re-open the original challenge instructions and verify required wording, links, handles, and tags (expected `@harrychow_` and `@getsolari`).
- [ ] Public repository URL, demo/video URL, and social-post URL are recorded in the README/submission.
- [ ] P1/P2/post-submission omissions are stated honestly.

---

## 20. Remaining open questions

These require credentials/runtime access and are intentionally assigned to spikes rather than left as design ambiguity:

1. Which available HTTPS tunnel passes the Solari-to-demo proof, or must the plan select a Sandbox preview?
2. What browser concurrency and recording/replay entitlement does the supplied Solari account expose?
3. Which stable Solari replay reference/fresh-access APIs work after release in the installed SDK version?
4. Which exact OpenRouter provider routes pass streaming multi-tool and strict-schema behavior for each curated model?
5. Does the Solari Chromium build expose current WebMCP without flags/origin-trial configuration?
6. Which exact package versions form the passing Node 26/TypeScript 7/stable-pnpm/TanStack Start/AI/Drizzle/Solari set?

No other design decision should block implementation.

---

## 21. References

- [Solari cookbook](https://github.com/solari-sdk/solari-cookbook)
- [Solari Browser API](https://docs.getsolari.com/api-reference/browser)
- [Solari Sessions](https://docs.getsolari.com/sessions)
- [Solari Sandboxes](https://docs.getsolari.com/sandboxes)
- [Solari pricing and limits](https://docs.getsolari.com/pricing)
- [TanStack AI OpenRouter adapter](https://tanstack.com/ai/latest/docs/adapters/openrouter)
- [TanStack AI agentic cycle](https://tanstack.com/ai/latest/docs/chat/agentic-cycle)
- [TanStack AI stream events](https://tanstack.com/ai/latest/docs/chat/stream-events)
- [TanStack AI SSE response](https://tanstack.com/ai/latest/docs/reference/functions/toServerSentEventsResponse)
- [OpenRouter DeepSeek V4 Flash 0731](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)
- [OpenRouter Mistral Small 4](https://openrouter.ai/mistralai/mistral-small-2603)
- [OpenRouter GPT-5 Mini](https://openrouter.ai/openai/gpt-5-mini)
- [WebMCP draft](https://github.com/webmachinelearning/webmcp)
- [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp)
- [llms.txt proposal](https://github.com/AnswerDotAI/llms-txt)
- [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)
- [Node.js 26 release](https://nodejs.org/en/blog/release/v26.0.0)
- [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/)
- [pnpm releases](https://github.com/pnpm/pnpm/releases)
