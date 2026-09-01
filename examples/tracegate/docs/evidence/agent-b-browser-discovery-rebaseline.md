# Agent B F1/F2 browser, discovery, and fixture rebaseline

**Date:** 2026-09-01

**Plan authority:** functional-app plan at `a696651`, plus the explicit current assignment to implement the frozen shared read-only WebMCP ports

**Owner:** Agent B

**Scope:** `packages/solari`, `packages/discovery`, `apps/demo`, and browser/Solari evidence only

## Result

The B lane is rebaselined from the quarantined Demo-specific WIP to the generic public-site V2 contracts. This is a lane handoff, not F3 composition and not an end-to-end product PASS.

## Removed production coupling

The following production/admin connectivity path was removed:

```text
packages/solari connectivity probe/target
→ Demo server bundle
→ hidden admin secret/read route
→ Demo mutation/cart-style verification
```

Removed source:

- `apps/demo/src/__connectivity.ts`
- `apps/demo/src/server.ts`
- `apps/demo/src/server.test.ts`
- `packages/solari/src/connectivity-probe.ts`
- `packages/solari/src/connectivity-target.ts`
- `packages/solari/src/connectivity-target.test.ts`
- `packages/solari/src/safe-error.ts`

`apps/demo` now exports only the deterministic job-board fixture. Its tests start a test-local loopback HTTP server around `handleJobBoardFixture`; no admin secret, hidden evidence endpoint, production target dependency, or Solari import remains.

The Solari manifest no longer imports `@solarisdk/sdk`. Only Agent A may reconcile the shared `pnpm-lock.yaml`; Agent B did not stage, reset, or edit the dirty lockfile.

## Provider lifecycle

`SolariBrowserProvider` now provides:

- SDK `maxAttempts: 1` and no application create retry;
- zero create calls for pre-aborted or unsupported-region requests;
- typed definitive concurrency failure;
- ambiguous transport/create outcome with the caller's correlation ID and potential-leak marker;
- acknowledged-session validation before returning a lease;
- one bounded emergency release attempt if an acknowledged provider payload cannot form a valid lease;
- idempotent lease release (one provider call for concurrent/repeated callers);
- `confirmed_released` only when `releaseAndWait` fulfills;
- rejection, including provider HTTP 404, remains `unconfirmed` cleanup failure;
- idempotent provider close.

The frozen `BrowserProvider` port cannot durably return cleanup state for an acknowledged malformed session that fails both lease construction and emergency release. The implementation performs the release attempt and returns a sanitized safe error, but Agent A must treat that narrow case as a contract/reporting limitation rather than as confirmed cleanup.

## Fresh controller and practical policy

`SolariCdpBrowserController` now requires:

- a distinct controller from the factory for each run;
- `connectOverCDP` followed by `browser.newContext({ serviceWorkers: "block", acceptDownloads: false })`;
- no use of, clearing, or fallback to a provider default context;
- service-worker registration blocking before the first page is created;
- context-wide HTTP and WebSocket routing before target navigation;
- partial setup cleanup when new-context or policy setup fails;
- context close before browser close, with idempotent non-throwing cleanup.

The practical policy provides structural exact-HTTPS-origin navigation, credential rejection, GET/HEAD-only observable requests, body rejection, WebSocket closure, popup/dialog/download/file-chooser handling, effective submit/form-method checks, and obvious auth/financial/messaging/destructive/file/permission/sensitive-control denial.

Cross-origin GET/HEAD subresources and some browser-process protocols remain observable-but-not-fully-confined limitations. Download cancellation may occur after a remote GET begins. This is not provider-grade egress enforcement or perfect DNS-rebinding prevention.

## Semantic observations and fresh evidence

Observations remain explicitly untrusted and now:

- use only opaque revision refs of the frozen `e:<revision>:<index>` form;
- retain locators only for elements included in the returned bounded observation;
- invalidate the ref registry on every main-document replacement, including same-origin navigation;
- reject stale revisions, document sequences, and missing refs before dispatch;
- re-read visible semantic identity before dispatch;
- bound the serialized observation envelope by UTF-8 bytes and mark text/element truncation;
- expose effective button/input type, form method, popup target, and download presence for local policy.

Repeated canonical assertion capture:

- waits the frozen 750 ms quiet interval;
- accepts two identical captures in at most three attempts;
- excludes transport-only observation revisions/refs from the semantic fingerprint;
- retains URL, document/loader identity, semantic order/state, policy activity, and assertion results in the fingerprint;
- separates transient canonical URL from redacted durable display URL;
- reports unstable required evidence as unverifiable;
- supports abort-safe quiet-interval cleanup.

## Discovery and WebMCP

`PracticalTargetAdmission` performs structural HTTPS validation, exact origins/default port enforcement, bounded A/AAAA lookup, normalized public-only IPv4/IPv6 classification, mixed-address rejection, per-host timeout, and abort-listener/timer cleanup. Mapped/compatible IPv4, local/link/site-local, multicast, documentation, 6to4, Teredo, benchmarking, and ORCHID forms fail closed. It records the three frozen practical limitations and does not claim DNS pinning.

`TraceGateDiscoveryController` remains bound to the active controller, current admitted origin, and exact observation revision. It bounds `/llms.txt`, JSON-LD transfer bytes plus traversal depth/nodes/types, semantic counts, interface records, and warnings. Any controller or traversal clipping projects to evidence as truncation.

The read-only WebMCP adapter is optional and capability-gated:

- disabled or semantic-only mode makes zero adapter calls;
- current-origin capability is checked before and after discovery/invocation;
- only explicit `readOnlyHint: true` descriptors with frozen closed primitive input schemas are admitted;
- unsafe text, credential/destination/prohibited fields, open/nested schemas, malformed descriptors, and excess tools are rejected;
- a descriptor is rediscovered and compared immediately before invocation;
- the controller atomically revalidates the exact descriptor object and executes it in one page function;
- input is revalidated against the admitted schema;
- output traversal and serialization are bounded in-page before transfer, then redacted and marked untrusted;
- adapter failure degrades to semantic browser controls with a bounded warning;
- WebMCP results never grade directly.

The controller is intentionally single-run and not safe for concurrent action dispatch. F3 must serialize proposals FIFO and revalidate their observation revision immediately before calling this lane.

## Focused verification

Commands were run from `examples/tracegate` with Node `26.1.0` and pnpm `12.0.0`:

```bash
pnpm --filter @tracegate/demo lint
pnpm --filter @tracegate/demo typecheck
pnpm --filter @tracegate/demo test
pnpm --filter @tracegate/demo build
pnpm --filter @tracegate/discovery lint
pnpm --filter @tracegate/discovery typecheck
pnpm --filter @tracegate/discovery test
pnpm --filter @tracegate/solari lint
pnpm --filter @tracegate/solari typecheck
pnpm --filter @tracegate/solari test
pnpm --filter @tracegate/solari build
node --check packages/solari/probes/public-site-safety-smoke.mjs
```

Measured results:

- Demo: lint/typecheck/build PASS; **5/5** fixture-only tests PASS after removing stale generated admin tests.
- Discovery: lint/typecheck/build PASS; **10/10** tests PASS.
- Solari: lint/typecheck/build PASS; **22/22** tests PASS.
- No local Playwright substitute was used for the credentialed smoke.

## Handoff and blockers

- Agent A must reconcile the Solari manifest importer in its sole authoritative lockfile update.
- F3 composition must provide serialized action execution, finally ordering, persistence of cleanup state, and mapping of observed policy activity to INCONCLUSIVE.
- The current real smoke is truthfully BLOCKED as recorded in `solari-public-site-safety-smoke.md`; its single acknowledged session was explicitly released.
- Provider-side pre-connect IP enforcement, forced proxying, full browser-process visibility, perfect DNS rebinding prevention, and unidentified-create inventory reconciliation remain deferred limitations.
