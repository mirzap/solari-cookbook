# Generic-site V2 pivot decision record

- **Recorded:** 2026-09-01
- **Owner:** Agent A, planning/integration owner
- **Authority:** explicit user product decision
- **Status:** approved planning pivot; implementation quarantined until TG-006R
- **Source plan:** `docs/plans/tracegate-poc-build-2026-09-01.md`

## Decisions

TraceGate V2:

1. Accepts generic user-submitted public HTTPS targets and bounded prompts.
2. Accepts 1–20 bounded required declarative URL, text, semantic, or state assertions.
3. Enforces assertion isolation as a provenance/non-flow guarantee with assertion-only canaries and a schema-parsed assertion-free agent DTO; it does not claim impossible global lexical absence. Assertions remain in the local authoring/grading control plane.
4. Builds model input from fixed server policy, a separate user task, a bounded public capability summary, and explicitly untrusted observations/results. Browser-captured accessibility semantics remain page-authored untrusted content and never certify safety.
5. Grades only from a fresh bounded operationally stable browser capture after the serialized action FIFO drains: fixed quiet interval, two identical canonical captures (three attempts maximum), same document/loader, no relevant activity, and fixed deadline.
6. Maps any required unverifiable evidence to INCONCLUSIVE.
7. Permits only anonymous public actions within a closed detectable-effect policy; this is not a claim of backend reversibility or harmless GET behavior.
8. Prohibits authentication/credentials, financial/purchase actions, messaging/publication, destructive actions, uploads/downloads, sensitive data, permissions, irreversible submits, and unknown or unobservable effects.
9. Uses Demo Store only as a deterministic positive/adversarial test fixture. Production configuration, composition, API, report, and grading cannot depend on Demo administration, challenges, cart state, or privileged evidence.
10. Defines PASS as satisfaction of declared browser-observable assertions only. PASS does not prove arbitrary backend business truth or durable external effect.
11. Keeps generic WebMCP invocation disabled; discovery may remain informational only through the enforced/pinned network path.

## B/C/D review corrections incorporated

The reviews are accepted as planning constraints:

- **Assertion boundary:** data-only `AgentExecutionInputV2` is an allowlisted, Zod-parsed DTO with no assertion/grader/port references; `SafeAgentToolPort` is injected separately into the runner. Assertion-only canaries test provenance/non-flow through DTO/port construction, prompt layers, tool/model history, agent trace, and target traffic; coincidental words already present in task/site content are negative controls, not leakage.
- **Untrusted page data:** text, roles, accessible names, ARIA, attributes, structured data, and tool results remain explicitly untrusted even when capture integrity and stability are trusted. They never authorize an action or certify effect safety.
- **Agent surface:** the named tools are only an upper bound. Runtime capabilities omit tools dynamically; every FIFO proposal is revalidated against the current observation revision and a closed pre-dispatch effect decision. Unknown/unobservable effects deny. `pressKey`, independent budgets/history, cancellation, and malformed TanStack lifecycle behavior have explicit fail-closed criteria.
- **Target safety feasibility:** TG-002R can pass only with provider-side enforcement or a forced outbound proxy that sees/denies actual IP:port before connection. URL/CDP routing, DNS preflight, hostname policy, or post-response observation cannot pass. A fresh context blocks service workers. TG-006R freezes the exhaustive protocol/transport × method-or-not_applicable × request-context × origin-relation × credential-state × destination-observability table, including DNS/UDP/STUN/TURN/data channels, speculation, workers, EventSource, beacon, WebSocket, WebTransport, WebRTC, popups/downloads, and browser-process traffic. Non-HTTP paths must have equivalent enforcement or be blocked before transmission. TG-002R is disposable; TG-008 is reviewed production code.
- **Effect causality:** pre-action passive blocked-page telemetry may be a warning only when complete deterministic evidence remains possible. The fixed causal action window spans dispatch through post-action quiet/timeout and includes redirects, workers, network, dialogs, popups, and downloads. Agent-caused or causally unclassifiable prohibited activity is INCONCLUSIVE.
- **Evidence stability:** acceptance is two consecutive byte-identical canonical captures (maximum three) after a 750 ms quiet interval, within five seconds, with the same document/loader. Activity monitoring remains armed from quiet start through acceptance; intervening relevant activity resets quiet and the capture sequence. This is bounded operational stability, not perfect revision proof.
- **Discovery:** network discovery uses the proven enforced browser path or a separately vetted control-plane fetcher pinned to public IP:port enforcement. Ordinary ambient fetch is forbidden.
- **Solari lifecycle:** create is one attempt absent provider idempotency. TG-002R must measure/freeze a provider inventory or safe correlation mechanism exposed through `ProviderSessionReconciliationPort`; ambiguous create is not retried and remains a potential leak/acceptance blocker until reconciled. If unidentified creates cannot be reconciled, that provider capability is an acceptance stop. Release needs measured positive confirmation; 404 is not success, and failed/ambiguous release remains retryable. Replay is optional and never grades.
- **Local-only control plane:** P0 API/report/trace/SSE/replay surfaces bind loopback only. Known secret/sensitive patterns are rejected before local prompt/assertion persistence; any value that storage redaction would mutate is rejected. Accepted canonical prompt/assertion specifications persist unchanged locally, while derived projections are redacted and residual risk is disclosed. No absolute no-sensitive-string claim is made. Raw canonical grading URLs are transient and separate from redacted persisted/display URLs.
- **Clean V2 persistence:** TG-005 spike DBs are disposable. TG-005R creates a generated V2 Drizzle `0000` on a recreated local DB with no V1 reader/converter/migration machinery; TG-010 consumes that migration unchanged. HTTP create idempotency is deferred.
- **Projection/streaming:** typed bounded snapshot/report/assertion-blind trace projections are separate (100 default/200 max items, 16 KiB/item, 512 KiB/response). SSE subscribes and buffers before snapshot, performs a ready/cursor handshake, drains/deduplicates, then streams live with ≤16 KiB payload, ≤20 KiB frame, 15-second heartbeat, ≤128 events/512 KiB per-subscriber queue, five-second handoff, eight-connection, and slow-consumer disconnect bounds. Every event transaction family proves publish-after-commit and no publish on rollback.
- **Run evidence and metrics:** environment, discovery, admission, policy, grading, and cleanup evidence are run-scoped. Every terminal non-cancelled run has exactly one passed/failed/inconclusive outcome; ungraded lifecycle failures map inconclusive. Aggregate numerators/denominators derive exactly from persisted runs/terminal outcomes, with nonterminal and potential-leak counts explicit.
- **Verification:** TG-009 and TG-017C stop on assertion flow, unsafe dispatch, budget/cancellation bypass, or lifecycle ambiguity. TG-017D stops on V1 machinery, remote API exposure, trace/report mixing, raw grading URL persistence, stream races/unbounded transport, wrong aggregates, or seeded leakage. Demo-independence negative checks cover imports, exports, schemas, configuration, API, and report composition.

## Historical evidence preserved

The pivot does not change these measured results:

- TG-000 established the compliant public fork/workspace.
- TG-001 verified Node `26.1.0`, global pnpm `12.0.0`, exact dependency pins, and practical workspace smoke.
- TG-002 proved real Solari fixture connectivity, Cloudflare Quick Tunnel use, at least five observed concurrent sessions, and recording/replay capability.
- TG-003 historically verified exact P0 slug `deepseek/deepseek-v4-flash-0731` through pinned TanStack/OpenRouter and has no V2 rerun. TG-009/TG-017C own exactly one bounded post-pivot credentialed safe-surface smoke; optional models remain unverified.
- TG-005 proved local libSQL/Drizzle snapshot, ordered milestone persistence, publish-after-commit process-local SSE, and refetch recovery feasibility.
- TG-006 truthfully recorded the V1 contract/architecture freeze and ownership.

These facts remain append-only in meaning. TG-002 did not test generic-target SSRF, runtime DNS rebinding, redirect, resolved-destination, or mutation enforcement. TG-005 did not test V2 evidence privacy. TG-006 is historical and is superseded for V2 production semantics only after TG-006R passes.

## Superseded production contracts

The following V1 concepts are removed from the V2 production path:

- `kind: "tracegate-demo-store"` production target;
- `ScenarioIdSchema` / `classic-tee-size-m-v1` as universal success definition;
- `adminBaseUrl`, `DemoAdminPort`, challenge provisioning, and sensitive challenge navigation;
- `DemoMutationRevision` as production grade evidence revision;
- privileged cart evidence and fixed Classic Tee/M/quantity predicates;
- generic native/WebMCP tool invocation;
- model-facing success criteria or assertions;
- the claim that a controlled Demo mutation proves generic-site completion.

Reusable parts of commit `9b141cbcedf690354bb7b2cf6b07c86cc1454243` are retained, especially explicit idempotent `BrowserController.close`. Demo-specific schemas/fakes may remain only behind fixture/legacy boundaries until removed from production exports during TG-004R.

## Work disposition

### Keep/generalize

- provider lease/controller/release/replay lifecycle;
- typed provider capacity degradation;
- atomic evaluation submission and transition concepts;
- states, event ordering, snapshots/SSE, redaction, cleanup, aggregation;
- semantic observations, opaque refs, stale-ref rejection and bounded discovery;
- TanStack/OpenRouter drivers, budgets, history, cancellation and safe event mapping;
- Drizzle/libSQL repositories and UI/API scaffolding, generalized to V2;
- Demo semantic pages only as deterministic fixtures and adversarial policy targets.

### Remove from production composition

- Demo admin client/challenge store/privileged grader wiring;
- cart mutation as a production acceptance dependency;
- fixed Demo copy and scenario columns in V2 projections;
- raw browser controller access from the agent lane;
- native tool invocation and any assertion leakage to the model.

## Dirty-WIP quarantine at pivot

The working tree was already dirty when this decision was recorded. No source or lockfile work is integrated by this planning checkpoint.

### Interrupted Agent A shared-contract work

Uncommitted changes exist in:

- `packages/shared/src/errors.ts`
- `packages/shared/src/events.ts`
- `packages/shared/src/ports.ts`
- `packages/shared/src/transitions.ts`
- `packages/shared/src/testing/repositories.ts`

The typed concurrency error, specialized queued/status events, atomic repository ports, controller factory, and transition-context schema remain useful concepts. The repository fake work is incomplete. None is checkpoint-ready; all must be rebased against V2 in TG-004R with fixtures/tests/impact review.

### Concurrent B work

Dirty/untracked work exists under `packages/solari`, `packages/discovery`, and `apps/demo`. Preserve provider/controller/semantic infrastructure; generalize safety/origin behavior. Demo admin/challenge/cart behavior becomes fixture/legacy only.

### Concurrent C work

Dirty/untracked work exists under `packages/ai` and `packages/agent`. Preserve adapter, budget, history, cancellation, and serialization work; revise prompts/tools so assertions are absent and the agent receives only the safe action port.

### Concurrent D work

Dirty/untracked work exists under `packages/db`, `packages/ui`, and `apps/web`. Preserve persistence/SSE/API/UI infrastructure; generalize schemas/routes/views and remove production Demo-admin dependencies.

### Lockfile

`pnpm-lock.yaml` is dirty because concurrent manifests are present. It remains unstaged. Only Agent A regenerates and commits the authoritative lockfile after V2 manifests settle at TG-006R.

No agent may blanket-reset, stage, format, or revert another lane’s quarantined paths. Explicitly assigned TG-002R/TG-004R/TG-005R work may selectively stage only its owned reviewed rebaseline paths; unrelated WIP and the lockfile remain quarantined until TG-006R.

## Revised gates

Historical gates remain recorded. V2 proceeds through:

```text
TG-002R target-safety feasibility
TG-004R V2 contracts
TG-005R V2 persistence/privacy
TG-006R pivot freeze
TG-007 generic evaluator/grader
TG-008 safe browser/admission/evidence
TG-009 assertion-blind safe agent
TG-010 V2 DB/API/UI
TG-011 single-run integration
TG-012 repeated orchestration
TG-013 policy/security/cleanup evidence
TG-014 non-blocking P1
TG-015 complete UX
TG-016 P0 checkpoint
TG-017A–D verification
TG-018 final acceptance
```

## Blocking feasibility questions

Wave 1 production implementation must not resume until TG-006R, and TG-006R cannot pass until TG-002R proves:

1. provider-side policy or a forced proxy can observe and deny the actual IP:port **before connection** for every HTTP and non-HTTP browser/browser-process context, redirect, DNS change, and re-resolution, or block the path before transmission;
2. the closed protocol/method/resource/origin/credential/observability table plus pre-dispatch effect policy can block mutation, bodies, EventSource/beacon/WebSocket/WebTransport/WebRTC, downloads/popups/workers/speculation/service-worker bypass, unknown effects, and causally unclassifiable post-action traffic; and
3. a measured provider inventory or safe correlation mechanism can reconcile an ambiguous unidentified create without retrying it.

Assigned TG-002R/TG-004R/TG-005R spike/contract/persistence rebaseline work is permitted before TG-006R under path-specific ownership and staging.

DNS preflight alone is not DNS-rebinding protection. Neither URL/CDP request routing nor post-response IP observation can pass. If Solari lacks provider-side enforcement and cannot force all traffic through a controlled pre-connect actual-IP:port proxy (with non-HTTP paths equivalently enforced or blocked before transmission), generic-site V2 P0 is externally blocked rather than weakened. An ambiguous unidentified create also blocks acceptance unless the measured provider reconciliation mechanism resolves it.

## Planning checkpoint scope

This record and the rewritten plan are planning artifacts only. They do not claim TG-002R, TG-004R, TG-005R, or TG-006R has passed, do not integrate current source WIP, and do not regenerate the lockfile.
