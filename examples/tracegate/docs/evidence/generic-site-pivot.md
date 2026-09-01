# Generic-site functional-app rebaseline

- **Recorded:** 2026-09-01
- **Owner:** Agent A, planning/integration owner
- **Authority:** explicit user product decision
- **Status:** approved functional-app plan; TG-004R passed, application-lane WIP remains quarantined pending lane-local integration
- **Source plan:** `docs/plans/tracegate-poc-build-2026-09-01.md`

## Current product decision

TraceGate is a local functional proof of concept, not a production-grade remote-browser security platform or submission package.

The app:

1. Accepts a user-submitted public HTTPS URL, exact allowed origins, bounded prompt, one to twenty URL/text/semantic/state assertions, and model/run/concurrency settings.
2. Executes real isolated Solari sessions through the verified `deepseek/deepseek-v4-flash-0731` TanStack/OpenRouter path.
3. Gives the model an assertion-free execution DTO and dynamically available semantic safe tools.
4. Captures fresh browser-observable evidence after actions stop and grades deterministically as PASS, FAIL, or INCONCLUSIVE.
5. Persists authoritative local state in Drizzle/libSQL and provides snapshot/SSE live UI, bounded traces, reports, aggregation, and cleanup state.
6. Keeps Demo Store test-only. Production composition and grading do not depend on Demo admin, challenges, cart state, scenario IDs, or privileged evidence.
7. Defines PASS only as declared browser-observable assertion satisfaction, never arbitrary backend or business truth.

Fork establishment, video, social post, challenge submission, and submission polish are no longer product deliverables. Their historical evidence remains untouched.

## Preserved contract and evidence baseline

- TG-000 public-fork/workspace evidence remains truthful history.
- TG-001 verified Node `26.1.0`, global pnpm `12.0.0`, and exact pins.
- TG-002 measured real Solari fixture connectivity, Cloudflare Quick Tunnel use, at least five concurrent sessions, and recording/replay capability.
- TG-003 verified exact model slug `deepseek/deepseek-v4-flash-0731` through pinned TanStack/OpenRouter; optional models remain unverified.
- TG-005 measured local libSQL/Drizzle transaction, snapshot, ordered event, publish-after-commit SSE, and refetch feasibility.
- TG-006 remains the historical V1 checkpoint.
- TG-004R passed at `89e2c93` and provides the generic V2 shared baseline: public target/config, assertion DSL, assertion-free agent DTO, evidence/grade/outcome contracts, atomic ports, lifecycle/release types, bounded API/event projections, canonical fakes, and production Demo-export removal.

Historical evidence is append-only in meaning and cannot be repurposed to claim unmeasured safety or model support.

## Practical P0 safety boundary

The functional app uses capabilities already available or directly implementable in the browser/controller path:

- structural HTTPS URL validation with no credentials;
- exact user-declared navigation origins;
- rejection of IP literals, localhost/`.local`, malformed hosts, and unsupported ports;
- best-effort public A/AAAA DNS preflight with obvious private/reserved/mixed-answer rejection;
- a fresh anonymous Solari session and fresh controller per run;
- service-worker blocking where supported by the available browser capability;
- observable request interception for non-GET/HEAD requests, request bodies, WebSocket, beacon, downloads, and external protocols;
- pre-dispatch blocking of obvious auth, sensitive, financial, purchase, messaging, upload, permission, destructive, submit, stale, and unknown-effect controls;
- INCONCLUSIVE when observed policy activity or missing/unstable/ambiguous evidence prevents a trustworthy deterministic grade;
- close/release attempts in `finally` for every acknowledged provider session ID.

A Solari create is attempted once. A timeout/disconnect/malformed ambiguous result is not retried; it becomes INCONCLUSIVE and records potential-leak evidence. Lack of provider inventory reconciliation is disclosed but does not block the functional app.

## Strict-hardening probe retained as limitation evidence

TG-002R explored a stricter provider-network boundary. It did not establish:

- provider-side or forced-proxy pre-connect actual-IP enforcement for every browser/browser-process protocol;
- perfect DNS-rebinding prevention;
- complete visibility and blocking across all non-HTTP/browser-process traffic;
- provider inventory or safe correlation for every unidentified ambiguous create.

URL/request interception and DNS preflight remain useful defense in depth, but they do not prove whole-browser SSRF confinement. The functional app and report must say so. The missing strict controls are deferred hardening rather than current blockers.

## Assertions, evidence, and grading remain unchanged

The simplification does not weaken evaluation integrity:

- assertions remain outside model prompts, tool definitions/results, history, model events, agent trace, and evaluated-target traffic;
- assertion-only canaries test provenance/non-flow, while coincidental user/page lexical overlap is allowed;
- page text and accessibility semantics remain explicitly untrusted page-authored data and never certify action safety;
- grading uses only a fresh bounded canonical capture after the action FIFO drains;
- cancellation precedes observed policy violation, which precedes unverifiable evidence, PASS, then FAIL;
- one false plus one unverifiable assertion is INCONCLUSIVE;
- model belief/summary never grades a run.

## Demo disposition

Demo Store is retained only for deterministic URL/text/semantic/state tests, stable/unstable evidence, stale/ambiguous controls, prohibited-action cases, and prompt-injection fixtures. Production imports/exports/configuration/API/report/composition must remain independent of Demo admin, challenges, cart grading, scenario IDs, and fixture-host assumptions.

## Current WIP quarantine

Application work remains dirty under the exclusive B/C/D lanes and `pnpm-lock.yaml` remains dirty from concurrent manifests. TG-004R shared work is committed and no longer part of the interrupted quarantine.

Rules remain:

- do not blanket reset, stage, format, or commit another lane’s work;
- each owner reviews and rebases only its paths against TG-004R;
- keep reusable infrastructure and remove V1/Demo production assumptions;
- do not treat file presence as a green implementation;
- only Agent A regenerates the lockfile after intended manifests settle.

## Immediate functional path and four-lane assignments

```text
TG-004R PASS
  → integrate quarantined lane WIP against V2 contracts
  → parallel DB/API/UI + browser + agent + evaluation/grading slices
  → one real Solari/DeepSeek run
  → repeated runs and report
  → functional verification
```

- **Agent A:** evaluation/grading, one-evaluation queue, executor, precedence, aggregation, finally cleanup, integration, end-to-end tests, and final lockfile.
- **Agent B:** Solari provider/controller lifecycle, exact-origin and practical request/action guards, discovery, fresh evidence capture, fixture-only Demo, and one bounded public-site safety smoke before integration freeze.
- **Agent C:** pinned DeepSeek/OpenRouter adapter, assertion-blind prompt layers, dynamic safe tools, FIFO/current-revision checks, budgets/history/cancellation, and bounded event mapping.
- **Agent D:** clean V2 Drizzle migration/repositories, loopback API, authoritative snapshot/SSE, configure/live/report UI, and separate agent trace versus grading report.

The B-lane smoke uses measured capabilities and records limitations; it does not wait for a new provider/proxy feature.

## Deferred hardening and removed deliverables

Deferred:

- provider-side destination policy or forced outbound proxy;
- actual-IP enforcement across every browser-process protocol;
- stronger DNS pinning/rebinding defenses;
- exhaustive egress classification;
- provider inventory/ambiguous-create reconciliation;
- HTTP create idempotency;
- replay UX, optional models, distributed queues, remote database, hosted control plane, and richer assertions.

Removed from the product critical path:

- fork relationship as a delivery gate;
- challenge/submission requirements;
- README/video/social-post acceptance gates;
- exhaustive security gate numbering and repeated provider-hardening verification;
- any requirement to solve unmeasured provider networking features before building the functional app.

## Planning checkpoint scope

This rebaseline edits planning artifacts only. It does not integrate application WIP, modify source, regenerate the lockfile, or claim a new runtime result. The next implementation action is lane-local WIP integration against TG-004R.
