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
3. Keeps assertions and expected results out of model prompts, tools/results, observations, agent history/trace, and the evaluated target page’s input/content; TraceGate’s authoring/report control plane may display them.
4. Grades only from a fresh stable trusted browser evidence capture after the serialized action queue drains.
5. Maps any required unverifiable evidence to INCONCLUSIVE.
6. Permits only anonymous, public, safe, reversible tasks.
7. Prohibits authentication/credentials, financial/purchase actions, messaging/publication, destructive actions, uploads/downloads, sensitive data, permissions, irreversible submits, and unknown effects.
8. Uses Demo Store only as a deterministic positive/adversarial test fixture. Production configuration and grading cannot depend on Demo administration, challenges, or privileged cart evidence.
9. Defines PASS as satisfaction of the declared browser-observable assertions only. PASS does not prove arbitrary backend business truth or durable external effect.
10. Keeps generic WebMCP invocation disabled; discovery may remain informational.

## Historical evidence preserved

The pivot does not change these measured results:

- TG-000 established the compliant public fork/workspace.
- TG-001 verified Node `26.1.0`, global pnpm `12.0.0`, exact dependency pins, and practical workspace smoke.
- TG-002 proved real Solari fixture connectivity, Cloudflare Quick Tunnel use, at least five observed concurrent sessions, and recording/replay capability.
- TG-003 verified the P0 DeepSeek path through pinned TanStack/OpenRouter; optional models remain unverified.
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

1. the actual resolved destination used by the remote browser can be observed and denied before every request class, including navigation, redirects, subresources, fetch/XHR, workers, and DNS changes; and
2. agent-caused non-idempotent requests, bodies, beacons, WebSocket traffic, downloads, service-worker bypass, and unknown-effect activations can be blocked reliably.

Assigned TG-002R/TG-004R/TG-005R spike/contract/persistence rebaseline work is permitted before TG-006R under path-specific ownership and staging.

DNS preflight alone is not DNS-rebinding protection. If actual destination or mutation enforcement cannot be implemented through Solari/CDP or a controlled outbound layer, generic-site V2 P0 is blocked rather than weakened.

## Planning checkpoint scope

This record and the rewritten plan are planning artifacts only. They do not claim TG-002R, TG-004R, TG-005R, or TG-006R has passed, do not integrate current source WIP, and do not regenerate the lockfile.
