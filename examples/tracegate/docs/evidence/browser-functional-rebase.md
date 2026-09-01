# Browser/discovery functional rebase evidence

**Date:** 2026-09-01
**Owner:** Agent B
**Scope:** functional phases F1/F2 in `packages/solari`, `packages/discovery`, and fixture-only `apps/demo`

## Runtime

```text
node --version -> v26.1.0
pnpm --version -> 12.0.0
```

The global pnpm executable was used directly. Corepack was not used. The shared WebMCP/practical-admission contract checkpoint `2e8e21e` was consumed without B-local shadow contracts.

## Implemented and measured

- Solari SDK HTTP attempts are pinned to one with `maxAttempts: 1`; an unclassified transport/create failure becomes the shared typed ambiguous-create error and is never retried by the provider.
- A provider 429/concurrency response becomes the shared definitive no-session capacity error.
- Release is considered successful only when pinned SDK `releaseAndWait` returns successfully. The TraceGate wrapper does not catch and reclassify an SDK error (including an explicit invalid-session 404) as success. Cleanup release is still attempted when the run execution signal was cancelled. This confirmation boundary inherits the pinned SDK's compatibility treatment of an untyped legacy bare 404 and does not claim an independent provider inventory check.
- A fresh controller is constructed per lease, clears cookies, blocks service-worker registration, attempts registration cleanup and CDP service-worker bypass, closes popups/dialogs/file choosers/downloads, and installs observable HTTP and WebSocket routing before navigation.
- Main-frame navigation is restricted to exact declared HTTPS origins. Observable non-GET/HEAD, request bodies, WebSockets, downloads, file choosers, popups, and alternate protocols are blocked. Obvious authentication, financial, messaging/publication, destructive, upload/download, permission, sensitive-field, and non-GET submit controls are blocked before dispatch. Safe GET search forms remain usable.
- Target admission performs structural HTTPS/default-port/local-host checks plus best-effort A/AAAA resolution and rejects private-only or mixed answer sets. It returns the shared `practical_best_effort` limitations rather than claiming provider-grade confinement.
- Discovery reads `/llms.txt` through the active guarded browser page, not ordinary ambient fetch, and extracts bounded page-authored JSON-LD types.
- Fresh evidence evaluates URL/text/semantic/state assertions independently of model output and accepts two identical canonical captures after the fixed 750 ms quiet interval, with three attempts maximum. Raw query-bearing final URLs remain transient; the durable display URL drops query/fragment and high-entropy path segments.
- Experimental WebMCP is opt-in through the shared config/port. The adapter retrieves only current-origin tools, admits at most ten descriptors that explicitly set `readOnlyHint: true` and use the shared closed primitive schema, rejects unsafe names/descriptions/destination or sensitive fields, re-discovers and byte-for-byte revalidates the admitted descriptor before dispatch, validates arguments, and emits only bounded/redacted explicitly untrusted results. Semantic controls remain available as fallback and WebMCP results never grade directly.
- `apps/demo` is a test-only anonymous engineering job-board fixture. It provides deterministic semantic GET filters, a progressive read-only `search_jobs` WebMCP registration, and a separate adversarial unsafe-control page. V1 challenge/admin/cart grading code is not exported or retained. Historical connectivity probe helpers remain internal to the Solari package and are no longer exported from its production root.

## Focused verification

```text
pnpm --filter @tracegate/solari lint -> PASS
pnpm --filter @tracegate/solari test -> PASS (13/13)
pnpm --filter @tracegate/solari build -> PASS
pnpm --filter @tracegate/discovery lint -> PASS
pnpm --filter @tracegate/discovery test -> PASS (5/5)
pnpm --filter @tracegate/demo lint -> PASS
pnpm --filter @tracegate/demo test -> PASS (6/6)
pnpm --filter @tracegate/demo build -> PASS
```

Coverage includes exact-origin/request classification, obvious unsafe controls, public/private/mixed DNS sets, in-browser discovery provenance, V2 observation alignment, stable/unstable fresh evidence, WebMCP read-only admission, malformed/unsafe descriptor rejection, descriptor revalidation, closed arguments, result redaction, semantic fixture fallback, and adversarial fixture controls.

## Real bounded public-site safety smoke

Credentials were loaded from local `.env` with values never printed or persisted. The smoke used `https://example.com/`, one Solari create attempt, no model call, recording disabled, a fresh controller, one title assertion, controller close, and provider release in `finally`. Provider session and CDP identifiers were deliberately omitted from output.

The first measured attempt found a real defect: the capture fingerprint included per-observation element refs, so unchanged page state exhausted three attempts and returned an unverifiable assertion. Cleanup still returned:

```json
{"release":"released","confirmation":"confirmed_released"}
```

The fingerprint was corrected to compare semantic element content without ephemeral refs, and regression coverage now changes observation revisions between identical captures. The repeated bounded smoke produced:

```json
{
  "admission": "practical_best_effort",
  "url": "https://example.com",
  "title": "Example Domain",
  "assertionStatus": "observed",
  "assertion": true,
  "captureAttempts": 2,
  "passivePolicyWarnings": 0
}
{"release":"released","confirmation":"confirmed_released"}
```

This proves the measured functional path only: public DNS preflight, a fresh real Solari session, exact-origin navigation, fresh deterministic title evidence, and acknowledged-session cleanup. It does not prove the deferred whole-browser egress, pre-connect actual-IP, perfect DNS-rebinding, forced-proxy, or ambiguous-create inventory guarantees.

## Remaining integration boundary

- A real public site exposing an admitted WebMCP tool was not available for this checkpoint; WebMCP browser execution is covered by the fixture contract plus adapter tests and remains experimental/off by default.
- Full agent-driven end-to-end composition, model tool dispatch, durable policy evidence, and UI/report display belong to the A/C/D integration phases.
- Existing strict-hardening probe evidence remains unchanged and truthful.
