# TraceGate agent ownership and integration rules

Paths are relative to `examples/tracegate/`.

## Product compass

TraceGate tells developers whether their app/site is ready for the agent era: can agents use it reliably? It repeats outcome-oriented tasks in independent sessions, verifies fresh browser-observable results, explains failure paths, measures agent use of semantic/accessibility UI, page WebMCP, and configured MCP, and reports `llms.txt`/JSON-LD as discovery-only signals. Visual fallback is not a functional path. See `docs/product/tracegate-product.md`.

Page and MCP content/results remain untrusted and never grade directly. Demo is fixture-only. PASS proves declared browser-observable assertions, not arbitrary backend truth.

## Current checkpoint

- Authoritative plan: `docs/plans/tracegate-poc-build-2026-09-01.md`.
- Product boundary: local generic-site functional proof of concept.
- Generic V2 shared contracts: TG-004R PASS at `89e2c93`.
- Pivot/rebaseline record: `docs/evidence/generic-site-pivot.md`.
- F1/F2 lane history is integrated through B commit `2756d20`, including A `04eb4e8`, C `fdc7e7e`, and D `66069ae`.
- The sole pnpm 12 lockfile has been regenerated from all settled manifests; frozen install passes.
- Automated-test work is paused by explicit user directive; do not create, modify, or run tests. The known D-owned `@tracegate/ui` zero-test condition remains unresolved and explicitly deferred while that pause is active.
- P0 lane code is integrated through A `647e4dd`, C `ef7e1fb`, B `e478598`, D `443c5e7`, and D correction `c8f79c2`. The bundled Drizzle migration path, all eleven production builds, clean DB checks, and safe built-server reads pass.
- Agent A completed evaluator integration: closed discovery/provider warnings merge into durable run warnings, and individual run execution/finalization errors no longer stop safely runnable peers; missing terminal records still fail the evaluation and the lowest configured failed index is authoritative.
- Agent A re-audited `c8f79c2`: grading identity is run-scoped and checked against that run's committed evidence; dispatched first-terminal semantic activity supplies consistent positive readiness evidence across runtime/DB/UI projections; shutdown waits for every reservation-to-transaction settlement before queue/provider/database teardown.
- The pre-provider static/production checkpoint is **GO for one bounded real-provider validation workstream**. This is not provider evidence: Solari/OpenRouter outcome, confirmed release, concurrent identical-evidence behavior, queue-full admission, and in-flight shutdown remain runtime-unverified until their permitted manual phases.
- Demo Store is test-only and never a production target, composition, or grading dependency.
- PASS means declared browser-observable assertions passed from fresh evidence; it never claims arbitrary backend business truth.

## Integration Checkpoint I0 workstream gate (2026-09-02)

This is an Agent A workstream checkpoint only. It does not advance the authoritative plan, F3, or any product capability claim. External/provider validation remains blocked until the downstream handoffs below land and the later whole-workspace production gate is observed.

### Prompt admission contract and D handoff

`classifyPromptAdmission(...)` is the sole deterministic, model-independent prompt-admission classifier. `PublicEvaluationConfigV2Schema` invokes it, so prohibited requested effects fail validation before persistence even if a caller omits the explicit server check. Decisions contain only a closed code and static product-safe message; prompt text is never copied into the decision.

Closed rejection codes are:

- `messaging_or_submission_requested` for send/message/submit/publish effects;
- `authentication_or_account_creation_requested` for signup/login/authentication effects;
- `financial_transaction_requested` for purchase/payment/checkout/booking/trading/donation effects;
- `destructive_action_requested` for deletion, cancellation, unsubscribe, or account/data-changing effects;
- `file_transfer_or_permission_requested` for upload/download/install/import/export or device-permission effects;
- `sensitive_data_requested` for credential or sensitive-personal-data entry/collection;
- `prompt_out_of_bounds` for input outside the 1–1,000 character contract.

Safe surface inspection is distinct from requesting an effect. Phrases such as `open the contact page without sending anything`, `open the registration page`, and other explicit page/screen/form inspection remain admissible. Immediate negation is bounded and lexical; it never delegates policy classification to a model.

**D must:** call `classifyPromptAdmission(raw.prompt)` before queue reservation or repository access so it can map a rejection to `unsafe_prompt_rejected` with the returned static message; retain schema parsing as defense in depth; create no evaluation/run/event row and publish no SSE event for a rejection. D must not add target-specific exceptions or infer safety from assertions.

### Completion disposition and grading handoff

`AgentCompletionDisposition` is closed to `completed | policy_refused | blocked | needs_input`. `resolveRunCompletionDisposition(...)` maps only `completed` to `gradable`; every other value maps to `blocked` with required outcome `inconclusive`. Legacy `AgentRunResult` values are read conservatively: `completedBelief: true` becomes `completed`, while `false` becomes `blocked`. `completedBelief` and `completionDisposition` must agree.

The deterministic grader is authoritative. A non-completed disposition produces overall `INCONCLUSIVE` with one of `agent_policy_refused`, `agent_blocked`, or `agent_needs_input`, even when unrelated fresh assertion evidence was already true. Genuine captured assertion projections may remain visible as evidence, but neither a producer nor a projection may rewrite the run to PASS or FAIL. Browser policy evidence retains precedence as `unsafe_action_blocked` when a fatal browser policy event is present.

**C must:** extend its finish proposal/runner state with an explicit closed disposition; emit `completed` only with `completed: true`; require `policy_refused`, `blocked`, or `needs_input` with `completed: false`; never infer disposition from free-form summaries. Every `AgentRunResult` must carry the explicit disposition after C adopts the contract.

**D must:** treat persisted `GradeResultV2.outcome` and its closed failure as authoritative. It must render the three agent non-completion failures as inconclusive/blocked evidence, never as task success, and must not use `completedBelief`, assertion truth, summary text, or a terminal UI pipeline alone to infer PASS/FAIL.

### Provider-warning handoff to C

`AgentRunResult.warnings` defaults to `[]` and is capped at 10. C may emit only closed `RunWarning` values with static bounded messages: missing provider identity → `unknown_provider_event`; missing or inconsistent usage → `usage_unavailable`. Provider payloads, IDs, headers, causes, and arbitrary error text are forbidden. These warnings never change browser evidence or deterministic grade. A's run executor deduplicates them by `(code, phase, message)`, merges them into the existing run-warning collection, and retains the run-level cap of 50.

### Synchronous queue reservation handoff to D

`OneEvaluationQueue.reserve(evaluationId, execute)` is synchronous. It occupies one active-or-pending slot immediately and throws typed `EvaluationQueueFullError` (`code: evaluation_queue_full`) or `DuplicateEvaluationJobError` (`code: duplicate_evaluation_job`) before any await. Duplicate detection includes active, committed pending, and uncommitted reserved IDs. Queue state exposes reservations separately as `reservedEvaluationIds`; they are not durable evaluations.

A reservation is single-use. `commit()` synchronously moves a still-reserved job into runnable FIFO state and returns its result promise; a second/late commit throws `EvaluationQueueReservationStateError`. `release()` frees only an uncommitted reservation and is idempotent/no-op after commit. `cancel()` aborts an active job, rejects a committed pending job with `AbortError`, or marks an uncommitted reservation `cancelled` without running it. `idle()` includes uncommitted reservations. `enqueue()` remains the compatibility wrapper and preserves promise rejection for admission failures.

**D must use this exact order:** validate prompt/config/capabilities → construct evaluation and runs in memory → synchronously reserve → attempt the atomic submission transaction → release on transaction failure → publish only committed queued events → commit the held reservation → attach asynchronous job failure handling. Queue-full/duplicate admission maps to bounded HTTP 409 with no rows/events. Shutdown releases uncommitted reservations; it must not turn a never-started shutdown reservation into a failed durable evaluation. Safely persisted queued evaluations remain recoverable.

### Network classifier handoffs to B and C

`classifyNetworkHostname(...)` and `classifyResolvedIp(...)` are the only shared structural classifiers. They are pure, perform no DNS, import no Node APIs, normalize case/bracketed IPv6, classify IPv4-mapped IPv6 by its embedded address, and close over loopback, private, link-local, unspecified, multicast, documentation/reserved, carrier-grade NAT, and public ranges.

**B must:** replace local hostname/IP range logic in public target admission. Public HTTPS admission requires `public_dns_name`, at least one resolved A/AAAA answer, and every answer classified `public`. Preserve exact-origin navigation semantics, best-effort DNS evidence, redaction, and all existing recovery/cleanup contracts.

**C must:** use the same helpers before every configured-MCP network request. Explicit loopback permits only `localhost`, `127.0.0.1`, or `::1` and requires all hostname answers to be loopback. Public HTTPS requires `public_dns_name`, a nonempty answer set, and every answer `public`. Reject mixed/public-private results before `fetch`; retain `redirect: "error"`, no authentication headers, bounded safe errors, and the documented no-DNS-pinning limitation.

### Reconfirmed post-I0 orchestration and event invariants

I0 does not claim the independent-run orchestration change complete. At its later A integration step, an individual run execution/finalization error is recorded by configured run index and must not stop safely runnable peers; only cancellation or an evaluation-systemic capacity/control-plane failure stops new dispatch. Active work drains, missing durable terminal records fail the evaluation without fabricated run outcomes, and the selected evaluation failure is the lowest configured failed index rather than promise-settlement order.

The shared event contract is unchanged: sort by numeric cursor; first `run.tool.completed` per `(runId, toolCallId)` wins; `run.tool.started` is trace-only; `resolveToolDispatchDisposition(...)`, `toolCompletionInterfaceUsageDelta(...)`, and `toolCompletionBrowserActionDelta(...)` are authoritative; a legacy success proves dispatch while a legacy failure is `legacy_unclassified`; never infer dispatch, invocation, browser action, or outcome from starts, names, summaries, durations, or arbitrary text. C produces these terminal facts and D consumes them exactly as specified in the existing handoff below.

I0 production-only validation is limited to TypeScript production configs/builds and static review. No automated test may be created, changed, compiled as claimed evidence, or run. The package `typecheck` script currently includes paused test sources; any unrelated test-source compile failure is recorded as a blocker rather than fixed in this workstream.

## Short critical path

```text
TG-004R PASS
  → P0 A/B/C/D code integrated
  → production build + clean DB + safe built-server reads PASS
  → D run-scoped grading/readiness/shutdown correction PASS at c8f79c2
  → production + clean DB + safe manual re-gate PASS
  → one real Solari/DeepSeek run
  → repeated runs/report
  → functional verification
```

Deferred provider-grade egress enforcement, perfect DNS-rebinding prevention, forced proxying, and provider inventory reconciliation are documented limitations, not functional-app blockers.

## Exclusive lanes and immediate assignments

| Agent | Exclusive paths | Immediate assignment |
|---|---|---|
| **A — integration/evaluation** | root TraceGate configs and this file, `packages/shared`, `packages/evaluation`, `packages/grading`, dormant `tests/e2e`, `pnpm-lock.yaml`, integration evidence | Root runnable wiring; shared interface modes, configured-MCP contracts, readiness metrics; integration review and final lockfile |
| **B — browser/target/discovery** | `packages/solari`, `packages/discovery`, `apps/demo`, browser/Solari evidence | Page WebMCP discovery/invocation plus semantic/accessibility, `llms.txt`, JSON-LD, visual fallback, browser safety, and fixture-only Demo |
| **C — AI/agent** | `packages/ai`, `packages/agent`, model/agent evidence | DeepSeek/OpenRouter agent plus configured unauthenticated MCP client/adapter, read-only admission, lifecycle cleanup, and interface metric emission |
| **D — persistence/product UI** | `packages/db`, `packages/ui`, `apps/web`, persistence/UI evidence | Compose real A/B/C surfaces; configuration/readiness/live/results UI; persistence/API/SSE; production migration packaging |

Do not edit, rename, format, stage, restore, or reset another lane’s exclusive paths. Agent A may integrate a completed lane handoff unchanged at an explicit integration checkpoint.

## Shared-contract rules

- `@tracegate/shared` is the authoritative cross-lane contract.
- Public consumers import only `@tracegate/shared` or `@tracegate/shared/testing`.
- Concrete DB, Solari, agent, UI, or Demo classes never appear in another lane’s public signature.
- Only Agent A edits `packages/shared`.
- A shared change requires a concrete compile/runtime blocker, named affected schemas/ports/events/lanes, compatibility impact, updated fixtures/tests, and downstream compile verification.
- Assertion-origin values remain outside the agent DTO, prompt, tools/results, model history/events, agent trace, and target traffic.
- Browser page text/accessibility semantics and WebMCP descriptors/annotations/results remain untrusted and never authorize an unsafe effect.
- Page WebMCP is B-owned. Configured MCP is C-owned and initially limited to explicit unauthenticated loopback HTTP or HTTPS Streamable HTTP endpoints with endpoint/tool allowlists.
- `mcp-preferred` changes interface strategy only; endpoint URLs and assertion values stay outside `AgentExecutionInputV2`. Server read-only annotations are hints, not authorization; descriptors require a separate local admission decision. All MCP descriptors/results are untrusted, bounded, redacted, and never grade directly.

## Tool dispatch event handoff

The F2C integration checkpoint is blocked until C and D adopt the A-owned terminal tool-event semantics below. `run.tool.started` is proposal-lifecycle trace data only; it is never proof that the runtime/browser tool port was entered and must not drive interface invocation or terminal outcome counts.

`run.tool.completed` now has a dispatch-aware producer payload with the strict bounded disposition `dispatched | rejected_before_dispatch`. `dispatched` means C entered `SafeAgentToolPort.execute(...)`; set it immediately before calling the port so synchronous throws and rejected promises still count as dispatched. `rejected_before_dispatch` means the proposal terminated before that boundary and requires `success: false`. The compatibility event schema still accepts legacy payloads with no disposition: a legacy success proves dispatch, while a legacy failure is `legacy_unclassified` and must not be guessed from duration, summaries, starts, tool names, or sources. No persistence migration is required. Old readers are not forward-compatible with the new strict field, so rollout order is shared contract, then D reader/projection, then C producer.

**C-lane emission handoff (`packages/agent`):**

1. Construct every newly emitted terminal completion with `FailureAwareRunToolCompletedEventSchema` (or its required payload schema). A success has no `failure`; every newly emitted unsuccessful completion has exactly one `RunToolCompletionFailureV1`. The compatibility reader still accepts older dispatch-aware failures without that field and legacy events without a disposition.
2. Emit `rejected_before_dispatch` for rejected admission, malformed or unavailable actions, policy/stale/equivalent rejection, and abort/timeout before port entry. Emit `dispatched` for allow/deny results, port throws, post-dispatch validation failures, and abort/timeout after port entry. Never alter the disposition to fit the failure classification.
3. Track the boundary directly rather than inferring it from the eventual error. Recovery `inspect` calls do not change the original proposal's disposition, failure, or completion and do not create another model-requested invocation.
4. Map the original proposal lifecycle to the closed failure phases: initial admission/driver rejection → `proposal_admission`; action/surface/policy/equivalent rejection before port entry → `pre_dispatch_validation`; entered-port failure or returned deny → `runtime_dispatch`; B-origin browser-policy enforcement → `browser_policy`; invalid returned exchange/fresh observation → `post_dispatch_validation`; use `unknown` only when the lifecycle boundary is genuinely unavailable.
5. When available, copy only `code` and `category` from a successfully parsed `TraceGateError.safe`; never copy its free-form `phase`. For a non-TraceGate or unrecognized safe error, use `unexpected_run_error` / `unknown` with the known closed lifecycle phase. The required synthetic cases are:

| C condition | code | category | phase |
|---|---|---|---|
| malformed or unavailable admission | `provider_protocol_error` | `model_provider` | `proposal_admission` |
| malformed action after admission | `provider_protocol_error` | `model_provider` | `pre_dispatch_validation` |
| equivalent semantic failure rejected before entry | `stale_element_exhausted` | `tool_error` | `pre_dispatch_validation` |
| returned policy denial | `unsafe_action_blocked` | `policy` | `runtime_dispatch` |
| unknown port failure | `unexpected_run_error` | `unknown` | `runtime_dispatch` |
| unknown returned-result validation failure | `unexpected_run_error` | `unknown` | `post_dispatch_validation` |

6. Obtain the optional B policy context only by passing a parsed `FailureRecord` to `browserPolicyDiagnosticFromFailureRecord(...)`; omit it when the helper returns `null`. Never parse or persist URL, DOM/selector, request/body data, provider/error/result text, cause chains, secrets, assertions, or arbitrary field-issue content. Preserve the existing strict tool/source vocabularies and bounded redacted human summary separately.

**D-lane projection handoff (`packages/db`, then `apps/web` projection consumers):**

1. Land the compatible shared reader before C emits failure-aware events. Persist the optional closed `failure` object as event payload JSON; no migration is required. Never derive structured diagnostics from `resultSummary`, error messages, starts, or other text.
2. Derive interface `invoked`, `succeeded`, and `failed` only from deduplicated `run.tool.completed` events, using `toolCompletionInterfaceUsageDelta(...)`; first terminal event per `toolCallId` by cursor wins. Ignore starts for all three counters.
3. Apply one completion atomically: dispatched success increments `invoked + succeeded`; dispatched failure increments `invoked + failed`; rejected/unclassified/orchestration completions increment none. This preserves `succeeded + failed === invoked` at every persisted cursor, including started-only and crash-truncated histories.
4. Recover event-derived `browserActions` from the same first terminal completions with `toolCompletionBrowserActionDelta(...)`: `1` increments, `0` does not, and `null` makes the event history unclassifiable. A dispatched non-`finish` completion counts regardless of success; rejected-before-dispatch and dispatched `finish` do not. Legacy success remains proof of dispatch; legacy failure remains unclassified and must never be guessed. Starts and internal recovery calls do not supply missing model-requested completions.
5. When at least one first terminal completion exists and every browser-action delta is non-null, use their summed event total atomically. When there are no terminal completions or any delta is `null`, use the explicit persisted `browserActions` value atomically; never add a partial event total to persisted state. Likewise treat an explicit persisted `(invoked, succeeded, failed)` tuple atomically as a legacy fallback only when that channel has no tool trace activity. Discovery/admission projection and shared interface-usage invariants remain unchanged.
6. Rollout order is shared contract → D reader/projection → C producer. After C emits a failure-aware row, rollback must retain the compatible reader even if C emission is disabled. The checkpoint remains blocked until both handoffs compile and production projection is manually inspected; automated tests remain paused.

## Recovery step 6 assertion-capture seam

Agent A owns the shared contract and deterministic projection; Agent B must implement the browser side next without changing the agent envelope:

1. `SolariCdpBrowserController` must implement shared `AssertionSnapshotBrowserController.captureAssertionSnapshot(...)` as a dedicated in-page capture, not by calling model-facing `observe()`.
2. Capture `finalUrl` as captured/unavailable; capture `title` once (16,384 characters) and `documentVisibleText` once (262,144 characters) only when requested; and populate `semanticStateValues` by directly matching each configured role/name in-page. Semantic counts retain at most 21 (the DSL ceiling plus one); state matches retain at most two and identify the requested property; non-sensitive string state retains at most 500 characters. Emit the shared field/per-assertion truncation/status flags and never use legacy `observation_truncated` for this path. Do not put assertion inputs or the transient snapshot into prompts, tool results, histories, traces, events, or target traffic.
3. `FreshBrowserAssertionEvidenceCapture` must use `evaluateCapturedAssertion` for every assertion, including every URL/query operator, fingerprint only the assertion-relevant transient projection across the required identical captures, and persist only the existing redacted `BrowserAssertionEvidenceV1` summaries/hashes.
4. Remove the Solari-local `evaluateAssertionFromObservation` and old `CurrentAssertionSnapshot.observation` path. Preserve quiet-interval stability, policy activity, redacted display URLs, identity hashes, and PASS/FAIL/INCONCLUSIVE precedence.

Until that B-owned seam lands, the legacy Solari capture still consumes the model observation and does not realize the new honesty guarantees.

## WIP quarantine and staging

- Review and retain reusable work in place; remove V1/Demo production assumptions during the owning lane’s rebase.
- Do not infer success from untracked or compiling files without running the lane checks.
- Stage with explicit owned paths only.
- Do not blanket reset, clean, format, or stage the repository.
- Do not stage `pnpm-lock.yaml` while concurrent manifests are changing.
- Each lane commits only its exclusive paths and reports commands, results, changed files, and blockers.

## Runtime and commands

Use the globally installed pnpm directly; Corepack is not required.

```bash
cd examples/tracegate
node --version                 # v26.1.0
pnpm --version                 # 12.0.0
pnpm install --frozen-lockfile
pnpm env:check
pnpm typecheck
pnpm build
pnpm db:migrate
pnpm dev        # manual loopback inspection
pnpm start      # manual built-product inspection
```

Use `pnpm --filter <workspace-name> <script>` for lane-local checks. A green package-local command does not replace functional integration verification.

## Lockfile discipline

Only Agent A updates `pnpm-lock.yaml`. After intended manifests settle:

1. use Node `26.1.0` and global pnpm `12.0.0`;
2. regenerate the sole authoritative lockfile;
3. run frozen install plus workspace typecheck/build and manual runtime inspection;
4. commit the lockfile with the integration checkpoint.

## Practical safety and cleanup boundary

P0 uses structural HTTPS validation, exact origins, best-effort public DNS preflight, fresh anonymous sessions, service-worker blocking where supported, observable unsafe-request interception, and obvious unsafe-control blocking. Coverage gaps are limitations, not hidden claims.

A Solari create is attempted once. An ambiguous unacknowledged create becomes INCONCLUSIVE/potential-leak evidence and is not retried. Every acknowledged session ID must still receive controller close and provider release attempts in `finally`, with durable cleanup state.

## Non-fabrication

Never:

- present fixture/local output as a real Solari run;
- claim optional models are verified;
- claim whole-browser network confinement or perfect DNS-rebinding prevention;
- hard-code or splice PASS/FAIL results;
- rewrite measured evidence to improve a result;
- persist credentials, CDP/replay capability URLs, full DOM, or raw provider payloads.

The immediate next action is F3's single bounded real-provider validation through the production-built app. Start with one simple public HTTPS semantic-only evaluation and require a durable deterministic result, authoritative snapshot/report/trace, and confirmed browser release. Stop on TraceGate-infrastructure INCONCLUSIVE, nonterminal state, attribution mismatch, cleanup uncertainty, secret/capability leakage, or projection divergence. Repeated runs, queue saturation, configured/page MCP, and broader functional verification remain later workstreams.
