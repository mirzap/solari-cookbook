# TG-007 shared-contract impact checkpoint

- **Recorded:** 2026-09-01
- **Owner:** Agent A, sole shared-contract owner after TG-006
- **Requested by:** Agent B for TG-008
- **Status:** implemented and verified as a minimal frozen-contract correction
- **Scope:** public contracts only; no concrete Demo Store, Solari, discovery, evaluation, or grading adapter implementation

## Why the checkpoint is required

The TG-006 surface omitted the plan-named Demo administration boundary and an explicit controller teardown operation. It also reused `ObservationRevision` for trusted server-side Demo cart mutation evidence, falsely coupling independent DOM-observation and Demo-state counters. Agent B cannot truthfully implement TG-008 without these public contracts.

## Affected public contracts

### Added

- `DemoMutationRevisionSchema` / `DemoMutationRevision`: trusted Demo mutation/evidence counter, independent of DOM observation revisions.
- `SensitiveChallengeNavigationUrlSchema`: ephemeral HTTPS navigation value returned only to server-side orchestration; credentials and fragments are rejected and the value must never be persisted or emitted.
- `CreateDemoChallengeRequestSchema` and `DemoChallengeProvisionSchema`.
- `GetDemoGradeEvidenceRequestSchema` and `DemoGradeEvidenceEnvelopeSchema`, including envelope/evidence challenge-ID agreement.
- `DemoAdminPort.createChallenge(request, signal)` and `DemoAdminPort.getGradeEvidence(request, signal)`.
- `BrowserController.close(signal)`: abort-aware, idempotent controller/CDP teardown seam that orchestration calls before `BrowserLease.release`.
- Canonical `FakeDemoAdminPort`, challenge/evidence fixtures, and scripted browser `close` support.

### Changed

- `DemoGradeEvidence.revision` now uses `DemoMutationRevision` rather than `ObservationRevision`.
- `GradeResult.evidenceRevision` and `run.grade.started.payload.evidenceRevision` use `DemoMutationRevision`.
- `GradeContext` consumes the trusted `DemoGradeEvidence` directly; graders copy its authoritative `revision` into `GradeResult.evidenceRevision` rather than accepting a second, potentially tautological counter.

DOM-facing `AgentObservation.revision`, element refs, and `RunStep.observationRevision` remain `ObservationRevision` and are intentionally unrelated.

## Compatibility impact

- **Compile-breaking for BrowserController implementations:** add idempotent `close(signal)` without exposing CDP capabilities.
- **Compile-time brand correction for grading/events:** persisted wire values remain bounded integers, so no JSON representation or database migration is required solely for the revision split.
- **Additive for Demo adapters:** Agent B implements `DemoAdminPort`; no concrete implementation is included here.
- **No entity schema change:** no `Evaluation` or `Run` field changed.
- **No dependency or manifest change:** the authoritative lockfile is intentionally untouched by this checkpoint.

## Security and lifecycle rules

- The challenge navigation URL is sensitive ephemeral server data. It is not part of evaluation/run entities, events, observations, or grading evidence.
- The Demo adapter owns admin credentials. `createChallenge` results must match the request evaluation/run/challenge identity, and `getGradeEvidence` results must match the request run/challenge identity; canonical fakes enforce these postconditions.
- Controller close is abort-aware and idempotent after success; it is safe before connect and retryable after a failed close attempt.
- Controller close and provider lease release are separate operations. Evaluation cleanup attempts `BrowserController.close` first and still attempts `BrowserLease.release` in `finally` with a fresh bounded signal if close fails.
- Demo mutation revisions must never be inferred from, compared to, or substituted with DOM observation revisions.

## Fixture and consumer coverage

- Canonical challenge provision and grade-evidence envelope fixtures parse through the new schemas.
- Negative tests reject non-HTTPS, credential-bearing, and fragment-bearing navigation URLs plus envelope challenge-ID mismatches.
- Tests prove Demo mutation revision zero is valid while DOM observation revision zero is invalid, demonstrating independent domains.
- Canonical fakes record typed Demo admin requests, enforce response identity, and honor abort signals.
- Scripted browser tests cover repeated close, close before connect, and retry after a failed close.
- The downstream compile consumer includes `DemoAdminPort`.
- Shared typecheck, focused tests, build, and current downstream workspace compilation are required before this checkpoint lands.

## Lane acknowledgement

Agent B's formal request acknowledges the need and unblocks its Demo/Solari lifecycle implementation after this contract commit. Agents C and D must rebase and address only resulting compile failures in their exclusive paths; no concrete downstream source is changed by Agent A in this checkpoint.
