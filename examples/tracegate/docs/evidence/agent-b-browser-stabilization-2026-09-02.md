# Agent B browser/discovery stabilization handoff

**Date:** 2026-09-02

**Base:** shared I0 commit `647e4dd`

**Scope:** `packages/solari`, `packages/discovery`, and browser evidence only

## Implemented behavior

- `PracticalTargetAdmission` now uses only the shared `classifyNetworkHostname(...)` and `classifyResolvedIp(...)` structural classifiers. Public target admission still requires exact HTTPS/default-port structure, a nonempty DNS answer set, and every resolved address to classify as public. DNS evidence remains best effort and does not claim pinning.
- Semantic observation remains one in-page evaluation. The bounded remote-handle prefix is reduced to 48 visible candidates, prioritizes actionable controls in/near the viewport, retains 12 stable high-priority anchors, and rotates the remaining window on later `inspect`/observation passes. This adds progressive coverage without selectors supplied by the model or any new tool vocabulary.
- `observe()` has at most two capture attempts: one normal capture plus exactly one bounded same-session recovery after an eligible semantic/document failure. It never calls the provider and never creates or reacquires a Solari session. Recovery uses the existing controller/page and remains bounded by the controller deadline and caller abort signal.
- Browser failures carry only closed `browser.subphase` / `browser.operation` diagnostics (`connect`, `guard`, `navigation`, `semantic_capture`, `document_change`, or `timeout`). No URL, selector, request/body data, DOM text, provider endpoint, or arbitrary error text is persisted in these diagnostics.
- Browser action policy scope now ends when dispatch/commit handling ends, before post-action observation. A confirmed `page.goto(..., waitUntil: "commit")` is reported as `navigation_committed` if observation recovery later fails. Other dispatched interactions are reported as `interaction_dispatched_effect_uncertain`; they are not claimed to have completed a site effect.
- Fatal browser-policy evidence is checked before an active action scope closes. Blocked main-frame navigation and causally active prohibited effects remain fatal. Background popup/dialog/download/file-chooser activity with no active agent action is blocked but passive, as are already-classified ambient cross-origin requests/WebSockets.
- Passive policy activity contributes one bounded `passive_policy_blocked` discovery warning and never populates the fatal latch. Counts/codes remain bounded and assertion evidence remains valid when only passive blocks occurred.
- Direct-handle, successful rebind, ambiguous, exhausted, observation-recovery-attempted, observation-recovery-succeeded, and observation-recovery-exhausted counters are bounded to 1,000 and exposed through the B-owned current-page discovery snapshot/semantic interface metadata.
- Fresh assertion stability now fingerprints document/loader identity plus evaluated assertion status/result/reason in submission order. Canonical final URL participates only when URL assertions exist. Raw title/document text no longer makes an unchanged assertion predicate unstable.
- `llms.txt` and JSON-LD interface metadata explicitly says `agentAccess: "discovery_only"` and `contentProvidedToAgent: false`. Page WebMCP remains agent-usable only after current-origin read-only admission.
- Discovery state is keyed by run. Repeated discovery records whether the admitted origin changed, increments a bounded generation, refreshes semantic/`llms.txt`/JSON-LD/page-WebMCP readiness, and exposes the admitted WebMCP catalog for that run.

## Production-only verification

No automated test was created, modified, compiled as claimed evidence, or run. No provider/Solari session was started.

From `examples/tracegate`, using Node/pnpm from the installed Node 26.1.0 toolchain:

```bash
pnpm exec tsc --project packages/solari/tsconfig.build.json --noEmit --allowImportingTsExtensions true
pnpm exec tsc --project packages/discovery/tsconfig.build.json --noEmit --allowImportingTsExtensions true
pnpm --filter @tracegate/solari build
pnpm --filter @tracegate/discovery build
```

Observed result: both production-only typechecks and both production builds completed successfully. The package build configs exclude `src/**/*.test.ts` so paused automated-test sources are not part of this evidence.

## Required cross-lane integration

- The composed D-owned runtime already refreshes the page WebMCP catalog during safe-surface refresh. It does not yet call full B discovery after an admitted origin change, so refreshed semantic, `llms.txt`, JSON-LD, passive-warning, and recovery-counter records are not persisted after navigation. D must call the same `TraceGateDiscoveryController.discover(...)` path for the new observation and use `admittedWebMcpToolsForRun(runId)` (or the immediate compatibility getter) without inventing a parallel discovery implementation.
- Successful post-action observation recovery is visible in the returned observation summary and controller counters, but durable post-initial counter/warning projection depends on the D integration above. Existing shared failure/event contracts already preserve exhausted post-dispatch evidence as `target_evidence_lost`; no shared schema change was introduced.
- The J3 3/3 initial-observation defect has a generic bounded recovery and lower remote-handle cost in code, but remains externally unverified because this checkpoint explicitly forbids a provider session.

## Visual fallback handoff

The compatibility enum remains outside this lane. There is no screenshot capture, image-capable model path, visual tool dispatch, visual invocation accounting, or provider validation in Agent B. Visual fallback is **unimplemented** and must be removed from primary product claims/UI until a real safe visual path exists. This handoff must not be cited as visual capability evidence.
