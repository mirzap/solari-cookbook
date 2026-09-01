# Click navigation shared-contract correction

Date: 2026-09-01
Owner: Agent A
Scope: minimal generic shared-contract correction for recovery step 3; no controller, composition, target-specific, or test changes

## Concrete blocker and decision

The production composition can truthfully execute a `click` action against an anchor whose exact-origin HTTPS `href` has already been admitted by the Solari controller. That execution returns the existing safe effect `admitted_get_navigation`. The frozen `SafeAgentToolResultSchema` rejected this truthful pair because its action/effect compatibility matrix permitted `admitted_get_navigation` only for `navigate` and permitted only `disclosure_toggle` or `local_filter_select` for `click`.

The generic correction is intentionally limited to this compatibility rule:

```text
click allow-effects:
  before: disclosure_toggle | local_filter_select
  after:  admitted_get_navigation | disclosure_toggle | local_filter_select
```

No tool name, action variant, effect value, deny code, or unsafe capability is added. `admitted_get_navigation` continues to mean that the concrete browser policy layer admitted an exact-origin HTTPS GET navigation. The shared schema does not infer admission from an element, URL, target, or action kind; it only permits a truthful result emitted after the owning controller has enforced admission.

## Affected contracts and lanes

- `SafeAgentToolResultSchema` now accepts `tool: "click"` with an allowed `EffectDecision.effect` of `admitted_get_navigation`.
- `SafeAgentToolExchangeSchema` accepts that same result when its tool-call identity and observation revision still match the originating `click` action.
- `SafeAgentToolPort.execute` and `AgentRunner` require no signature change; they already exchange the affected result type.
- No event, trace, grading, assertion, evidence, persistence, API, or policy vocabulary schema changes.
- **Agent B / Solari:** remains responsible for exact-origin href validation before browser dispatch; no B-owned change is included here.
- **Agent C / agent:** can consume the existing `click` result without schema rejection; no C-owned change is included here.
- **Agent D / web composition:** can remove the blanket href-click denial and truthfully emit `admitted_get_navigation` only after the Solari controller succeeds; no D-owned change is included here.

## Compatibility and safety impact

This is backward compatible for every previously valid tool result. It broadens only one existing action/effect pairing and does not expand the effect vocabulary or authorize navigation by itself. Cross-origin, non-HTTPS, non-GET, body-carrying, stale, ambiguous, unsafe-control, submit, download, external-protocol, and other denied behavior remains outside this correction and subject to the existing controller/policy gates.

Assertion-origin values remain absent from the action, result, agent DTO, model history, trace, and target traffic. Fresh browser evidence remains the only grading input.

## Verification boundary

The user explicitly prohibited creating, modifying, or running automated tests. No tests were changed or executed.

Passed production validation:

```text
pnpm --filter @tracegate/shared typecheck
pnpm --filter @tracegate/shared build
pnpm --filter @tracegate/evaluation build
pnpm --filter @tracegate/agent typecheck
pnpm --filter @tracegate/agent build
pnpm --filter @tracegate/web typecheck
pnpm --filter @tracegate/web build
```

Static inspection confirmed the generated shared production runtime contains the corrected closed matrix and no new vocabulary. The evaluation package's nominal `typecheck` was also attempted, but its `tsconfig.test.json` compiles dormant test sources and failed on pre-existing `SafeAgentToolRuntime` / `configuredMcpTools` fixture drift. No test runner was invoked, those D/A-paused test files were not changed, and the production evaluation build passed.
