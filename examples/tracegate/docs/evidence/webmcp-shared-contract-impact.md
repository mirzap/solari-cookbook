# WebMCP shared-contract checkpoint

Date: 2026-09-01
Owner: Agent A
Scope: minimal functional-plan blocker resolution; no concrete browser or model implementation

## Decision and compatibility impact

The generic-site functional plan permits an experimental, user-opted-in, current-origin, read-only WebMCP path. The committed TG-004R surface had no way to represent that path and admitted targets only represented provider-grade pre-connect enforcement, even though the functional P0 explicitly uses practical best-effort controls. This checkpoint adds the smallest public surface needed by downstream lanes.

- `PublicEvaluationConfigV2.webMcpReadOnlyEnabled: boolean` is the explicit opt-in and defaults to `false`. Existing parsed inputs remain compatible.
- `WebMcpToolDescriptorV1` represents only a sanitized, locally admitted, current-origin, declared-read-only capability. Its object input schema is closed, primitive-only, bounded to 16 fields, and rejects destination-, credential-, and prohibited-effect-shaped fields.
- `SafeAgentToolName`, `SafeAgentAction`, `SafeAgentToolResult`, and `SafeAgentToolSurface` add `invokeWebMcpReadOnly`. The surface must expose the invocation name and a non-empty sanitized descriptor catalog together. Results are bounded, redacted, and explicitly `untrusted_page_tool_result`.
- `WebMcpReadOnlyAdapterPort` provides discovery and invocation without importing a concrete Agent B implementation.
- `SafeActionEffect` adds `admitted_read_only_webmcp`; `WebMcpGateState` adds `admitted_read_only`.
- `AdmittedPublicTarget.enforcement` adds `practical_best_effort`. That variant requires bounded `PracticalAdmissionControls` describing DNS preflight, service-worker handling, observable request interception, and explicit limitations. Existing provider/forced-proxy variants remain valid with `practicalControls: null`.
- The run-admission event accepts the new practical enforcement value.

No assertion schema or assertion payload was added to the agent DTO, WebMCP action/result, descriptor catalog, or agent trace event. The assertion-only canary tests continue to prove the intended provenance/non-flow boundary; page descriptors and results remain untrusted and cannot grade directly. Final grading still uses a fresh browser evidence capture.

## Affected lanes

- **Agent B:** implement discovery/sanitization/admission and current-origin invocation behind `WebMcpReadOnlyAdapterPort`; populate practical admission metadata from measured controls. No shared-local shadow types.
- **Agent C:** dynamically expose `invokeWebMcpReadOnly` only when `SafeAgentToolSurface.webMcpTools` is non-empty; treat descriptors/results as untrusted tool content and preserve FIFO/current-revision validation.
- **Agent D:** present `webMcpReadOnlyEnabled` as an experimental off-by-default option and display capability/degradation facts; persist the V2 config through canonical schemas.
- **Agent A:** evaluation composition supplies the adapter/safe-tool surface and preserves fresh-evidence-only deterministic grading.

## Canonical fixtures and negative coverage

- Accepted job-search descriptor with `query` and `minimumSalary` primitive fields.
- Accepted bounded/redacted untrusted result.
- Rejected missing read-only declaration, open input schema, destination-shaped input, and unredacted result.
- Accepted action/result exchange only with matching tool-call ID, observation revision, effect, and WebMCP tool ID.
- Fake adapter verifies current-origin discovery, invocation, and result identity.
- Practical admission requires explicit limitation metadata.

## Verification

Environment:

```text
node --version
v26.1.0

/Users/mirzap/Library/pnpm/bin/pnpm --version
12.0.0
```

Commands and results:

```text
/Users/mirzap/Library/pnpm/bin/pnpm --dir examples/tracegate --filter @tracegate/shared lint
PASS — tsc -p tsconfig.test.json --noEmit

/Users/mirzap/Library/pnpm/bin/pnpm --dir examples/tracegate --filter @tracegate/shared test
PASS — 27 tests, 0 failed

/Users/mirzap/Library/pnpm/bin/pnpm --dir examples/tracegate --filter @tracegate/shared build
PASS — tsc -p tsconfig.build.json
```

The workspace lockfile and every B/C/D-owned path were excluded from this checkpoint.
