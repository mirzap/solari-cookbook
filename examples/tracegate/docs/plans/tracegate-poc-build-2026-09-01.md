# TraceGate generic-site V2 build plan

**Source of truth:** 2026-09-01
**Pivot approved:** 2026-09-01
**Status:** planning rebaseline; implementation remains quarantined until TG-006R passes

---

## 1. Goal and delivery definition

TraceGate evaluates how reliably a browser-capable AI model can complete a user-authored, safe, anonymous task on a user-submitted public HTTPS site. A user supplies:

- one public HTTPS start URL;
- one bounded natural-language prompt;
- one to twenty bounded declarative assertions describing the expected browser-observable final state;
- one or more verified model choices and bounded execution settings.

TraceGate runs the task in isolated Solari Browser sessions, records a redacted execution trace, captures fresh stable browser evidence after the agent stops acting, evaluates the assertions deterministically, releases every acknowledged provider session, and reports truthful reliability metrics.

A **PASS** proves only that the declared assertions were satisfied in the final browser-observable state captured by TraceGate. It does not prove arbitrary backend business truth, durable server-side effects, legal completion, payment, delivery, message publication, identity, authorization, or any fact outside the admitted evidence model.

### 1.1 Allowed product scope

Submission P0 permits anonymous, public, safe, reversible browsing tasks such as:

- navigating within declared public origins;
- finding or filtering public information;
- opening reversible disclosure controls, tabs, menus, and pagination;
- selecting non-sensitive local presentation or filter state;
- typing into admitted non-sensitive search/filter controls;
- verifying URL, visible text, accessibility semantics, and allowlisted control state.

Submission P0 prohibits:

- authentication, login, signup, credentials, passwords, passkeys, one-time codes, or account recovery;
- financial, purchase, checkout, payment, subscription, booking-confirmation, order, donation, or trading actions;
- messaging, email, chat sends, comments, reviews, social publication, or public posting;
- destructive actions, deletion, cancellation with external effect, irreversible submits, or unknown-effect activation;
- file uploads, downloads, clipboard access, permissions, external protocols, or device APIs;
- entry, collection, or persistence of sensitive personal, financial, health, authentication, or regulated data;
- arbitrary JavaScript, selectors, XPath, CDP, headers, cookies, storage, filesystem, network, or provider capabilities exposed to the model;
- generic WebMCP invocation. Discovery may be recorded, but invocation is disabled.

A task rejected by admission is not scheduled. A prohibited or unverifiable effect discovered during a run yields an honest safe outcome, never a fabricated failure or pass.

### 1.2 Definition of done

Submission P0 is complete only when all of the following are true:

1. The public GitHub repository remains visibly forked from `solari-sdk/solari-cookbook`, with TraceGate under `examples/tracegate/`.
2. Exact runtime and dependency pins install from the authoritative pnpm 12 lockfile.
3. A V2 evaluation accepts a public HTTPS target, prompt, and 1–20 valid assertions.
4. Public-network admission and runtime egress controls reject private/reserved destinations, unsafe redirects, DNS rebinding, and unobservable resolution.
5. Runtime policy blocks non-idempotent network mutation and every prohibited action category above.
6. Assertions never enter model context, tool descriptions/results, agent history/trace, or the evaluated target page’s input/content. They remain visible only in TraceGate’s authoring and report control plane.
7. The grader uses a fresh stable evidence capture after the serialized action queue drains.
8. PASS/FAIL/INCONCLUSIVE follows the frozen precedence in §7.8.
9. Missing, truncated, ambiguous, unstable, unsupported, or otherwise unverifiable required evidence produces INCONCLUSIVE.
10. One fixture evaluation and real multi-site Solari acceptance runs prove the same generic path without privileged grading.
11. Three repeated runs produce auditable raw counts and correct denominators.
12. Every acknowledged Solari session has a durable release result; any potential leak blocks acceptance.
13. Snapshots and SSE recover after refresh/reconnect without treating SSE as authoritative state.
14. SQLite, logs, events, evidence, exports, and replay handling contain no credentials, CDP URLs, replay URLs, sensitive assertion values, full DOMs, or challenge capabilities.
15. README, video, evidence, and UI state the observable-state limitation and do not imply backend truth.
16. No measured result, capability, model support, or safety claim is fabricated or hard-coded.

---

## 2. Historical baseline and pivot status

The generic-site V2 decision supersedes the controlled Demo Store product thesis, but it does not rewrite history.

### 2.1 Historical gates preserved as measured

| Gate | Historical result retained | V2 interpretation |
|---|---|---|
| TG-000 | PASS: public fork/workspace established | Unchanged and still valid |
| TG-001 | PASS: Node `26.1.0`, global pnpm `12.0.0`, exact dependency pins and practical workspace smoke | Unchanged unless a measured build failure requires a recorded deviation |
| TG-002 | PASS: real Solari connectivity to a production-shaped fixture, Cloudflare Quick Tunnel selected, at least five concurrent sessions observed, recording/replay observed | Proves provider/connectivity capability only; does not prove arbitrary-target SSRF, DNS-rebinding, redirect, or mutation safety |
| TG-003 | PASS for P0 DeepSeek through pinned TanStack/OpenRouter; optional models unverified | Retained; the V2 safe tool surface must still compile and smoke through the verified adapter |
| TG-004 | PASS: V1 shared contracts compiled | Superseded for target/grading semantics by TG-004R; reusable lifecycle/redaction contracts remain |
| TG-005 | PASS: local libSQL/Drizzle snapshot, ordered milestone, publish-after-commit SSE, and refetch recovery feasible | Retained as infrastructure evidence; V2 persistence/privacy requires TG-005R |
| TG-006 | PASS: V1 architecture freeze and lane ownership | Historical checkpoint, superseded by TG-006R before V2 implementation |
| TG-007 V1 impact | Demo lifecycle shared-contract correction was committed | Browser close remains useful; Demo administration and cart grading leave the production contract |

Evidence under `docs/evidence/` is append-only in meaning. New evidence may explain supersession; it must not alter a prior measured result to improve the submission.

### 2.2 Dirty-WIP quarantine

At pivot approval, concurrent B/C/D work and an interrupted A shared-contract checkpoint are present but not integrated. Until TG-006R:

- do not blanket reset, stage, format, or commit another lane’s work;
- do not stage `pnpm-lock.yaml` while manifests are changing;
- preserve reusable infrastructure hunks and explicitly retire target-specific behavior;
- do not claim any uncommitted package or test is green merely because files exist;
- explicitly assigned TG-002R/TG-004R/TG-005R rebaseline work may selectively stage only its owned reviewed gate paths; Wave 1 production implementation and lockfile integration remain blocked until TG-006R is green.

The detailed quarantine record is `docs/evidence/generic-site-pivot.md`.

---

## 3. Resolved V2 architecture

### 3.1 Repository layout

```text
examples/tracegate/
  apps/
    web/                 # V2 API, composition, snapshot/SSE, generic configure/live/report UX
    demo/                # deterministic test fixture only; never a production target dependency
  packages/
    shared/              # authoritative Zod V2 contracts, states, events, ports, redaction, fakes
    db/                  # Drizzle/libSQL migrations, repositories, reports
    solari/              # provider lease, controller, replay, runtime egress/effect enforcement
    discovery/           # semantic observation, opaque refs, bounded discovery
    ai/                  # pinned TanStack/OpenRouter adapter and safe-tool mapping
    agent/               # prompt, budgets, history, policy-bound runner
    evaluation/          # admission-aware submission, queue, executor, aggregation
    grading/             # pure assertion grader and outcome authority
    ui/                  # accessible generic components
  tests/e2e/             # fixture, policy, and credentialed multi-site Solari acceptance
  docs/evidence/         # redacted measured evidence and pivot records
```

### 3.2 Dependency direction

```text
shared
  ↑ db, solari, discovery, ai, agent, grading
  ↑ evaluation
  ↑ apps/web

apps/demo is a test target; production packages do not import it.
```

Rules:

- Zod schemas are authoritative; TypeScript types are inferred.
- Cross-lane contracts live only in `@tracegate/shared`.
- Concrete DB, Solari, agent, or fixture classes never appear in another lane’s public signature.
- `apps/web` is the composition root.
- The model receives only the prompt and safe tool results. It never receives assertions, grader evidence, policy internals, secrets, or raw browser/controller capabilities.
- The run executor owns the raw browser controller and injects only a policy-enforcing safe tool port into the agent.

### 3.3 Runtime topology

```text
Browser/client
  → apps/web V2 API
      → TargetAdmissionPort
      → atomic durable evaluation submission
      → one-evaluation FIFO scheduler
          → Solari BrowserProvider + BrowserControllerFactory
          → policy-enforcing action executor
          → discovery + semantic observation
          → TanStack/OpenRouter agent
          → fresh assertion evidence capture
          → pure assertion grader
          → transactional terminal result
      → Drizzle/libSQL snapshot repository
      → persisted events → publish-after-commit process-local SSE
```

`apps/demo` may be served during tests, but production configuration uses `kind: "public-web"` and has no Demo admin URL, challenge token, scenario ID, or privileged grader dependency.

---

## 4. Shared V2 contracts

### 4.1 `PublicEvaluationConfigV2`

Conceptual authoritative shape:

```text
schemaVersion: 2

target:
  kind: "public-web"
  startUrl: PublicHttpsUrl
  allowedNavigationOrigins: PublicHttpsOrigin[1..3]

prompt: trimmed UTF-8 string, 1..1000 characters
assertions: AssertionV1[1..20], unique IDs
safetyPolicyVersion: "public-safe-v1"  # server-selected and non-user-tunable

modelIds: unique verified ModelId[1..3]
requestedRunsPerModel: integer 1..5
total requested runs: max 15
requestedConcurrency: integer 1..5
interfaceMode: "semantic-only" | "auto"
recordingRequested: boolean
sampling: exact existing bounded shape
budgets: exact existing bounded shape
```

Validation requirements:

- `startUrl` is absolute HTTPS, has no credentials, uses the admitted port policy, and belongs to an exact declared origin.
- Origins are canonical `https://host[:port]` values with no path, query, fragment, or credentials.
- Origin values are unique. P0 defaults to the start origin and permits additions only through explicit user configuration and admission.
- Structural parsing does not claim network safety. `TargetAdmissionPort` performs asynchronous DNS, address, redirect, and reachability checks before durable creation.
- Assertions define success completely. Human prompt prose is not grading authority.
- V1 Demo configuration is legacy read-only and cannot be silently parsed as V2.

### 4.2 Declarative assertion schema

Every assertion has:

```text
schemaVersion: 1
id: stable bounded AssertionId, unique within evaluation
label: optional trimmed string, max 200
kind: discriminant
```

All assertions are required and combined with logical AND. Optional assertions, arbitrary expression trees, regular expressions, scripts, selectors, and XPath are deferred.

#### URL assertion

```text
kind: "url"
operator: "equals" | "origin_and_path_equals"
expectedUrl: admitted public HTTPS URL
```

The final main-frame URL is compared after canonical URL parsing. Query and fragment participation is explicit: `equals` includes them; `origin_and_path_equals` excludes them. The expected origin must be declared and admitted.

#### Text assertion

```text
kind: "text"
scope: "document_visible_text" | "title"
operator: "contains" | "not_contains" | "equals"
expected: 1..500 UTF-8 characters
caseSensitive: boolean
```

Evaluation uses fixed Unicode normalization and whitespace folding. The capture may scan only within a frozen byte/time budget. If it cannot prove the condition across the admitted scope, evidence is unverifiable.

#### Semantic assertion

```text
kind: "semantic"
locator:
  role: bounded ARIA/accessibility role
  accessibleName:
    operator: "equals" | "contains"
    value: 1..500 characters
    caseSensitive: boolean
count:
  operator: "equals" | "at_least" | "at_most"
  value: integer 0..20
```

Only trusted accessibility semantics are used. CSS, XPath, DOM IDs, and positional indexes are forbidden.

#### State assertion

```text
kind: "state"
locator: same semantic locator; must resolve to exactly one element
property: "checked" | "selected" | "expanded" | "disabled" | "value"
expected: boolean or bounded string according to property
```

`value` is allowed only for admitted non-sensitive search/filter controls. It is bounded and centrally redacted; sensitive-control detection makes the assertion unverifiable and blocks interaction. State never means cookies, storage, authentication, server database state, network success, payment, publication, or cross-origin iframe contents.

### 4.3 Evidence contracts

`AgentObservation` remains model-oriented and is not grade evidence. It may be compacted and truncated.

A separate trusted capture contract is required:

```text
BrowserAssertionEvidenceV1
  schemaVersion: 1
  capturedAt: UTC timestamp
  finalUrl: bounded redacted URL
  evidenceGenerationBefore: positive EvidenceGenerationRevision
  evidenceGenerationAfter: positive EvidenceGenerationRevision
  stabilityAttempts: integer 1..3
  policyViolation: PolicyViolation | null
  assertions: AssertionEvidence[1..20]
  evidenceHash: bounded digest identifier
```

Each `AssertionEvidence` contains:

```text
assertionId
status: "observed" | "unverifiable"
observedResult: boolean | null
expectedSummary: bounded/redacted
actualSummary: bounded/redacted
reasonCode: null | closed UnverifiableReason
```

Closed unverifiable reasons include at least:

```text
capture_timeout
page_unstable
observation_truncated
semantic_match_ambiguous
semantic_data_unavailable
unsupported_state
cross_origin_frame
sensitive_control
policy_blocked
target_unreachable
evidence_invalid
```

`EvidenceGenerationRevision` is a trusted browser-adapter counter distinct from model-oriented `ObservationRevision` and legacy `DemoMutationRevision`. It advances on main-frame navigation/document replacement and on every observed mutation that can change URL, visible text, accessibility semantics, or allowlisted control state. The capture is stable only when main-frame identity is unchanged and the before/after evidence-generation revisions are equal. If the adapter cannot observe relevant changes or guarantee counter coverage, affected evidence is unverifiable.

The evidence schema never contains a full DOM, arbitrary HTML, raw network response, credentials, sensitive entered data, CDP/replay capability, or page-provided script result.

### 4.4 Grade result

```text
GradeAssertionResult
  assertionId
  status: "passed" | "failed" | "unverifiable"
  expectedSummary
  actualSummary
  reasonCode

GradeResultV2
  schemaVersion: 2
  evidenceHash
  safetyPolicyVersion: "public-safe-v1"
  outcome: "passed" | "failed" | "inconclusive"
  assertions: GradeAssertionResult[1..20]
  failure: FailureRecord | null
  gradedAt
```

The assertion result set must match the submitted assertion IDs exactly once. The grader is pure, deterministic, and ignores model summaries, beliefs, and hidden conversation content.

### 4.5 Runtime ports

Required cross-lane ports:

- `TargetAdmissionPort.assess(target, signal)` returns an admitted canonical target or a safe rejection; it never returns raw DNS/provider material to the client.
- `EvaluationSubmissionRepository.transactionallyCreate(...)` atomically creates the evaluation, all run rows, and all `run.queued` events with exact-retry idempotency.
- `RunTransitionRepository.transactionallyApply(...)` atomically applies an intermediate legal transition and its matching milestone.
- `BrowserProvider.acquire(...)` returns a lease or a typed safe error.
- `BrowserControllerFactory.create(lease, signal)` returns a fresh controller bound to that lease.
- `BrowserController` owns reviewed browser operations and explicit idempotent `close`.
- `SafeAgentToolPort` exposes only policy-reviewed actions to the agent.
- `AssertionEvidenceCapture.capture(assertions, signal)` runs after the action queue drains on the same controller and returns trusted evidence.
- `Grader.grade(assertions, evidence, signal)` returns `GradeResultV2`.
- Existing event, snapshot, repository, replay, clock, ID, failure-analysis, and terminal-finalization ports remain AbortSignal-aware.

`AgentRunContext` contains the prompt, public configuration without assertions, initial observation, discovery, and `SafeAgentToolPort`. It does not contain assertions or a raw `BrowserController`.

### 4.6 Typed provider capacity error

Acquisition-time provider concurrency limits use a strict safe error:

```text
code: "concurrency_limit_exceeded"
category: "infrastructure"
phase: "browser_acquire"
retryable: true
retryAfterMs: integer 0..300000 | null
```

`retryAfterMs` is normalized scheduler metadata, never a raw header. Provider bodies, headers, URLs, request IDs, capabilities, and arbitrary messages are forbidden from the safe value.

---

## 5. Public-network admission and runtime safety

### 5.1 Admission gate

Before durable evaluation creation, admission must:

1. Parse canonical HTTPS start URL and origins.
2. Reject credentials, unsupported ports, IP-literal hosts, localhost, `.local`, and malformed internationalized names.
3. Resolve A and AAAA records through an audited resolver.
4. Reject any private, loopback, link-local, carrier-grade NAT, multicast, documentation, benchmark, reserved, unspecified, or cloud-metadata address.
5. Reject mixed public/private answer sets.
6. Perform a bounded reachability probe without credentials or body mutation.
7. Validate every redirect hop against the same scheme, origin, DNS, and address rules.
8. Return only canonical safe admission metadata and an expiry/recheck time.

Admission is necessary but insufficient: runtime must enforce the actual resolved destination used by the remote browser.

### 5.2 DNS rebinding and destination enforcement

P0 is blocked unless Solari or a TraceGate-controlled outbound enforcement layer can observe and deny the actual destination of **every browser request context** before connection. This includes main-frame and subframe navigation, redirects, fetch/XHR, scripts, styles, images, fonts, media, prefetch/preload, dedicated/shared workers, and any browser-generated request. Runtime must:

- validate the resolved IP and HTTPS scheme before every connection and redirect hop;
- reject any request class whose destination or resolution cannot be observed and enforced;
- revalidate after DNS changes and admission expiry;
- block private/reserved/metadata destinations even if the hostname passed preflight;
- disable service-worker registration and block service-worker-controlled requests in P0;
- prevent alternate protocols, proxy bypass, off-policy navigation, and unresolved worker/subresource egress;
- record only bounded safe policy codes rather than raw network details.

DNS preflight alone must never be presented as DNS-rebinding protection. TG-002R is green only when request-level tests cover every supported context and demonstrate default-deny behavior for an unobservable context.

### 5.3 Network mutation and subresource policy

For `public-safe-v1`, all browser egress is default-deny:

- Main-frame navigation is limited to declared admitted origins and HTTPS `GET`/`HEAD`.
- Third-party static subresources may use HTTPS `GET`/`HEAD` only when their actual destination is public and enforceable; permitted resource classes are script, style, image, font, and media under bounded size/time/count budgets.
- Cross-origin fetch/XHR, frames, prefetch/preload, and workers are blocked unless a TG-002R-tested deterministic rule explicitly permits the request class. Service workers remain disabled.
- `OPTIONS` is allowed only as an empty-body public-destination preflight for an otherwise permitted safe request.
- POST, PUT, PATCH, DELETE, CONNECT, unknown methods, request bodies, beacons, WebSocket connections/sends, form mutation, downloads, and external protocols are blocked.
- Every redirect repeats method, origin, DNS, address, destination, and resource-class checks.
- Runs start with no preloaded cookies, HTTP authentication, client certificates, or authorization. Ephemeral anonymous cookies created during the run may accompany permitted GET/HEAD requests but never certify authentication or broaden policy; authorization headers and explicit credentials are always blocked.

A request is denied when its method, body, initiator, resource class, redirect, actual destination, or credential state cannot be classified. A blocked mutation/request yields `run.policy.blocked` and makes the run INCONCLUSIVE even if optimistic DOM state appears successful.

### 5.4 Trusted action/effect policy

The browser adapter, not the prompt or model, is authoritative. Before executing an action it evaluates element semantics, control type, form method, target origin, predicted network effect, sensitivity, popup/download behavior, and current policy state.

Allowed actions include inspect, wait, bounded scroll, admitted GET navigation, reversible disclosure/tab/menu/filter/select controls, and typing into non-sensitive search/filter controls.

Blocked actions include every prohibited category in §1.1, unknown-effect controls, submit buttons, sensitive inputs, file controls, popup/new-window activation, cross-origin frames, permission prompts, and generic native tools.

A versioned deterministic prompt screen may reject only explicit, unambiguous prohibited intent as a pre-creation control error and may warn on ambiguity. Model-based prompt classification is never admission authority, and a screen pass never certifies safety. Runtime action/request enforcement remains authoritative; unknown or ambiguous effects are blocked and classified INCONCLUSIVE.

### 5.5 Anonymous isolation

Each run uses a fresh anonymous browser session with no user credentials or reused profile. Authentication discovered through ambient site state is unsupported. Cookies created during public browsing are not treated as permission to authenticate or mutate. Run isolation, storage teardown, controller close, and provider release are required on all paths.

---

## 6. State, failure, and event semantics

### 6.1 Evaluation states

```text
queued → running → completed
queued/running → cancelling → cancelled
queued/running/cancelling → failed
```

Terminal states are closed. Submission rejection before durable creation is an API control error, not a failed evaluation.

### 6.2 Run states

```text
queued
→ acquiring_browser
→ connecting_browser
→ discovering
→ running_agent
→ grading
→ releasing_browser
→ completed
```

Cancellation and recovery edges remain governed by the frozen lease-disposition rules. No terminal transition may bypass a possibly live lease. Evidence capture occurs within the grading phase after action drain and before controller close.

### 6.3 Universal outcome and failure precedence

One precedence applies to cancellation, safety, execution errors, and grading:

1. A committed user/system cancellation produces `cancelled`; no grade is fabricated.
2. Any unsafe/prohibited action or request attempt produces `inconclusive` with `unsafe_action_blocked`, regardless of visible state.
3. If fresh trusted evidence cannot be captured/validated, or any required assertion is unverifiable, the outcome is `inconclusive`.
4. When complete trusted evidence exists and no higher-precedence condition applies, all assertions true produces `passed`; any false assertion produces `failed`.
5. Provider, model, budget, or agent-loop errors are terminal failure codes only when they prevent complete trusted evidence. If complete evidence is captured afterward, PASS/FAIL remains authoritative and the execution error is retained only as a bounded warning/trace fact.

Authoritative codes include:

| Code | Category | Outcome/behavior |
|---|---|---|
| `assertion_failed` | `incorrect_state` | failed under rule 4 |
| `assertion_unverifiable` | `grading` | inconclusive under rule 3 |
| `unsafe_action_blocked` | `policy` | inconclusive under rule 2 |
| `target_admission_failed` | control rejection before creation; infrastructure/inconclusive only if discovered after scheduling |
| `target_unavailable` / `target_evidence_lost` | `infrastructure` | inconclusive when complete evidence is unavailable |
| `invalid_evidence` | `grading` | inconclusive |
| `solari_unavailable` | `infrastructure` | inconclusive because capture cannot occur |
| `provider_protocol_error` | `model_provider` | inconclusive only when it prevents complete capture; otherwise warning |
| `budget_exhausted` | `timeout` | inconclusive only when it prevents complete capture; otherwise warning plus rule-4 grade |
| user/system cancellation | `cancellation` | cancelled |

The V1 `navigation_blocked → failed` rule is retired. A safety or instrumentation boundary must never manufacture a task failure.

### 6.4 Persisted event envelope

Existing cursor ordering remains authoritative:

```text
schemaVersion, eventId, evaluationId,
runId/runSequence pair or null,
type, payload, occurredAt, recordedAt, cursor
```

`cursor` orders evaluation streams; `runSequence` orders a run. `occurredAt` is display metadata. Event IDs and `(runId, runSequence)` remain unique.

V2 adds or generalizes:

```text
run.policy.blocked
run.evidence.capture_started
run.evidence.captured
run.grade.started
run.grade.completed
```

Persist only bounded policy codes, evidence hashes, assertion IDs/statuses, and safe summaries. Never persist assertions in agent/model events or full captured page content.

### 6.5 TanStack event mapping

The existing server-side mapping remains: consume AG-UI/TanStack streams, persist bounded milestones, validate/redact tool arguments and results, throttle usage, classify malformed events, and never expose raw provider streams directly as product SSE.

Assertions and grader evidence are absent from model context and TanStack events. Unknown provider events produce warnings, not raw persistence.

---

## 7. Execution design

### 7.1 Submission and durable expansion

`POST /api/evaluations`:

1. Parse `PublicEvaluationConfigV2`.
2. Validate assertion shapes and run the versioned deterministic prompt screen; reject only explicit unambiguous prohibited intent and treat all other screening as advisory.
3. Run authoritative target/origin admission; runtime action/request enforcement remains authoritative even after admission.
4. Validate current model and browser safety capabilities.
5. Create the evaluation, N run rows, and sequence-zero `run.queued` events atomically.
6. Enqueue only after commit.

Exact submission retry is idempotent. A conflict or abort leaves no partial graph and consumes no event cursors.

### 7.2 One-evaluation queue and capacity

P0 allows one active evaluation and a process-global FIFO run queue. Effective Solari capacity is:

```text
min(requested concurrency, configured maximum, measured safe provider capacity)
```

Start from the measured safe cap recorded by TG-002, but do not exceed five. On typed concurrency-limit error:

- release the local permit;
- lower process capacity by one, floor one;
- honor normalized bounded `retryAfterMs` or capped exponential backoff with jitter;
- requeue the same durable run without creating a duplicate;
- never raise capacity again without explicit capability refresh/restart;
- after three acquisition attempts or deadline, classify the run inconclusive.

### 7.3 Per-run lifecycle

```text
persist acquiring_browser + milestone atomically
→ acquire Solari lease
→ immediately persist safe session identity
→ construct a fresh lease-bound controller
→ connect with timeout
→ install navigation/request/popup/dialog/download/policy handlers
→ navigate to admitted start URL
→ discover and observe
→ run agent through SafeAgentToolPort only
→ drain serialized action queue
→ capture fresh stable assertion evidence
→ pure deterministic grade
→ close controller
→ release Solari lease with fresh bounded signal
→ free permit
→ optionally poll replay status
→ transactionally persist terminal result and cleanup state
```

After any provider session ID is acknowledged, lease release is attempted in `finally` regardless of connection, model, policy, persistence, evidence, timeout, shutdown, or grading failure. Controller close is attempted before lease release, but close failure cannot suppress release.

### 7.4 Safe agent loop

The model receives:

- the user prompt;
- admitted start URL/origin policy in bounded form;
- current semantic observations and safe tool results;
- budgets and explicit safety limitations.

It does not receive assertions, assertion IDs/labels, expected state, grader evidence, policy secrets, admin endpoints, or provider capabilities.

The only model tools are policy-bound forms of:

```text
navigate
inspect
click
type
select
pressKey
scroll
wait
finish
```

`callNativeTool` is removed from the generic production path. Every tool call increments limits, validates Zod input, checks cancellation/deadline/origin/effect policy, executes under timeout and per-run serialization, forces a fresh observation after mutation, returns bounded untrusted output, and emits redacted milestones.

`finish` is a belief only. It never grades the run.

### 7.5 Semantic observation and discovery

Opaque refs, deterministic DOM order, stale-revision rejection, semantic identity recheck, bounded visible text, and safe attributes remain.

Discovery may inspect same-origin `/llms.txt`, current-page JSON-LD, and WebMCP presence under strict size/redirect limits. All discovery is untrusted. Generic WebMCP is `unavailable`, `available_disabled`, or `discover_only`; it cannot broaden origins, actions, policy, or assertions.

Cross-origin iframe content is unavailable for action and grading in P0.

### 7.6 Fresh stable evidence capture

After acting stops:

1. No model/tool action remains queued.
2. Wait a bounded quiet/stability interval.
3. Capture trusted main-frame identity and `EvidenceGenerationRevision` before evaluation.
4. Evaluate every assertion through fixed reviewed browser-adapter logic while the adapter tracks relevant URL/DOM/accessibility/state mutations.
5. Capture main-frame identity and `EvidenceGenerationRevision` again.
6. Accept only when main-frame identity is unchanged, before/after evidence-generation revisions are equal, and the adapter can prove coverage of relevant changes; otherwise evidence is unverifiable.
7. Retry at most twice within the grading deadline.
8. Persistent instability, truncation, ambiguity, policy violation, or unsupported state becomes unverifiable.

The fixed capture implementation may use reviewed CDP/Playwright primitives internally. The model cannot invoke or parameterize arbitrary script.

### 7.7 Demo fixture placement

`apps/demo` remains only to provide deterministic tests for:

- URL/text/semantic/state assertions;
- stable and intentionally unstable pages;
- stale refs and ambiguous semantics;
- safe GET search/filter interactions;
- prohibited auth, purchase, messaging, upload/download, submit, popup, redirect, private-address, and mutation attempts;
- prompt-injection content.

Production evaluation configuration never selects `tracegate-demo-store`, calls `DemoAdminPort`, uses challenge tokens, or reads privileged cart evidence. Legacy challenge/admin code may remain only behind test/legacy boundaries and cannot be composed into V2.

### 7.8 Deterministic grade application

Apply the universal §6.3 precedence. For required assertions combined with AND, after cancellation and policy checks:

1. Missing/invalid capture or any assertion status `unverifiable` → INCONCLUSIVE.
2. Otherwise, all observed results true → PASS.
3. Otherwise → FAIL.

A definitive false result does not override another required unverifiable result. Provider/model/budget errors do not override a later complete trusted grade unless they also caused a higher-precedence policy violation. The model summary is always ignored.

### 7.9 Reliability aggregation

Always show raw counts:

```text
requested, started, passed, failed, inconclusive, cancelled, potential leaks
```

Primary metric:

```text
end-to-end pass rate = passed / requested
```

Secondary labeled metric:

```text
gradeable observable-state success = passed / (passed + failed)
```

Zero denominator is “Not available.” Inconclusive/cancelled runs are never silently omitted. Percentages display numerator and denominator. Three-run results are descriptive, not statistically significant. Median durations/steps name included statuses. Reports repeat that PASS covers declared browser-observable assertions only.

---

## 8. Persistence, API, streaming, and UI

### 8.1 Persistence

Retain local libSQL/Drizzle, WAL, foreign keys, bounded busy timeout, short transactions, and the process-local writer queue. The historical initial migration is immutable evidence; add a V2 pivot migration.

Persist:

- V2 config JSON and schema version;
- admitted canonical target/origin metadata and admission expiry/status;
- safety policy version and bounded policy violations;
- runs, usage, cleanup, replay status, warnings;
- assertion specification hash and assertion IDs/types needed for reporting;
- evidence hash, capture status/attempt count, bounded per-assertion evidence summaries;
- generalized grade results and terminal failure;
- ordered redacted events and steps.

Do not persist:

- full DOM/HTML, screenshots by default, arbitrary visible text dumps;
- credentials, sensitive typed values, authorization, cookies, storage;
- raw DNS/provider headers/bodies or private-address details returned to clients;
- CDP endpoints, challenge URLs/tokens, replay URLs;
- assertions in model conversation/history events.

V1 rows are legacy read-only and are not rescheduled or converted to V2. Privileged Demo evidence is not equivalent to observable browser evidence.

### 8.2 API

P0 endpoints:

```text
GET  /api/health
GET  /api/capabilities
POST /api/targets/admit          # bounded admission preview, rate limited
POST /api/evaluations            # V2 only
GET  /api/evaluations/:id        # authoritative snapshot
GET  /api/evaluations/:id/events # new persisted milestones via SSE
```

The server revalidates all client input. Admission responses expose canonical safe status/reasons, not DNS internals. Snapshot schemas expose assertion outcomes and policy limitations without model/private evidence.

### 8.3 SSE

SSE remains a process-local notification/projection channel:

- DB commit precedes publish;
- only persisted redacted events are published;
- clients load/refetch the authoritative snapshot on start/reconnect/gap;
- event IDs/cursors make projection idempotent;
- no public publish bypass exists.

### 8.4 Configure UX

The landing page provides:

- public HTTPS start URL;
- exact allowed origins, with safe defaults and explanation;
- prompt editor with prohibited-task guidance;
- accessible assertion builder for URL/text/semantic/state assertions, max twenty;
- model/runs/concurrency/recording controls gated by measured capability;
- admission status and clear unsupported reason;
- explicit acknowledgment that assertions are hidden from the model and PASS is browser-observable only.

### 8.5 Live UX

Show evaluation/run states, redacted milestones, policy blocks, evidence-capture status, cleanup/replay state, and reconnect status. Never show CDP, raw provider payloads, assertions inside agent messages, or full page evidence.

### 8.6 Report UX

Show:

- prompt and admitted target/origins;
- assertion definitions separately from the agent trace;
- per-run assertion result/status and bounded evidence summary;
- PASS/FAIL/INCONCLUSIVE reason and safety-policy version;
- raw counts, denominators, medians, usage, interface evidence, execution environment;
- cleanup reconciliation and potential leaks;
- prominent observable-state limitation.

---

## 9. Security, privacy, replay, and non-fabrication

### 9.1 Trust hierarchy

From most trusted to least trusted:

1. frozen server policy and Zod contracts;
2. repository transactions and trusted browser evidence capture;
3. normalized provider/session metadata;
4. user target/prompt/assertions;
5. website DOM, text, structured data, native-tool descriptions;
6. model/provider output.

User assertions are authoritative grade specifications after validation, but they are still untrusted input for storage/rendering and never enter model context.

### 9.2 SSRF and egress

Admission plus runtime destination enforcement is mandatory. Any path that cannot prove actual public destination enforcement blocks V2 P0. Redirects, subresources, service workers, alternate protocols, DNS changes, and network mutation receive explicit tests.

### 9.3 Redaction and sensitive data

Central redaction applies before persistence, logging, events, UI, evidence, and exports. It removes known secrets and patterned authorization, credential, signed URL, challenge, CDP, replay, and sensitive query values. String/array/object sizes and cause chains remain bounded.

The product refuses tasks that require sensitive data. Redaction is defense in depth, not permission to collect it.

### 9.4 Replay

Replay remains optional P1 and capability-gated. Only provider session ID and safe replay status are durable. Fresh presigned replay access is requested server-side, returned only to an authorized local reviewer surface, never logged/persisted/SSE-published, and discarded immediately. Replay absence never changes deterministic grading.

### 9.5 Cleanup and truthfulness

Every acknowledged provider session must reconcile to a release record. Any unknown/unreleased acknowledged session blocks acceptance. Cancellation and shutdown use fresh bounded cleanup signals.

Never:

- hard-code a PASS/FAIL result;
- present fixture/local Playwright output as a real Solari run;
- present old V1 evidence as V2 safety proof;
- list an optional model or feature as verified without measured evidence;
- edit measured evidence to improve a result;
- splice prior success into a claimed live run.

---

## 10. Scope cut line

### Submission P0 — mandatory

- Generic V2 public target/prompt/assertions.
- TG-002R runtime public-network and mutation-safety proof.
- One verified DeepSeek path through TanStack/OpenRouter.
- One active evaluation, bounded Solari capacity and typed 429 degradation.
- Safe semantic tool loop with assertions excluded from context.
- Fresh stable browser evidence and pure deterministic grader.
- Fixture tests plus multi-site real Solari acceptance.
- Drizzle persistence, authoritative snapshot, simple SSE refetch/reconnect.
- Generic configure/live/report UX.
- Cleanup reconciliation, redaction, policy/admission evidence.

### TG-014 non-blocking P1

- Replay UX when capability remains verified.
- Optional verified models.
- Richer assertion authoring that preserves deterministic safety.
- Improved discovery display and evidence diagnostics.
- Accessibility and report export polish beyond P0 minimum.

TG-014 is not on the P0 critical path and cannot delay an otherwise honest submission.

### Deferred/post-submission

- Authentication or user accounts.
- Credentialed sites or private networks.
- Financial, messaging, publication, destructive, upload/download, or irreversible workflows.
- Generic WebMCP invocation.
- Arbitrary scripts/selectors/assertion expressions.
- Distributed queues, multi-process SSE, durable replay fan-out.
- Remote DB, billing/cost estimates, retention automation, migration rollback automation.
- Automated claim of backend business truth.

### Never cut

Safety admission, assertion/model separation, fresh evidence, INCONCLUSIVE semantics, release-in-finally, redaction, truthful denominators, exact pins, and non-fabrication requirements are never optional.

---

## 11. Four-agent ownership and waves

### 11.1 Exclusive lanes

| Agent | Exclusive paths/responsibility |
|---|---|
| A — integration/evaluation | root TraceGate configs, `AGENTS.md`, `packages/shared`, `packages/evaluation`, `packages/grading`, `tests/e2e`, lockfile, checkpoint/final evidence |
| B — browser/target/discovery | `packages/solari`, `packages/discovery`, `apps/demo`, Solari/target-safety evidence |
| C — AI/agent | `packages/ai`, `packages/agent`, model/tool-confinement evidence |
| D — persistence/product UI | `packages/db`, `packages/ui`, `apps/web`, persistence/UI evidence |

No agent edits, stages, restores, or formats another lane’s exclusive paths. Agent A integrates completed handoffs unchanged only at an explicit checkpoint.

### 11.2 Pivot waves

```text
Historical: TG-000, TG-001, TG-002, TG-003, TG-005, TG-006 retained

Rebaseline:
  TG-002R target-safety feasibility
  TG-004R V2 contracts
  TG-005R V2 persistence/privacy refresh
  TG-006R pivot freeze

Wave 1 after TG-006R:
  A TG-007 evaluator/grader
  B TG-008 safe browser/evidence
  C TG-009 safe agent
  D TG-010 V2 DB/API/UI

Integration:
  TG-011 single run
  TG-012 repeated orchestration
  TG-013 policy/cleanup evidence
  TG-015 complete UX
  TG-016 P0 checkpoint
  TG-017A–D lane verification
  TG-018 final acceptance
```

TG-014 remains non-blocking P1.

### 11.3 Contract and lock discipline

A shared change after TG-006R must name affected schemas/events/ports/lanes, document compatibility/migration, update canonical fixtures/negative tests, pass downstream compile checks, and receive affected-lane acknowledgement.

Only Agent A updates `pnpm-lock.yaml`. Regenerate with Node `26.1.0` and global pnpm `12.0.0` after all intended manifests are present; never stage a lockfile generated against partial concurrent manifests.

---

## 12. Error and edge-case matrix

| Case | Required behavior |
|---|---|
| Invalid URL/origin/assertion | Reject before durable creation with safe field issues |
| Private/reserved/mixed DNS answer | Reject admission; expose no sensitive DNS detail |
| Runtime DNS differs/rebinds | Block navigation/request; evaluation/run inconclusive |
| Unsafe redirect | Block before connection; inconclusive if run started |
| Actual destination cannot be enforced | Capability blocked; do not schedule generic targets |
| POST/body/WebSocket/beacon attempt | Block, emit safe policy event, inconclusive |
| Auth/password/file/payment/message/submit control | Block before interaction, inconclusive |
| Unknown-effect click/Enter | Block; never guess |
| Target unavailable | Inconclusive |
| Solari 429 | Lower capacity, retry same run, no duplicate |
| Provider session acknowledged then connect fails | Close if created, release in finally, persist cleanup result |
| Agent asks to finish | Drain actions and capture evidence; belief ignored |
| Assertion not found on complete stable evidence | Observed false → failed if all other assertions verifiable |
| Assertion not found on truncated/unsupported evidence | Unverifiable → inconclusive |
| Ambiguous state locator | Unverifiable → inconclusive |
| Page changes during capture | Retry twice; then inconclusive |
| Policy violation plus apparently passing DOM | Inconclusive; policy precedence wins |
| One false and one unverifiable assertion | Inconclusive |
| All assertions observed true | Passed, limited to observable state |
| Cancellation | Cancelled; cleanup mandatory; no silent grade |
| SSE disconnect | Refetch snapshot and reconnect for new events |
| DB unhealthy | Stop scheduling, cleanup active runs, report unavailable |
| Replay pending/unavailable | Honest status; grade unaffected |
| Potential session leak | Block acceptance |

---

## 13. Tradeoffs and rejected alternatives

- **Observable assertions instead of backend truth:** generic sites provide no trusted admin evidence. The limitation is explicit and testable.
- **Assertions hidden from the model:** prevents the model from targeting or parroting grader details; may reduce success but improves evaluation integrity.
- **Conservative effects over broad task coverage:** unknown actions are blocked. Safety outweighs convenience.
- **No generic WebMCP invocation:** arbitrary page-described tools cannot be proven safe. Discovery-only retains evidence without granting authority.
- **Fresh capture instead of last agent observation:** costs latency but prevents stale/compacted/model-shaped evidence.
- **INCONCLUSIVE for unverifiable evidence:** avoids converting instrumentation limitations into site/model failure.
- **Exact bounded assertion DSL instead of scripts/regex/selectors:** less expressive, far safer and more reproducible.
- **Single-origin default:** reduces redirect/SSRF surface. Up to three origins require explicit admission.
- **Fixture-only Demo Store:** preserves deterministic CI and adversarial cases without making the product depend on privileged target state.
- **Process-local queue/SSE:** sufficient for P0; distributed systems would add failure modes without improving judged truth.

---

## 14. File-by-file impact

| Path | V2 responsibility |
|---|---|
| root configs / lockfile | exact runtime/pins and frozen installation; no pivot dependency churn without measured need |
| `AGENTS.md` | pivot quarantine, ownership, contract and lock rules |
| `packages/shared/src/config.ts` | V2 target, origins, prompt, assertions, policy version |
| `packages/shared/src/grading.ts` | assertion evidence/results and deterministic outcomes |
| `packages/shared/src/agent.ts` | safe semantic action contracts; no production native tool |
| `packages/shared/src/errors.ts` | policy/admission/assertion/provider safe errors |
| `packages/shared/src/events.ts` | policy/evidence/generalized grading milestones |
| `packages/shared/src/ports.ts` | admission, atomic persistence, factory, safe action, capture, grader ports |
| `packages/shared/src/demo.ts` | removed from production exports; fixture/legacy only if retained |
| `packages/shared/testing/*` | atomic fakes, policy/evidence fixtures and negative cases |
| `packages/solari` | lease/controller/replay plus enforceable destination, request, and effect policy |
| `packages/discovery` | bounded semantic observation/refs and discovery-only metadata |
| `packages/ai` | pinned adapter and tools bound only to safe executor |
| `packages/agent` | assertion-blind prompt, budgets, serialized safe runner |
| `packages/grading` | pure generic assertion grader |
| `packages/evaluation` | admission-aware submission, queue, executor, aggregation, cleanup |
| `packages/db` | V2 migration, generalized evidence/grade/policy persistence |
| `apps/web` | V2 composition, API, snapshot/SSE, generic UX |
| `apps/demo` | deterministic positive/adversarial fixture only |
| `tests/e2e` | fixture and real multi-site Solari/policy/cleanup acceptance |
| `docs/evidence` | historical evidence plus pivot/safety/acceptance records |

---

## 15. Verification strategy

### 15.1 Commands

```bash
cd examples/tracegate
node --version
pnpm --version
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
pnpm probe:target-safety
pnpm test:e2e:solari
pnpm verify
```

Configured credentialed suites must not silently skip. Unconfigured probes report “not configured” honestly, but final P0 evidence requires successful configured acceptance.

### 15.2 Required automated coverage

- V2 target/origin/assertion accept/reject fixtures, bounds, unique IDs, and schema version separation.
- Public/private/reserved/mixed DNS, redirect hop, rebinding, unresolved destination, and alternate-protocol cases.
- Network method/body/beacon/WebSocket mutation blocking.
- Auth, payment, messaging, upload/download, permission, submit, popup, iframe, and unknown-effect policy cases.
- Assertion/model-context separation tests.
- URL/text/semantic/state truth tables and normalization.
- Fresh capture stability/retry, truncation, ambiguity, unsupported state, and evidence-hash validation.
- Exact outcome precedence, including false plus unverifiable → inconclusive.
- Atomic evaluation/run/queued-event creation and atomic intermediate transition/event append.
- Bounded queue/429 capacity degradation, no duplicate runs, and permit release.
- Finally cleanup after every acknowledged provider session ID.
- Generic aggregation and zero denominators.
- Redaction seeded with fake keys, CDP/replay URLs, sensitive values, and hostile page content.
- V2 migration, snapshots, persisted events, publish-after-commit, reconnect/refetch.
- Prompt injection and attempts to discover assertions or policy internals.
- Demo fixture proves the same public V2 assertion path with no privileged grader.

### 15.3 Manual/credentialed acceptance

1. Verify public fork relationship, branch, visibility, and workspace placement.
2. Prove TG-002R destination enforcement with real Solari, including a denied private/reserved/rebinding case.
3. Run a safe fixture task through the full generic path without Demo admin evidence.
4. Run at least two materially different admitted public HTTPS sites through real Solari using safe read-only/reversible tasks and different assertion kinds.
5. Confirm assertions never appear in prompts, tool schemas/results, model history, agent trace, or the evaluated target page’s input/content; confirm they remain visible only in TraceGate authoring/report UI.
6. Attempt every prohibited action category; confirm block + INCONCLUSIVE + cleanup.
7. Force unstable/truncated/ambiguous evidence; confirm INCONCLUSIVE.
8. Run three repetitions; recalculate all counts/denominators from DB.
9. Refresh/reconnect during live execution; confirm authoritative snapshot recovery.
10. Compare acknowledged provider session IDs with release records; any mismatch blocks acceptance.
11. Confirm no private addresses, credentials, CDP/replay URLs, full DOMs, or sensitive assertion values in DB/logs/SSE/export.
12. Verify report and video state that PASS proves browser-observable assertions only.
13. Send SIGINT/SIGTERM during active work; confirm bounded cleanup.
14. Use only real measured results in submission assets.

---

## 16. Risks and capability gates

| Risk | Required gate/mitigation | Allowed degradation |
|---|---|---|
| Actual remote destination cannot be inspected/enforced | TG-002R Solari/proxy proof | None; V2 P0 blocked |
| DNS rebinding or unsafe redirect | Per-hop runtime destination enforcement | None; block target/run |
| Generic action has hidden side effect | Conservative effect + network mutation policy | Block/INCONCLUSIVE |
| GET endpoint has hostile side effect | Anonymous isolated scope and explicit limitation | Site/task unsupported; never claim absolute business safety |
| Dynamic page never stabilizes | Bounded revision-consistent capture retries | INCONCLUSIVE |
| Poor accessibility/canvas/shadow/cross-frame target | Semantic evidence reason codes | INCONCLUSIVE |
| Prompt requests prohibited action | Admission UX plus authoritative runtime block | Reject or INCONCLUSIVE |
| Assertions expose sensitive values | Schema limits, sensitive-control block, redaction | Reject/unverifiable |
| Solari capacity below requested | Typed 429 degradation | Lower real concurrency |
| Recording unavailable | Capability gate | Runs continue; replay unsupported |
| DeepSeek incompatible with safe surface | Production-shaped recheck | P0 blocked until one verified model works |
| DB unhealthy | Health gate and cleanup | Stop scheduling |
| Cleanup uncertainty | Durable session/release reconciliation | Acceptance blocked |
| Contract churn | TG-006R freeze and sole shared owner | Checkpointed changes only |

---

## 17. Revised implementation gates

### TG-000 — Public cookbook fork and placement — retained PASS
- **Goal:** Keep the compliant public fork and TraceGate placement.
- **Done when:** Existing repository/fork/branch/visibility evidence remains valid.
- **Mutation:** None for pivot.

### TG-001 — Runtime/workspace preflight — retained PASS
- **Goal:** Preserve exact measured runtime and dependency pins.
- **Done when:** Existing pins still install/build; deviations require measured evidence.

### TG-002 — Historical Solari/connectivity spike — retained PASS
- **Goal:** Preserve the real provider/connectivity/capacity/recording/replay result.
- **Limitation:** Not generic-site safety evidence.

### TG-002R — Generic-target safety feasibility
- **Goal:** Prove enforceable public destination, redirect, DNS-rebinding, private-address, egress, request-method, and effect blocking in real Solari.
- **Done when:** Actual connection destinations are observable/enforceable; private/reserved and mutation probes are blocked; cleanup is reconciled; redacted evidence exists.
- **Stop rule:** If runtime destination enforcement is unavailable, V2 P0 is blocked rather than weakened.
- **Owner:** B with A acceptance.

### TG-003 — TanStack/OpenRouter compatibility — retained PASS
- **Goal:** Preserve DeepSeek verification.
- **Done when for V2:** The safe reduced tool surface compiles and one production-shaped smoke remains green; optional models stay unverified unless remeasured.

### TG-004R — V2 shared contracts
- **Goal:** Replace Demo target/grading production contracts with V2 target, assertion, evidence, policy, error, event, and port schemas.
- **Done when:** Closed fixtures and negative tests cover bounds, assertion isolation, outcome precedence, atomic ports, factory, and typed 429; downstream lanes compile.
- **Owner:** A.

### TG-005 — Historical persistence/SSE feasibility — retained PASS
- **Goal:** Preserve measured libSQL/Drizzle/snapshot/SSE facts.
- **Limitation:** Does not prove V2 privacy/schema.

### TG-005R — V2 persistence/privacy refresh
- **Goal:** Prove V2 config/assertion/evidence/policy persistence and projection without DOM/sensitive leakage.
- **Done when:** Pivot migration, snapshot, event publication, reconnect/refetch, redaction, and legacy-row handling pass.
- **Owner:** D with A acceptance.

### TG-006 — Historical V1 freeze — retained as superseded checkpoint
- **Goal:** Preserve ownership/evidence history.
- **Limitation:** V1 Demo contracts are not V2 production authority.

### TG-006R — Generic-site V2 pivot freeze
- **Goal:** Integrate TG-002R/TG-004R/TG-005R, regenerate the sole lockfile after manifests settle, update ownership/interfaces, and authorize Wave 1.
- **Done when:** Full frozen install/typecheck/test/build, redaction/ownership audit, lane acknowledgements, exact shared tree/lock hash, and explicit gate evidence are green.
- **Owner:** A.

### TG-007 — Generic evaluator and grader
- **Goal:** Implement bounded one-evaluation queue, atomic submission/transitions, run executor, pure assertion grader, outcome precedence, aggregation, and fake-port tests.
- **Done when:** Queue/state/assertion/aggregation tests pass and every acknowledged provider session releases in `finally`.
- **Owner:** A.

### TG-008 — Safe browser, admission, discovery, and fixture slice
- **Goal:** Implement public admission, runtime destination/egress/effect enforcement, semantic observations, stable evidence capture, and fixture-only Demo coverage.
- **Done when:** Real Solari safely observes an admitted site, blocks prohibited probes, captures stable assertion evidence, and releases without capability leakage.
- **Owner:** B.

### TG-009 — Assertion-blind safe agent slice
- **Goal:** Implement DeepSeek loop, prompt, budgets, serialized safe tools, cancellation, history bounds, and event mapping without assertions/native tools.
- **Done when:** Agent sees only prompt/safe observations, cannot access assertions or raw controller, and provider/tool failures map safely.
- **Owner:** C.

### TG-010 — V2 DB/API/minimal UI
- **Goal:** Implement pivot migration, repositories, V2 API/snapshot/SSE, target/prompt/assertion form, and minimal report.
- **Done when:** V2 create/live/report flow persists and reconnects without Demo-admin or sensitive evidence dependency.
- **Owner:** D.

### TG-011 — Single-run generic checkpoint
- **Goal:** Integrate one full fixture run and one approved external read-only canary through the same V2 path.
- **Done when:** Real Solari, safe agent, fresh evidence, grade, persistence, UI, and cleanup are truthful and green.
- **Dependencies:** TG-007–TG-010.

### TG-012 — Repeated generic orchestration/reporting
- **Goal:** Run three isolated repetitions with bounded capacity and truthful aggregation.
- **Done when:** No duplicate runs/state leakage, all denominators recalculate, and capacity never exceeds measured safe limits.

### TG-013 — Policy, security, and cleanup evidence
- **Goal:** Prove prohibited actions, SSRF/redirect/rebinding, mutation blocking, prompt injection, evidence privacy, shutdown, and session reconciliation.
- **Done when:** Every adversarial case blocks safely and all acknowledged sessions reconcile.

### TG-014 — Non-blocking P1
- **Goal:** Add only high-value capability-gated replay, optional models, richer safe assertions, or discovery polish.
- **Critical path:** No. Skip without weakening P0 truth.

### TG-015 — Complete product UX
- **Goal:** Finish accessible configure/live/report states, admission feedback, assertion builder, policy/evidence explanations, and degraded/empty/error states.
- **Done when:** UX is usable and accurately communicates scope/limitations.

### TG-016 — P0 feature-complete checkpoint
- **Goal:** Freeze a real repeated generic evaluation and all acceptance evidence.
- **Done when:** Full suite, real multi-site Solari acceptance, zero unaccounted sessions, truthful metrics, safety gates, and privacy audit pass.

### TG-017A — Evaluation/grading verification
- Assertion truth tables, evidence precedence, atomicity, queue, aggregation, cleanup.

### TG-017B — Browser/target verification
- Public-network enforcement, redirects/rebinding, effect policy, stable evidence, fixture isolation, release/replay.

### TG-017C — AI/agent verification
- Assertion blindness, prompt injection, tool confinement, provider errors, budgets/history/cancellation.

### TG-017D — DB/SSE/UI verification
- Migration, redaction, snapshots/SSE, assertion UX, report math, degraded and zero-denominator states.

### TG-018 — Submission acceptance and polish
- **Goal:** Produce final README/video/evidence and run the submission checklist.
- **Done when:** Repository and measured results are public, links/assets are accurate, limitations are explicit, all sessions reconcile, and no P1 omission is presented as P0.
- **Important:** Do not submit a PR; submission is the user’s task.

### Critical path

```text
TG-000 → TG-001
  → (TG-002R, TG-003, TG-004R)
  → TG-005R
  → TG-006R
  → (TG-007, TG-008, TG-009, TG-010)
  → TG-011
  → (TG-012, TG-013, TG-015)
  → TG-016
  → TG-017A/B/C/D
  → TG-018
```

TG-014 is explicitly off the critical path.

---

## 18. Submission checklist

- [ ] Public repository is visibly a fork of `solari-sdk/solari-cookbook`.
- [ ] TraceGate remains under `examples/tracegate/`.
- [ ] Exact runtime/dependency pins and final lock hash are recorded.
- [ ] TG-002R proves actual public destination/egress/mutation enforcement in real Solari.
- [ ] DeepSeek or another declared P0 model is currently verified through the production-shaped safe tool path.
- [ ] Assertions are absent from model context/history/tools/agent trace and the evaluated target page’s input/content; TraceGate authoring/report UI may display them.
- [ ] PASS/FAIL/INCONCLUSIVE truth tables and fresh evidence tests are green.
- [ ] PASS is described only as declared browser-observable assertion success.
- [ ] At least two materially different real public HTTPS sites have safe Solari acceptance evidence.
- [ ] Demo Store is fixture-only and no production grader/admin dependency remains.
- [ ] All prohibited action categories block safely.
- [ ] All acknowledged provider sessions reconcile to release results.
- [ ] No secret, sensitive data, private address detail, CDP/replay URL, or full DOM is durable or public.
- [ ] Snapshot/SSE refresh and reconnect are verified.
- [ ] Raw counts, denominators, medians, usage, interface, and environment claims recalculate from persisted data.
- [ ] No fabricated, edited, scripted, or hard-coded result is presented as measured.
- [ ] README/video show a real evaluation and state limitations honestly.
- [ ] AI-assisted development is disclosed accurately.
- [ ] Public repository URL, demo/video URL, and social-post URL are recorded in README/submission.
- [ ] Do not submit a PR; that is the user’s task.
- [ ] P1/P2/deferred omissions are stated honestly.

---

## 19. Remaining resolved blockers and questions

### Blocking before V2 implementation

1. **Actual destination enforcement:** Can Solari/CDP or a controlled proxy expose and deny the resolved IP before each connection, redirect, and re-resolution? TG-002R must answer with measured evidence.
2. **Network mutation enforcement:** Can the runtime reliably block agent-caused non-idempotent requests, beacons, WebSocket sends, downloads, and service-worker bypass? If not, generic V2 is blocked.

### Frozen product decisions

- Generic user-submitted public HTTPS targets and prompts: approved.
- Assertions: 1–20 required bounded URL/text/semantic/state assertions.
- Assertion secrecy: kept out of model context.
- Evidence: fresh stable browser capture only.
- Unverifiable required evidence: INCONCLUSIVE.
- Safe anonymous reversible tasks only; prohibited categories are closed above.
- Demo Store: fixture only.
- Generic WebMCP invocation: disabled.
- PASS meaning: browser-observable assertion satisfaction, not arbitrary backend truth.

Any relaxation requires a new explicit plan checkpoint; it cannot be introduced as an implementation shortcut.

---

## 20. References

- Existing TraceGate evidence under `docs/evidence/`.
- Solari SDK/cookbook and measured TG-002 connectivity evidence.
- TanStack AI/OpenRouter measured TG-003 compatibility evidence.
- Zod v4, Drizzle/libSQL, TanStack Start, React, Turbo, pnpm and Playwright versions recorded in `docs/evidence/runtime.md`.
- OWASP SSRF Prevention guidance and public/reserved IP registries must be consulted during TG-002R implementation and evidence review.
