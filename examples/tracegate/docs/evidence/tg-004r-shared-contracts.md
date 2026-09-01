# TG-004R — V2 shared contract freeze evidence

Date: 2026-09-01

Owner: Agent A

Source of truth: `docs/plans/tracegate-poc-build-2026-09-01.md` at corrected V2 plan commit `dbce78d16fc49a8d4194e964079c1d11a801c1f6`

Scope: `packages/shared` plus this evidence record only

## Result

**PASS.** The shared production surface is V2-only and generic-site oriented. It contains no production Demo admin, challenge-navigation, cart-grade, or fixture-host contract. `src/demo.ts` was removed; the only retained deterministic Demo data is under `src/testing/legacy-demo.ts` and is reachable only through the package's explicit `/testing` export.

PASS means the contracts can represent and validate declared browser-observable assertions. It does not claim arbitrary backend business truth, backend GET safety, or semantic/effect safety from page-authored accessibility content.

## Frozen production schemas and helpers

- Public submission/target: `PublicEvaluationConfigV2Schema`, `PublicEvaluationTargetV2Schema`, `PublicHttpsUrlSchema`, `PublicHttpsOriginSchema`, `TargetAdmissionResultSchema`, `AdmittedPublicTargetSchema`.
- Assertions: closed `AssertionV1Schema` union for URL, text, semantic count, and state; `AssertionSetV1Schema` enforces 1–20 entries, unique stable IDs, exact origins, and bounded fields.
- Assertion isolation: strict data-only `AgentExecutionInputV2Schema`, `buildAgentExecutionInputV2`, `AgentPromptLayersV2Schema`, and separate non-serializable `SafeAgentToolPort`. Assertion-origin values have no DTO field. A canary test constructs the DTO from a config containing assertion-only canaries, proves non-flow, rejects assertion fields and agent-event extras, and separately proves coincidental lexical overlap from the user prompt remains allowed.
- Untrusted agent boundary: `UntrustedAgentObservationSchema`, `SafeAgentActionSchema`, dynamically bounded `SafeAgentToolSurfaceSchema`, tool-discriminated `SafeAgentToolResultSchema`, and identity/revision/effect-checked `SafeAgentToolExchangeSchema`.
- Policy: closed `SafeActionEffectSchema`, `PolicyDenyCodeSchema`, `EffectDecisionSchema`, and causal `PolicyActivitySchema`; unknown/unobservable actions remain deny-only.
- Evidence: in-memory-only `TransientCanonicalCaptureV1Schema` and durable/redacted `BrowserAssertionEvidenceV1Schema`; exact timestamp/hash/per-assertion correspondence is enforced by `AssertionCaptureResultSchema`. Closed unverifiable reasons are used by evidence and grading.
- Grading/outcome: `GradeInputV2Schema`, `GradeResultV2Schema`, closed assertion results, and `resolveUniversalDisposition`. Cancellation precedes policy, which precedes unverifiable evidence, false assertions, then pass. Policy/infrastructure overrides can truthfully produce INCONCLUSIVE without rewriting a complete assertion result; the authoritative failure is identical across grade, run, and terminal transaction.
- Errors/lifecycle: exhaustive terminal/warning/control codes; typed definitive concurrency limit with bounded Retry-After and no create retry; typed ambiguous-create error/correlation; strict confirmed-vs-failed release result.
- API/events: V2 snapshot/report/agent-trace projections, exact aggregate derivations, 512 KiB UTF-8 projection bounds, closed run-scoped evidence events, and 16 KiB UTF-8 persisted-event bound. Grading events are local control-plane data and do not enter agent trace.

## Frozen ports and atomic boundaries

- `TargetAdmissionPort.assess(target, signal)`.
- `EvaluationSubmissionRepository.transactionallyCreate(...)` atomically creates one clean queued evaluation, its complete 1–15 run expansion, and aligned sequence-zero queued events.
- `RunTransitionRepository.transactionallyApply(...)` atomically commits a legal intermediate transition and matching non-zero-sequence milestone.
- `RunRepository.transactionallyFinalize(...)` now carries `RunTransitionContext`; every non-cancelled terminalization is lease-safe and carries the same authoritative grade/failure/event outcome.
- `BrowserProvider.acquire(...)` takes a durable `attemptCorrelationId`; `BrowserControllerFactory.create(lease, signal)` constructs one controller per acquired lease; `BrowserController.close` is explicit and idempotent.
- `ProviderCreateAttemptRepository` durably records/retrieves unresolved create attempts; `ProviderSessionReconciliationPort` classifies an attempt and releases a reconciled session; `ProviderCapacityPort` enforces `effectiveCapacity <= configuredMaximum`.
- `AssertionEvidenceCapture.capture(controller, { assertions }, signal)` and pure `Grader.grade({ assertions, evidence }, signal)` remain concrete-implementation independent.

Canonical fakes cover atomic create conflict/idempotency, atomic transition/event append, lease-safe finalization, per-lease controller creation, strict safe-tool exchange, capacity reduction, durable ambiguous-create recovery, reconciliation/release, abort handling, and explicit positive release confirmation.

## Compatibility and migration impact

This is an intentional breaking V2 freeze, not a compatibility layer:

- V1 config, Demo target/admin/challenge/cart grading shapes, native-tool access, V1 observation/grade/event payloads, and remote/public P0 control-plane environment values do not parse or export.
- `EvaluationConfigSchema` and `GradeResultSchema` are V2-only aliases. There is no V1 reader/converter/migration machinery.
- TG-005R must create a clean V2 Drizzle `0000` and disposable local database; it must not translate spike/V1 rows.
- Consumers must use explicit `BrowserControllerFactory`, `SafeAgentToolPort`, `AssertionEvidenceCapture`, atomic submission/transition/finalization ports, create-attempt reconciliation, and strict release confirmation.
- `pnpm-lock.yaml` was not edited or staged. Concurrent B/C/D manifests and source remain quarantined.

## Exact affected lanes

- **Agent A / TG-007 evaluation+grading:** consume universal precedence, pure grader input/result, atomic submission/intermediate/terminal repositories, capacity reduction, and finally cleanup/reconciliation contracts.
- **Agent B / TG-008 Solari+discovery:** implement authoritative admission, correlated single-attempt acquire, per-lease controller factory, reviewed controller operations, strict release confirmation, provider reconciliation/capacity, and admitted-target discovery. No Demo admin or native tool surface.
- **Agent C / TG-009 AI+agent:** accept only `AgentExecutionInputV2` plus separately injected `SafeAgentToolPort`; use the closed tool/action/result exchange and keep assertion-origin values out of prompt/provider/history/agent-trace paths.
- **Agent D / TG-005R and TG-010 DB/API/UI:** persist the clean V2 entities, create-attempt/admission/environment/policy/evidence/grade records, atomic transactions, closed bounded events, exact aggregates, and separate bounded report versus assertion-blind agent trace. No V1 reader or Demo dependency.

## Verification

Measured runtime for this gate:

```text
node --version  => v26.1.0
pnpm --version  => 12.0.0
```

Commands were run from `examples/tracegate` with the measured Node and global pnpm directories explicitly prepended to `PATH`:

```text
pnpm --filter @tracegate/shared typecheck  => PASS (tsc -p tsconfig.test.json --noEmit)
pnpm --filter @tracegate/shared lint       => PASS (tsc -p tsconfig.test.json --noEmit)
pnpm --filter @tracegate/shared test       => PASS (25 tests, 25 passed, 0 failed)
pnpm --filter @tracegate/shared build      => PASS (tsc -p tsconfig.build.json)
```

`test/compile/downstream.ts` is included in `tsconfig.test.json` and compiled against only `@tracegate/shared` and `@tracegate/shared/testing`; it imports every load-bearing downstream port without concrete B/C/D implementation imports.

No workspace-wide result was claimed because sibling package manifests/source and the lockfile contain concurrent quarantined WIP. No known sibling red was attributed to TG-004R.
