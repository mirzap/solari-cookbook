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

TraceGate runs the task in isolated Solari Browser sessions, records a redacted assertion-blind agent trace, captures bounded operationally stable evidence after the agent stops acting, evaluates assertions only in the separate grading control plane, releases every acknowledged provider session, and reports truthful reliability metrics.

A **PASS** proves only that the declared assertions were satisfied in the final browser-observable state captured by TraceGate. It does not prove arbitrary backend business truth, durable server-side effects, legal completion, payment, delivery, message publication, identity, authorization, or any fact outside the admitted evidence model.

### 1.1 Allowed product scope

Submission P0 permits anonymous public browsing tasks only within the closed detectable-effect policy in §5. “Safe” is shorthand for that policy boundary, not a claim of backend reversibility or harmless GET behavior. Allowed examples include:

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
6. Assertion isolation is enforced as a provenance/non-flow guarantee: assertion-origin values cannot flow into the assertion-free agent DTO, prompt layers, tool schemas/results, model events/history, agent trace, or evaluated-target traffic. Assertion-only canaries prove the boundary; coincidental lexical overlap with user/site text is not treated as leakage. Assertions remain visible in TraceGate’s local authoring and grading/report control plane.
7. The grader uses a bounded operationally stable evidence capture after the serialized action queue drains.
8. PASS/FAIL/INCONCLUSIVE follows the frozen precedence in §7.8.
9. Missing, truncated, ambiguous, unstable, unsupported, or otherwise unverifiable required evidence produces INCONCLUSIVE.
10. One fixture evaluation and real multi-site Solari acceptance runs prove the same generic path without privileged grading.
11. Three repeated runs produce auditable raw counts and correct denominators.
12. Every acknowledged Solari session has a durable release result; any potential leak blocks acceptance.
13. Snapshots and SSE recover after refresh/reconnect without treating SSE as authoritative state.
14. Seeded audits show known credential/secret/CDP/replay/challenge patterns are rejected or redacted and no full DOM is durable; residual risk for user-authored prompt/assertion text is disclosed rather than denied absolutely.
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
| TG-003 | PASS for P0 `deepseek/deepseek-v4-flash-0731` through pinned TanStack/OpenRouter; optional models unverified | Historical only; the one post-V2 smoke belongs to TG-009/TG-017C |
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
- The model input is constructed only from four typed layers: fixed server system policy, separate user task, bounded public capability summary, and explicitly untrusted observations/tool results.
- A dedicated assertion-free `AgentExecutionInputV2` is schema-parsed from an allowlist and shares no grading DTO/object reference. Assertion-origin values cannot flow into prompts, tools, model events/history, agent trace, or evaluated-target traffic.
- Assertion isolation is a provenance/non-flow property verified with assertion-only canaries; it is not an impossible global lexical-absence claim because user/site text may independently contain the same words.
- The run executor owns the raw browser controller and injects only a dynamically reduced policy-enforcing safe tool port into the agent.

### 3.3 Runtime topology

```text
Loopback-only local browser/client
  → apps/web V2 API bound only to 127.0.0.1/[::1]
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

`apps/demo` may be served during tests, but production configuration uses `kind: "public-web"` and has no Demo admin URL, challenge token, scenario ID, or privileged grader dependency. P0 control-plane API, report, trace, SSE, and replay surfaces bind to loopback only and are never exposed through the public target tunnel, LAN, or remote host.

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
- V1 Demo configuration is unsupported by the V2 API. TG-005 spike databases are disposable; no V1 product reader or conversion path is built.

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

Browser-captured accessibility semantics are normalized evidence, but roles, accessible names, ARIA state, visible text, and attributes remain page-authored untrusted content. They may satisfy declarative assertions after stable capture; they never certify action safety, reversibility, network effect, identity, or backend truth. CSS, XPath, DOM IDs, and positional indexes are forbidden.

#### State assertion

```text
kind: "state"
locator: same semantic locator; must resolve to exactly one element
property: "checked" | "selected" | "expanded" | "disabled" | "value"
expected: boolean or bounded string according to property
```

`value` is allowed only for admitted non-sensitive search/filter controls. It is bounded and centrally redacted; sensitive-control detection makes the assertion unverifiable and blocks interaction. State never means cookies, storage, authentication, server database state, network success, payment, publication, or cross-origin iframe contents.

### 4.3 Assertion-free agent DTO and prompt layers

`AgentExecutionInputV2` is the sole data DTO accepted by the agent lane and is fully Zod-parsed/serializable:

```text
schemaVersion: 2
systemPolicyVersion: "public-safe-v1"
userTask: bounded user-authored prompt
capabilities: bounded public capability summary
initialObservation: explicitly UntrustedAgentObservation
budgets: independent wall-clock/model-turn/tool-call/browser-action/history/token limits
```

`SafeAgentToolPort` is a separate non-serializable runtime dependency injected as `AgentRunner.run(input, safeToolPort, signal)`. It is capability-reduced before injection and cannot be reached by object traversal from the DTO.

Prompt construction is ordered and typed:

1. fixed server-owned system safety/behavior policy;
2. separate user task, explicitly untrusted and unable to amend policy;
3. bounded public capability summary derived from admitted runtime capabilities;
4. explicitly untrusted browser observations and tool results as conversation content.

The DTO has no assertion, expected-result, grader, evidence, raw controller, secret, replay, or provider-capability field. Construction uses schema parsing/field allowlisting rather than object spreading. Tests place random canaries exclusively in assertion IDs/labels/expected values, propagate provenance labels through configuration handling, and verify those values never reach DTO serialization, prompt layers, tool definitions/results, provider requests/events, history, agent trace, or evaluated-target traffic. The test does not fail merely because unrelated user/site text happens to equal an assertion word.

Agent trace and grading evidence are separate persisted/projection types and separate UI panels. Grading events may reference assertion IDs/statuses only in the local control plane; they never join the agent conversation or agent trace projection.

### 4.4 Evidence contracts

`AgentObservation` remains model-oriented and is not grade evidence. It may be compacted and truncated.

A separate trusted capture contract is required:

```text
TransientCanonicalCaptureV1                # in-memory grading only
  canonicalFinalUrl: full canonical URL | null
  documentId / loaderId: stable main-frame identity
  capturedAt: UTC timestamp
  assertionObservations: normalized bounded results
  evidenceHash: digest of accepted canonical observable fields and bounded assertion-evidence envelope

BrowserAssertionEvidenceV1                 # persistable/control-plane DTO
  schemaVersion: 1
  capturedAt: UTC timestamp
  redactedDisplayUrl: bounded centrally redacted URL
  documentIdHash / loaderIdHash: bounded non-capability identifiers
  quietIntervalMs: frozen policy value
  requiredIdenticalCaptures: 2
  captureAttempts: integer 2..3
  evidenceHash: bounded digest matching the accepted capture/envelope derivation
  policyActivity: bounded summary
  assertions: AssertionEvidence[1..20]
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

Stability is an operational bounded observation, not proof that every page mutation was detected. `public-safe-v1` freezes: serialized action queue empty; a 750 ms quiet interval; continuous relevant-activity monitoring from the start of quiet through acceptance; same main-frame document/loader identity; two consecutive byte-identical canonical captures; at most three capture attempts; and a 5 second capture deadline. Any relevant network, navigation, popup, download, dialog, or policy activity resets the quiet interval and capture sequence; if the deadline/attempt bound prevents reacquiring two identical captures, evidence is unverifiable. Any mismatch, identity change, timeout, or inability to observe these signals is likewise unverifiable.

The full canonical final URL exists only in `TransientCanonicalCaptureV1` long enough to evaluate URL assertions. Persistence, logs, events, reports, and SSE receive only `redactedDisplayUrl`, assertion booleans/statuses, and bounded hashes/summaries. If the URL contains a value that the redaction/retention policy cannot safely retain or compare without exposing it, URL equality evidence is `unverifiable`; TraceGate does not persist a secret-derived equality proof.

The evidence schema never contains a full DOM, arbitrary HTML, raw network response, credentials, sensitive entered data, CDP/replay capability, or page-provided script result. Browser-captured text and accessibility semantics remain explicitly untrusted page-authored content even after canonicalization.

### 4.5 Grade result

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

### 4.6 Runtime ports

Required cross-lane ports:

- `TargetAdmissionPort.assess(target, signal)` returns an admitted canonical target or a safe rejection; it never returns raw DNS/provider material to the client.
- `EvaluationSubmissionRepository.transactionallyCreate(...)` atomically creates the evaluation, all run rows, and all `run.queued` events for one accepted request. HTTP create retry/idempotency is not promised in P0.
- `RunTransitionRepository.transactionallyApply(...)` atomically applies an intermediate legal transition and its matching milestone.
- `BrowserProvider.acquire(...)` returns a lease or a typed safe error.
- `BrowserControllerFactory.create(lease, signal)` returns a fresh controller bound to that lease.
- `ProviderSessionReconciliationPort.reconcileCreate(attemptCorrelationId, signal)` uses a TG-002R-measured provider inventory/correlation mechanism to classify an ambiguous create without retrying it; safe correlation metadata is durable and is neither a credential nor an idempotency claim.
- `BrowserController` owns reviewed browser operations and explicit idempotent `close`.
- `SafeAgentToolPort` exposes only policy-reviewed actions to the agent.
- `AssertionEvidenceCapture.capture(assertions, signal)` runs after the action queue drains on the same controller and returns integrity-trusted capture metadata over explicitly untrusted page-authored content.
- `Grader.grade(assertions, evidence, signal)` returns `GradeResultV2`.
- Existing event, snapshot, repository, replay, clock, ID, failure-analysis, and terminal-finalization ports remain AbortSignal-aware.

`AgentRunContext` is replaced by the dedicated data-only schema-parsed `AgentExecutionInputV2` above. The agent runner receives the separately injected `SafeAgentToolPort`; assertions and grading evidence use a separate control-plane path and never share an object graph with either the DTO or port construction.

### 4.7 Typed provider capacity error

Acquisition-time provider concurrency limits use a strict safe error:

```text
code: "concurrency_limit_exceeded"
category: "infrastructure"
phase: "browser_acquire"
sessionCreation: "definitively_not_created"
retryCurrentCreate: false
retryAfterMs: integer 0..300000 | null
```

`retryAfterMs` is normalized future-scheduling/capacity metadata, never permission to retry the current create and never a raw header. Provider bodies, headers, URLs, request IDs, capabilities, and arbitrary messages are forbidden from the safe value. If `sessionCreation` cannot truthfully be classified as `definitively_not_created`, this typed 429 form cannot be used; the result is ambiguous/potential-leak handling.

---

## 5. Public-network admission and runtime safety

### 5.1 Admission gate

Before durable evaluation creation, admission must:

1. Parse canonical HTTPS start URL and origins.
2. Reject credentials, unsupported ports, IP-literal hosts, localhost, `.local`, and malformed internationalized names.
3. Resolve A and AAAA records through an audited resolver.
4. Reject any private, loopback, link-local, carrier-grade NAT, multicast, documentation, benchmark, reserved, unspecified, or cloud-metadata address.
5. Reject mixed public/private answer sets.
6. Perform any discovery/reachability fetch only through the same proven enforced browser/network path, or through a separately reviewed control-plane fetcher pinned to a vetted public IP:port set with pre-connect enforcement; an ordinary ambient Node/server fetch is forbidden.
7. Validate every redirect hop against the same scheme, origin, DNS, actual pre-connect IP:port, and address rules.
8. Return only canonical safe admission metadata and an expiry/recheck time.

Admission is necessary but insufficient: runtime must enforce the actual resolved destination used by the remote browser.

### 5.2 DNS rebinding and destination enforcement

P0 is blocked unless either the provider enforces destination policy server-side or every browser/browser-process connection is forced through a TraceGate-controlled outbound proxy that observes and denies the **actual IP:port before connection**. URL routing, CDP request interception, DNS preflight, hostname allowlisting, and post-response IP observation are useful defense-in-depth signals but cannot make TG-002R PASS.

The enforcement boundary must cover main-frame and subframe navigation; every redirect hop; fetch/XHR; script, style, image, font, and media; prefetch/preload/speculation rules; dedicated/shared/service workers; EventSource; beacon; WebSocket; WebTransport; WebRTC including STUN/TURN/data channels; popups/new windows; downloads; and browser-process traffic such as DNS, update, telemetry, certificate, or captive-portal probes. For every context it must:

- validate the actual destination IP:port, HTTPS/protocol, origin relation, method, resource class, and credential state before connection;
- reject any request class whose destination, resolution, protocol, or initiator cannot be observed and enforced;
- revalidate each redirect, DNS change, connection reuse decision, and admission expiry;
- block private/reserved/metadata destinations even when the hostname passed admission;
- start in a fresh non-persistent browser context with service-worker registration and service-worker-controlled requests blocked;
- prevent alternate protocols, direct/proxy bypass, off-policy navigation, and unresolved worker/subresource/browser-process egress;
- record only bounded safe policy codes rather than raw network details.

TG-006R freezes an exhaustive request decision table over `protocol/transport × method-or-not_applicable × resource/request context × origin relation × credential state × actual-destination observability`, including every context above. Each cell is an explicit allow or deny with required pre-connect IP:port enforcement; unknown, missing, or unobservable cells deny. DNS, UDP, STUN/TURN, WebRTC data channels, certificate probes, and other methodless/browser-process traffic use `not_applicable` rather than falling outside the table. TG-002R cannot pass unless every non-HTTP path is forced through equivalent pre-connect actual-IP:port enforcement or is proven blocked before transmission. TG-002R is a disposable feasibility prototype; TG-008 is the separately reviewed production implementation and inherits no acceptance credit from it.

### 5.3 Network mutation and subresource policy

For `public-safe-v1`, all browser egress is default-deny:

- Main-frame navigation is limited to declared admitted origins and HTTPS `GET`/`HEAD`.
- Third-party static subresources may use HTTPS `GET`/`HEAD` only when their actual destination is public and enforceable; permitted resource classes are script, style, image, font, and media under bounded size/time/count budgets.
- Cross-origin fetch/XHR, frames, prefetch/preload, and workers are blocked unless a TG-002R-tested deterministic rule explicitly permits the request class. Service workers remain disabled.
- `OPTIONS` is allowed only as an empty-body public-destination preflight for an otherwise permitted safe request.
- POST, PUT, PATCH, DELETE, CONNECT, unknown methods, request bodies, beacons, WebSocket connections/sends, form mutation, downloads, and external protocols are blocked.
- Every redirect repeats method, origin, DNS, address, destination, and resource-class checks.
- Runs start with no preloaded cookies, HTTP authentication, client certificates, or authorization. Ephemeral anonymous cookies created during the run may accompany permitted GET/HEAD requests but never certify authentication or broaden policy; authorization headers and explicit credentials are always blocked.

A request is denied when its method, body, initiator, resource class, redirect, actual destination, or credential state cannot be classified. Here “safe/reversible” means only that the action is within this closed, detectable-effect policy; it does not prove that a nominal GET has no backend side effect or that backend state is reversible.

Before the first agent action, TraceGate records bounded passive blocked-page telemetry. Passive baseline blocks may be reported as warnings when deterministic evidence remains complete and no later action window overlaps them. A **causal action window** begins immediately before one serialized action dispatch and covers its synchronous work, microtasks, redirects, requests, workers, popups, dialogs, and downloads until the action reaches the fixed post-action quiet condition or times out. Initiator, request, frame, document, and loader identifiers link observed effects where available. Any prohibited activity inside that window, or prohibited activity after dispatch whose cause cannot be classified, emits `run.policy.blocked` and makes the run INCONCLUSIVE even if optimistic DOM state appears successful.

### 5.4 Trusted action/effect policy

The browser adapter, not the prompt, model, or page-authored accessibility semantics, is authoritative. Immediately before dispatch it evaluates a closed typed effect decision using the current observation revision, element/control class, form method, admitted origin, predicted request/resource class, sensitivity, popup/download behavior, and policy state. The only decision is `allow` for a named reviewed effect class or `deny` with a bounded code; unknown, stale, ambiguous, or unobservable effects deny.

Allowed actions include inspect, wait, bounded scroll, admitted GET navigation, reviewed disclosure/tab/menu/filter/select controls, and typing into non-sensitive search/filter controls. Browser roles/names/ARIA/text may locate a candidate but never certify its effect safety.

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
2. Any agent-caused prohibited action/request, or prohibited post-action activity whose cause cannot be classified, produces `inconclusive` with `unsafe_action_blocked`, regardless of visible state. Passive blocked-page telemetry captured before the first action may remain a warning only under §5.3.
3. If a fresh capture with trusted integrity/provenance cannot be validated, or any required untrusted page-authored observation is unverifiable, the outcome is `inconclusive`.
4. When a complete integrity-validated capture exists and no higher-precedence condition applies, all assertions true produces `passed`; any false assertion produces `failed`.
5. Provider, model, budget, or agent-loop errors are terminal failure codes only when they prevent a complete integrity-validated capture. If complete evidence is captured afterward, PASS/FAIL remains authoritative and the execution error is retained only as a bounded warning/trace fact.

Every terminal non-cancelled run has exactly one `passed`, `failed`, or `inconclusive` grade outcome. A terminal lifecycle/infrastructure/provider/execution failure without a complete grade maps to `inconclusive`; no terminal run falls outside aggregation.

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

Consume AG-UI/TanStack streams through the strict lifecycle state machine in §7.4: one start, ordered bounded phases/deltas with matched tool-call IDs, one terminal, and nothing after terminal. Validate/redact before bounded milestone persistence, enforce independent usage/history limits, and never expose raw provider streams directly as product SSE.

Assertion-origin values and grader evidence cannot flow into model context or TanStack events. Unknown events become warnings only when lifecycle validity and safety are unaffected; malformed, duplicate, out-of-order, unmatched, or post-terminal events fail closed as `provider_protocol_error`.

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

The atomic repository operation leaves no partial graph and consumes no event cursors on conflict or abort. HTTP create retry/idempotency is intentionally deferred from P0; clients must not automatically retry an ambiguous create response.

### 7.2 One-evaluation queue and capacity

P0 allows one active evaluation and a process-global FIFO run queue. Effective Solari capacity is:

```text
min(requested concurrency, configured maximum, measured safe provider capacity)
```

Start from the measured safe cap recorded by TG-002, but do not exceed five. Each run makes exactly one Solari create attempt because provider idempotency is not established. A typed provider concurrency rejection that definitively acknowledges **no session creation**:

- releases the local permit;
- lowers process capacity by one, floor one, for later queued runs;
- records normalized bounded `retryAfterMs` only as scheduling/capability evidence;
- makes the current run INCONCLUSIVE without requeueing or retrying create;
- never raises capacity again without explicit capability refresh/restart.

Any timeout, disconnect, malformed response, or other ambiguous create result is not retried. It is recorded as a potential session leak and blocks acceptance until provider reconciliation proves whether a session exists and, if so, confirms release.

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
→ capture bounded operationally stable assertion evidence
→ pure deterministic grade
→ close controller
→ release Solari lease with fresh bounded signal
→ free permit
→ optionally poll replay status
→ transactionally persist terminal result and cleanup state
```

After any provider session ID is acknowledged, lease release is attempted in `finally` regardless of connection, model, policy, persistence, evidence, timeout, shutdown, or grading failure. Controller close is attempted before lease release, but close failure cannot suppress release. A release succeeds only under measured provider semantics with explicit positive confirmation; HTTP 404 is not success. Failed or ambiguous release remains retryable with a fresh bounded cleanup signal and is a potential leak until reconciliation confirms release. Replay polling is optional, occurs only after cleanup disposition is durable, and never gates grading.

### 7.4 Safe agent loop

The model receives only `AgentExecutionInputV2` and the four prompt layers in §4.3. It does not receive assertions, assertion IDs/labels, expected state, grader evidence, policy secrets, admin endpoints, raw provider capabilities, or raw controller access.

The following is an **upper bound**, not a promise that every tool is available on every page or turn:

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

The runtime constructs a dynamically reduced tool surface from admitted capabilities and current policy, omitting unavailable actions entirely. `callNativeTool` is removed from production. `pressKey` permits only a closed non-text navigation/editing set on reviewed non-sensitive controls; `Enter`, shortcut chords, function keys, and keys that may submit, activate, grant permission, escape confinement, or trigger an unclassified effect are denied.

Tool proposals enter one per-run FIFO. Immediately before dispatch, each proposal is revalidated against the current observation revision, semantic identity, admission, cancellation, deadline, and closed effect policy; stale proposals never execute. Wall-clock, model-turn, tool-proposal, executed-browser-action, history-byte/item, and token/usage budgets are independent and cannot be traded against one another. Cancellation interrupts stream consumption and queued work, prevents new dispatch, drains/rejects the FIFO deterministically, and proceeds to evidence/cleanup according to §6.3.

TanStack lifecycle handling is strict: exactly one valid start, ordered bounded deltas/tool phases, matched tool-call IDs, exactly one terminal event, and no events after terminal. Unknown events may become bounded warnings only when lifecycle validity and safety are unaffected. Duplicate/out-of-order/missing start or terminal, unmatched tool calls, invalid deltas, over-limit payloads, or post-terminal activity are `provider_protocol_error`; raw malformed content is never persisted or passed to tools.

Every accepted proposal validates Zod input, checks all independent budgets, executes under timeout and serialization, forces a fresh bounded untrusted observation after an effect, and emits redacted milestones. `finish` is a belief only and never grades the run.

### 7.5 Semantic observation and discovery

Opaque refs, deterministic DOM order, stale-revision rejection, semantic identity recheck, bounded visible text, and safe attributes remain.

Discovery may inspect same-origin `/llms.txt`, current-page JSON-LD, and WebMCP presence under strict size/redirect limits. Network discovery uses the already proven enforced browser/network path, or a separately vetted control-plane fetcher pinned to public IP:port destinations with the same redirect and pre-connect rules; ordinary ambient fetch is forbidden. All discovery is untrusted. Generic WebMCP is `unavailable`, `available_disabled`, or `discover_only`; it cannot broaden origins, actions, policy, or assertions.

Cross-origin iframe content is unavailable for action and grading in P0.

### 7.6 Bounded operational stability and evidence capture

After acting stops:

1. The model stream is terminal and the per-run FIFO is empty; no action remains queued or executing.
2. Wait a fixed 750 ms quiet interval with no relevant network, navigation, popup, download, dialog, or policy activity.
3. Keep relevant-activity monitoring armed and capture a bounded canonical observable-state projection and `evidenceHash`, including main-frame document and loader identity.
4. Repeat until two consecutive captures are byte-identical with the same document/loader identity; use at most three captures total and a fixed five-second grading deadline. Any intervening relevant activity resets the quiet interval and capture sequence.
5. Evaluate every assertion only against the accepted fresh canonical capture using fixed reviewed adapter logic.
6. If quiet is not achieved, captures differ, document/loader changes, relevant activity occurs, a field is truncated/ambiguous/unsupported, or the deadline expires, required evidence is unverifiable.

This is bounded operational stability, not a claim of perfect revision/change proof. Browser-captured accessibility and text remain page-authored untrusted content even when their canonical projection is stable.

The fixed capture implementation may use reviewed CDP/Playwright primitives internally. The model cannot invoke or parameterize arbitrary script. Capture integrity/provenance is trusted; captured page-authored text and accessibility semantics are not.

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

Always show raw counts derived from persisted run rows and terminal outcomes:

```text
requested       = count(all durable runs for the evaluation)
started         = count(runs with any persisted transition out of queued)
passed          = count(terminal run grade outcome = passed)
failed          = count(terminal run grade outcome = failed)
inconclusive    = count(terminal run grade outcome = inconclusive)
cancelled       = count(terminal run disposition = cancelled)
potential leaks = count(distinct runs with ambiguous create or non-confirmed release)
```

Because every terminal non-cancelled run has exactly one grade outcome, `requested = passed + failed + inconclusive + cancelled + nonterminal`; completed acceptance requires `nonterminal = 0`. Warnings never alter outcome counts. Run-scoped environment, discovery, admission, policy, grading, and cleanup evidence are joined by `runId`; no evaluation-level latest-value shortcut may substitute for a run record.

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

TG-005 databases are disposable spike state. TG-005R owns a clean generated V2 Drizzle `0000` migration and recreates the local database from it; there is no V1 product reader, converter, compatibility migration, or legacy-row machinery. TG-010 consumes that frozen migration/repository contract and must not regenerate or reinterpret it. Retain local libSQL, WAL, foreign keys, bounded busy timeout, short transactions, and the process-local writer queue.

Before creation, reject prompt/assertion values matching known credential, secret, financial, government-ID, signed-token, or similarly sensitive patterns. If central storage redaction would mutate the validated canonical prompt or assertion specification, reject it rather than changing its meaning. Accepted canonical prompts/assertions are stored unchanged in the local grading control plane under size bounds; redaction applies to derived display/log/event/trace projections. This is risk reduction, not proof that user text contains no sensitive data; the UI/report discloses residual local-storage risk and instructs users not to submit sensitive values.

Persist:

- V2 config/schema version, redacted display URL, exact allowed origins, prompt, assertions, and their specification hash;
- run-scoped execution environment/version evidence;
- run-scoped discovery evidence and provenance;
- run-scoped admission decision/expiry and bounded enforcement evidence;
- run-scoped policy version, passive baseline warnings, causal-window decisions, and violations;
- runs, usage, cleanup, optional replay status, warnings;
- evidence hash, capture status/attempt count, bounded per-assertion evidence summaries;
- generalized grade results and terminal failure;
- ordered redacted agent-trace events and separate control-plane grading events/steps.

The transient raw canonical URL used for URL grading is never durable or displayed. Persistence uses a separately redacted display URL plus bounded origin/equality evidence. If safe equality cannot be evaluated before discarding the raw value, the assertion is unverifiable.

Do not persist:

- full DOM/HTML, screenshots by default, arbitrary visible text dumps;
- credentials, sensitive typed values, authorization, cookies, storage;
- raw DNS/provider headers/bodies or private-address details returned to clients;
- raw canonical grading URLs, CDP endpoints, challenge URLs/tokens, or replay URLs;
- assertions or grading evidence in model conversation/history/agent-trace events.

Privileged Demo evidence is not equivalent to observable browser evidence.

### 8.2 API

P0 binds only to loopback (`127.0.0.1` and/or `[::1]`) and rejects non-loopback Host/forwarded-host exposure. There is no remote read, report, trace, SSE, replay, or mutation surface.

```text
GET  /api/health
GET  /api/capabilities
POST /api/targets/admit                 # bounded admission preview, rate limited
POST /api/evaluations                   # V2 only; no P0 create-idempotency promise
GET  /api/evaluations/:id               # authoritative typed snapshot
GET  /api/evaluations/:id/report        # bounded typed report projection
GET  /api/evaluations/:id/trace         # bounded assertion-blind agent trace projection
GET  /api/evaluations/:id/events        # new persisted control-plane milestones via SSE
```

The server revalidates all client input. Admission responses expose canonical safe status/reasons, not DNS internals. The report and trace are separate bounded schemas: the trace excludes assertions/grading evidence; the report may show assertions/results but excludes raw agent/provider/private evidence. P0 freezes cursor pagination at default 100/max 200 items, 16 KiB per projected item, 512 KiB per response, and explicit `truncated`/`nextCursor` fields; schema-specific string/array bounds may be lower.

### 8.3 SSE

SSE remains a loopback-only, process-local notification/projection channel. The snapshot-to-stream handoff is race-free:

1. subscribe and begin buffering committed events for the evaluation;
2. establish a ready handshake/cursor from the authoritative publisher;
3. read the authoritative snapshot at a cursor no earlier than the subscription boundary;
4. drain buffered events strictly after the snapshot cursor with ID deduplication;
5. enter live delivery; on gap, overflow, reconnect, or process restart, refetch snapshot and repeat.

DB commit precedes publish and only persisted redacted events publish. Every transaction family that appends an externally observable event—submission expansion, intermediate transition, policy/admission/evidence/grade milestones, terminalization, cancellation, cleanup/reconciliation, and warnings—has publish-after-commit and no-publish-on-rollback coverage. There is no public publish bypass.

P0 freezes: persisted/projected event payload ≤16 KiB, SSE frame ≤20 KiB, heartbeat every 15 seconds, per-subscriber queue ≤128 events and ≤512 KiB, buffered handoff ≤5 seconds, and ≤8 concurrent SSE connections per process. Oversize events are safely summarized before persistence; exceeding either queue bound disconnects the slow consumer with a bounded reason and requires snapshot recovery. SSE is never authoritative state.

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

The product rejects known secret/sensitive patterns before locally persisting accepted prompts/assertions and refuses tasks that require sensitive data. Pattern rejection and redaction are defense in depth, not proof of absence and not permission to collect sensitive material; residual risk is disclosed. The transient raw canonical URL used for grading is separated from the redacted persisted/display URL as defined in §8.1.

### 9.4 Replay

Replay remains optional P1 and capability-gated. Only provider session ID and safe replay status are durable. If implemented, fresh presigned replay access is requested server-side only after cleanup reconciliation, returned solely to the loopback reviewer surface, never logged/persisted/SSE-published, and discarded immediately. Replay absence never changes deterministic grading or P0 acceptance.

### 9.5 Cleanup and truthfulness

Solari create is attempted once per run absent provider idempotency. An ambiguous create is a potential leak and blocks acceptance until reconciled. Every acknowledged provider session must reconcile to an explicit positive release result under measured provider semantics; 404 is not release success. Failed/ambiguous release remains retryable, and any unknown or unreleased session blocks acceptance. Cancellation and shutdown use fresh bounded cleanup signals.

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
- One verified `deepseek/deepseek-v4-flash-0731` path through TanStack/OpenRouter, limited to one bounded post-V2 safe-surface credentialed smoke.
- One active evaluation, bounded Solari capacity and typed 429 degradation.
- Safe semantic tool loop with assertions excluded from context.
- Bounded operationally stable browser evidence and pure deterministic grader.
- Fixture tests plus multi-site real Solari acceptance.
- Clean V2 Drizzle `0000`, authoritative snapshot/report/trace projections, and race-free bounded SSE handoff/recovery.
- Generic configure/live/report UX.
- Cleanup reconciliation, redaction, policy/admission evidence.

### TG-014 non-blocking P1

- Replay UX when capability remains verified.
- Optional models only after new measured verification; they remain unverified at the V2 freeze.
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
- HTTP create idempotency/retry semantics and broader API retry/caching policy.
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
| Definitive Solari 429 with no session created | Lower future capacity; current run inconclusive; do not retry create |
| Ambiguous Solari create | Do not retry; potential leak blocks acceptance pending reconciliation |
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
- Exhaustive frozen protocol/transport × method-or-not_applicable × request-context × origin-relation × credential-state × destination-observability decisions covering DNS/UDP/STUN/TURN/data channels plus navigation/subframes/redirects/fetch/XHR/static resources/speculation/workers/EventSource/beacon/WebSocket/WebTransport/WebRTC/popups/downloads/browser-process traffic, with pre-connect actual IP:port enforcement or block-before-transmission and default deny.
- Auth, payment, messaging, upload/download, permission, submit, popup, iframe, and unknown-effect policy cases.
- Assertion-only provenance canaries for the assertion-free DTO/prompt/tool/model-history/agent-trace/target-traffic boundary; coincidental lexical overlap negative controls.
- URL/text/semantic/state truth tables and normalization.
- Fresh capture stability/retry, truncation, ambiguity, unsupported state, and evidence-hash validation.
- Exact outcome precedence, including false plus unverifiable → inconclusive.
- Atomic evaluation/run/queued-event creation and atomic intermediate transition/event append.
- Bounded queue/429 capacity degradation, no duplicate runs, and permit release.
- Finally cleanup after every acknowledged provider session ID.
- Generic aggregation and zero denominators.
- Redaction seeded with fake keys, CDP/replay URLs, sensitive values, and hostile page content.
- Clean generated V2 `0000`, recreated local DB, typed snapshot/report/trace, every event transaction’s publish-after-commit/no-publish-on-rollback, and race-free subscribe-first SSE recovery.
- Prompt injection and attempts to discover assertions or policy internals.
- Strict TanStack lifecycle, dynamic tool omission, FIFO/current-revision revalidation, independent budget/history/cancellation, and restricted `pressKey` cases.
- Demo fixture proves the same public V2 assertion path with no privileged grader.
- Demo-independence negative checks fail composition/import/export/schema/API/report builds if production references Demo admin, challenge, scenario, cart, fixture host, or privileged evidence.

### 15.3 Manual/credentialed acceptance

1. Verify public fork relationship, branch, visibility, and workspace placement.
2. Prove TG-002R destination enforcement with real Solari, including a denied private/reserved/rebinding case.
3. Run a safe fixture task through the full generic path without Demo admin evidence.
4. Run at least two materially different admitted public HTTPS sites through real Solari using safe read-only/reversible tasks and different assertion kinds.
5. Seed assertion-only canaries and verify assertion-origin provenance never flows into `AgentExecutionInputV2`, prompt/tool/model history, agent trace, or evaluated-target traffic; coincidental lexical overlap is not classified as leakage.
6. Attempt every prohibited action category; confirm block + INCONCLUSIVE + cleanup.
7. Force unstable/truncated/ambiguous evidence; confirm INCONCLUSIVE.
8. Run three repetitions; recalculate all counts/denominators from DB.
9. Refresh/reconnect during live execution; confirm authoritative snapshot recovery.
10. Compare acknowledged provider session IDs with release records; any mismatch blocks acceptance.
11. Run seeded redaction/admission audits for private-address detail, known credential/secret patterns, CDP/replay URLs, and full DOM material across DB/logs/SSE/export; document residual user-text risk rather than claiming absolute sensitive-string absence.
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
| Dynamic page never reaches two identical canonical captures within 3 attempts/5 s | Bounded quiet/capture protocol | INCONCLUSIVE |
| Poor accessibility/canvas/shadow/cross-frame target | Semantic evidence reason codes | INCONCLUSIVE |
| Prompt requests prohibited action | Admission UX plus authoritative runtime block | Reject or INCONCLUSIVE |
| Assertions expose sensitive values | Schema limits, sensitive-control block, redaction | Reject/unverifiable |
| Solari capacity below requested | Typed 429 degradation | Lower real concurrency |
| Recording unavailable | Capability gate | Runs continue; replay unsupported |
| `deepseek/deepseek-v4-flash-0731` incompatible with safe surface | One bounded post-V2 credentialed smoke | P0 blocked; do not substitute an unverified optional model |
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
- **Goal:** Build a disposable prototype proving real-Solari feasibility for public destination, redirects/rebinding, private-address/egress, request-method, and effect blocking.
- **Done when:** Provider-side enforcement or a forced outbound proxy observes and denies the actual IP:port before connection for every §5.2 context; non-HTTP paths have equivalent enforcement or block before transmission; a fresh service-worker-blocked context is used; private/reserved/rebinding/mutation probes deny; ambiguous egress denies; a provider inventory/safe correlation mechanism reconciles ambiguous creates without retry; cleanup reconciles; redacted measured evidence exists. URL/CDP request routing or post-response IP evidence alone cannot pass.
- **Stop rule:** If any browser/browser-process context can bypass pre-connect enforcement, or an unidentified ambiguous create cannot be reconciled by measured provider semantics, V2 acceptance stops. The disposable prototype is not production code and creates no TG-008 acceptance credit.
- **Owner:** B with A acceptance.

### TG-003 — TanStack/OpenRouter compatibility — retained historical PASS
- **Goal:** Preserve historical verification of exact P0 slug `deepseek/deepseek-v4-flash-0731`; TG-003 has no new V2 work.
- **V2 follow-up:** TG-009/TG-017C alone own exactly one bounded post-V2 safe-surface credentialed smoke. Do not rerun a model matrix; optional models remain unverified.

### TG-004R — V2 shared contracts
- **Goal:** Replace Demo target/grading production contracts with V2 target, assertion, assertion-free agent DTO, evidence, policy, report/trace, error, event, and port schemas.
- **Done when:** Closed fixtures and negative tests cover bounds; assertion-only provenance canaries; untrusted observations; outcome precedence; atomic ports; controller factory; typed 429; run-scoped environment/discovery/admission/policy evidence; separate trace/report DTOs; clean-V2 persistence handoff; and downstream lanes compile.
- **Owner:** A.

### TG-005 — Historical persistence/SSE feasibility — retained PASS
- **Goal:** Preserve measured libSQL/Drizzle/snapshot/SSE facts.
- **Limitation:** Does not prove V2 privacy/schema.

### TG-005R — V2 persistence/privacy refresh
- **Goal:** Establish the V2 persistence schema/migration and prove config/assertion/evidence/policy storage/projection under the stated residual-risk model.
- **Done when:** A clean generated V2 Drizzle `0000` recreates a fresh local DB; no V1 reader/converter/migration exists; run-scoped environment/discovery/admission/policy evidence, separate agent trace/grading report, snapshot, every event-family publish-after-commit/no-publish-on-rollback case, subscribe-first buffered/ready-handshake SSE recovery, bounds, and seeded redaction tests pass.
- **Ownership:** D authors and proves the TG-005R migration/repository surface; A accepts it at TG-006R. TG-010 consumes it unchanged.

### TG-006 — Historical V1 freeze — retained as superseded checkpoint
- **Goal:** Preserve ownership/evidence history.
- **Limitation:** V1 Demo contracts are not V2 production authority.

### TG-006R — Generic-site V2 pivot freeze
- **Goal:** Integrate TG-002R/TG-004R/TG-005R, regenerate the sole lockfile after manifests settle, freeze production interfaces/policies, and authorize Wave 1.
- **Done when:** Full frozen install/typecheck/test/build and redaction/ownership audit are green; lane acknowledgements, shared tree/lock hash, and gate evidence are exact; the exhaustive `protocol/transport × method-or-not_applicable × resource/request context × origin relation × credential state × actual-destination observability` table covers every §5.2 HTTP and non-HTTP context with pre-connect IP:port enforcement/default deny; prompt layers/DTO, causal window, stability bounds, report/trace/SSE bounds, provider create/reconciliation/release semantics, and Demo-independence negative checks are frozen.
- **Owner:** A.

### TG-007 — Generic evaluator and grader
- **Goal:** Implement bounded one-evaluation queue, atomic submission/transitions, run executor, pure assertion grader, outcome precedence, aggregation, and fake-port tests.
- **Done when:** Queue/state/assertion/aggregation tests pass and every acknowledged provider session releases in `finally`.
- **Owner:** A.

### TG-008 — Safe browser, admission, discovery, and fixture slice
- **Goal:** Implement and review the production admission, forced/provider network enforcement, closed effect policy, semantic observations, bounded operational capture, enforced discovery, and fixture-only Demo coverage; TG-002R code is disposable evidence only.
- **Done when:** The frozen request table passes for every context, unknown/unobservable effects deny before dispatch, passive/causal telemetry classifies correctly, real Solari handles an admitted site and prohibited probes, 2–3 capture stability works, and cleanup releases without capability leakage. Production modules and public exports have no Demo admin/challenge/cart dependency.
- **Owner:** B.

### TG-009 — Assertion-blind safe agent slice
- **Goal:** Implement exact-slug DeepSeek loop over `AgentExecutionInputV2`, fixed prompt layers, dynamically reduced upper-bound tools, FIFO/current-revision effect revalidation, independent budgets/history, cancellation, and strict TanStack lifecycle without assertions/native tools.
- **Done when:** Assertion-only canaries prove non-flow; all observations/results are explicitly untrusted; unavailable tools are omitted; `pressKey` restrictions and deny-unknown pre-dispatch policy pass; stale/FIFO/budget/history/cancellation cases pass; malformed/duplicate/out-of-order/unmatched/post-terminal TanStack events fail closed and are redacted; exactly one bounded credentialed V2 smoke for `deepseek/deepseek-v4-flash-0731` is green.
- **Stop rules:** Stop on any assertion-origin flow, raw controller/native-tool exposure, effect execution before a current-revision allow decision, budget coupling/bypass, cancellation dispatch race, lifecycle ambiguity, or concrete compile/smoke failure. Optional models stay unverified.
- **Owner:** C.

### TG-010 — V2 DB/API/minimal UI
- **Goal:** Consume the TG-005R clean V2 `0000` unchanged and implement repositories, loopback-only V2 API, typed snapshot/report/assertion-blind trace, race-free bounded SSE, target/prompt/assertion form, and minimal grading report.
- **Done when:** Fresh-DB create/live/report/trace flow persists run-scoped evidence, exact aggregates recalculate, subscribe-first handoff/reconnect/gap/slow-consumer behavior passes, every event transaction publishes only after commit, residual local-text risk is disclosed, and no Demo-admin/challenge/cart or raw grading URL dependency exists.
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
- **Done when:** Every adversarial case blocks safely; every create attempt is classified; ambiguous/unidentified creates reconcile; and every acknowledged session has explicit positive release confirmation.

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
- **Acceptance:** independently rerun the entire frozen request decision table against the reviewed TG-008 production boundary, including forced/provider pre-connect actual IP:port enforcement, fresh service-worker-blocked contexts, redirects/rebinding, all browser/browser-process contexts, closed pre-dispatch effect decisions, passive/causal telemetry, enforced discovery, 2–3 capture stability, explicit release confirmation, and fixture coverage.
- **Stop:** any bypass/unobservable context, URL/post-response-only enforcement, unknown allowed effect, agent-caused/unclassifiable prohibited traffic without INCONCLUSIVE, 404 treated as release success, or production Demo admin/challenge/cart import/export.

### TG-017C — AI/agent verification
- **Acceptance:** independently rerun assertion-only provenance canaries, fixed-layer/assertion-free DTO tests, prompt-injection cases, dynamic tool omission, pre-dispatch deny-unknown/current-revision checks, FIFO ordering, `pressKey` restrictions, independent budget/history limits, cancellation races, and strict malformed TanStack lifecycle cases; confirm the single exact-slug credentialed smoke evidence and that optional models are still unverified.
- **Stop:** any assertion-origin flow, raw controller/native tool, post-cancel dispatch, budget bypass, lifecycle ambiguity, unsafe action dispatch, raw malformed persistence, or failed exact-slug smoke.

### TG-017D — DB/SSE/UI verification
- **Acceptance:** recreate from clean V2 `0000`; verify there is no V1 reader/converter; audit local prompt/assertion pattern rejection plus residual-risk disclosure; verify transient raw URL separation; run-scoped environment/discovery/admission/policy evidence; exact aggregate derivations; bounded typed snapshot/report/assertion-blind trace; subscribe-first ready/buffer/drain/live SSE races; frame/heartbeat/queue/slow-consumer bounds; and publish coverage for every event transaction family.
- **Stop:** any remote/non-loopback API exposure, V1 compatibility machinery, Demo dependency, assertion/grading data in agent trace, raw grading URL durability, rollback publication, snapshot/SSE race, unbounded transport, incorrect denominator, or seeded known-secret leakage.

### TG-018 — Submission acceptance and polish
- **Goal:** Produce final README/video/evidence and run the submission checklist.
- **Done when:** Repository and measured results are public, links/assets are accurate, limitations are explicit, all sessions reconcile, and no P1 omission is presented as P0.
- **Important:** Do not submit a PR; submission is the user’s task.

### Critical path

```text
TG-000 → TG-001
  → (TG-002R, TG-004R)  # historical TG-003 evidence is retained, not rerun here
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
- [ ] TG-002R proves provider-side or forced-proxy actual IP:port enforcement before connection for every frozen request context in real Solari; URL routing/post-response IP evidence alone is rejected.
- [ ] Exact P0 slug `deepseek/deepseek-v4-flash-0731` passes exactly one bounded post-V2 credentialed safe-surface smoke; optional models remain unverified.
- [ ] Assertion-only canaries prove assertion-origin provenance/non-flow into the assertion-free DTO, model context/history/tools, agent trace, and evaluated-target traffic; coincidental lexical overlap is not leakage.
- [ ] PASS/FAIL/INCONCLUSIVE truth tables and fresh evidence tests are green.
- [ ] PASS is described only as declared browser-observable assertion success.
- [ ] At least two materially different real public HTTPS sites have safe Solari acceptance evidence.
- [ ] Demo Store is fixture-only; negative dependency/import/export/config/API/report checks prove no production grader/admin/challenge/cart/fixture-host dependency remains.
- [ ] All prohibited action categories block safely.
- [ ] Every provider create attempt is classified; ambiguous/unidentified creates reconcile; and every acknowledged session has explicit positive release confirmation (404 is not success).
- [ ] Seeded audits find no known secret/private-address/CDP/replay/full-DOM leakage; prompt/assertion residual local-storage risk is disclosed without an absolute no-sensitive-string claim.
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

1. **External actual-destination enforcement:** Does Solari provide server-side policy, or can all Solari browser/browser-process traffic be forced through a controlled proxy that exposes and denies the actual IP:port before connection, redirect, and re-resolution? TG-002R must answer with measured evidence; CDP URL routing or post-response observation cannot satisfy it.
2. **Network mutation enforcement:** Can the runtime reliably block agent-caused non-idempotent requests, beacons, WebSocket sends, downloads, and service-worker bypass? If not, generic V2 is blocked.

### Frozen product decisions

- Generic user-submitted public HTTPS targets and prompts: approved.
- Assertions: 1–20 required bounded URL/text/semantic/state assertions.
- Assertion isolation: provenance/non-flow through assertion-only canaries and an assertion-free agent DTO; not an impossible lexical-absence claim.
- Evidence: bounded operationally stable browser capture only.
- Unverifiable required evidence: INCONCLUSIVE.
- Safe anonymous tasks only within the closed detectable-effect policy; no claim of backend reversibility or GET truth.
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
