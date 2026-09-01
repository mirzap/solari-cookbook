# Agent A functional F1/F2 evidence

Date: 2026-09-01
Plan baseline: `a696651` plus the approved read-only WebMCP planning delta
Owner: Agent A

## F1 reconciliation

The committed TG-004R generic V2 contracts remained the baseline. No Demo/cart/challenge production contract was restored. Interrupted V1 application WIP in B/C/D paths was neither edited nor staged by Agent A.

Concrete shared blockers found while compiling the functional slices were resolved in isolated checkpoints:

- `2e8e21e` — bounded current-origin declared-read-only WebMCP contracts, explicit off-by-default opt-in, untrusted results, and practical best-effort admission metadata;
- `e907fbf` — optional atomic run-completion patch for provider, usage, action-count, cleanup, replay, and potential-leak data;
- `a142e12` — canonical run snapshot/report projection of duration, usage, release, and replay state;
- `54b735a` — atomic lease-safe run cancellation with the matching persisted event.

Each change has a dedicated compatibility note in this evidence directory, focused shared coverage, and an exact downstream-owner handoff. No other shared contract was reopened.

## F2 Agent A implementation

### `packages/grading`

- pure `DeterministicObservableGrader` over the frozen `GradeInputV2` evidence port;
- closed mapping for URL, text, semantic, and state assertion observations;
- universal precedence for prohibited activity, unverifiable evidence, false evidence, and pass;
- authoritative `assertion_failed`, `assertion_unverifiable`, and `unsafe_action_blocked` records;
- no model belief, summary, or WebMCP result participates in grading.

### `packages/evaluation`

- complete atomic evaluation/run/queued-event graph expansion;
- bounded single-active FIFO queue with duplicate rejection, one pending slot by default, pending cancellation, and active abort propagation;
- run-concurrency scheduler bounded by requested concurrency and current provider capacity, re-reading capacity before dispatching later runs;
- provider 429 classification reduces later capacity and never retries the current create;
- run executor over frozen admission/provider/controller/discovery/agent/capture/grader/repository ports;
- one fresh controller per acquired lease, assertion-free agent DTO, and explicit WebMCP opt-in in the safe-tool-factory context;
- deterministic terminal outcome/event and aggregate derivation;
- controller close and provider release in `finally` for every acknowledged session;
- atomic cancellation only after confirmed release;
- unconfirmed release remains a visible nonterminal red cleanup state rather than being falsely marked complete.

### `tests/e2e`

The fake-port functional chain composes submission, queue, evaluation executor, run executor, canonical browser/agent/capture fakes, the real pure grader, repositories, events, aggregation, and cleanup. It proves the assertion canary is absent from the agent input and enters only the fresh grading path.

## Verification environment

```text
node --version
v26.1.0

/Users/mirzap/Library/pnpm/bin/pnpm --version
12.0.0
```

## Commands and measured results

All commands used `/Users/mirzap/Library/pnpm/bin/pnpm --dir examples/tracegate`.

```text
--filter @tracegate/shared lint
PASS
--filter @tracegate/shared test
PASS — 28 tests, 0 failed
--filter @tracegate/shared build
PASS

--filter @tracegate/grading lint
PASS
--filter @tracegate/grading test
PASS — 9 tests, 0 failed
--filter @tracegate/grading build
PASS

--filter @tracegate/evaluation lint
PASS
--filter @tracegate/evaluation test
PASS — 14 tests, 0 failed
--filter @tracegate/evaluation build
PASS

--filter @tracegate/e2e lint
PASS
--filter @tracegate/e2e test:e2e:local
PASS — 1 test, 0 failed
--filter @tracegate/e2e build
PASS

--filter @tracegate/agent typecheck
PASS
--filter @tracegate/ai typecheck
PASS
```

No real Solari/OpenRouter composition was attempted; that is F3 and remains out of scope here.

## Lockfile and ownership

The package manifests for evaluation, grading, and e2e are Agent-A-owned. Invoking pnpm 12 package scripts caused pnpm to recognize the new workspace importers in the already-dirty working lockfile. The lockfile was not staged or committed, and no authoritative regeneration was attempted while B/D manifests remain in flight. Agent A will reconcile the sole lockfile after all lane manifests settle.

Path audit: the F2 commit includes only `packages/evaluation`, `packages/grading`, `tests/e2e`, and this evidence file. No B/C/D path is staged.

## Integration needs before F3

- **B:** commit `32bf0f2` now provides the concrete browser provider/controller, discovery, evidence capture, practical safety controls, and read-only WebMCP adapter; these remain uncomposed until the F3 integration step.
- **C:** commit `238d15c` provides `AgentRunner` and the pinned AI adapter; both typecheck against the current shared surface and remain uncomposed until F3.
- **D:** durable repositories must apply optional `FinalizeRunInput.resultPatch`, implement `transactionallyCancel`, and map the expanded canonical snapshot/report fields.
- **A integration:** once all intended manifests settle, regenerate the sole pnpm 12 lockfile, run workspace verification, wire composition/e2e credentials, and only then attempt F3.

No remaining Agent-A package blocker is known. RepoPrompt Oracle review was attempted during the shared checkpoint, but the RepoPrompt transport was closed; manual diff, schema, ownership, redaction, and focused downstream checks were used instead.
