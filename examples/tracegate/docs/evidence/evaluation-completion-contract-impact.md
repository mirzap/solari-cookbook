# Evaluation completion contract impact

Date: 2026-09-01
Owner: Agent A

## Concrete defect

The V2 `FinalizeRunInput` atomically committed outcome, grade, failure, warnings, and terminal event, but had no field for the already-measured agent result or confirmed cleanup state. An executor using only frozen ports would therefore complete a run while losing `resolvedProvider`, iterations, tool calls, browser actions, token usage, replay status, release status, and potential-leak state. Those fields are required by the canonical `Run`, snapshot, aggregate, and report contracts.

## Minimal compatible fix

`FinalizeRunInput.resultPatch?: RunCompletionPatch` is optional, preserving existing callers. When present it atomically persists:

- `resolvedProvider`;
- iterations, tool calls, and browser actions;
- typed token usage;
- release and replay status;
- potential-session-leak state.

A terminalization declaring `leaseDisposition: released` rejects a supplied patch unless `releaseStatus` is exactly `released`. The canonical in-memory repository and focused finalization test now prove metrics and usage survive the atomic terminal commit.

Affected lanes:

- Agent A supplies the patch from the run executor.
- Agent D applies the optional patch in its durable `transactionallyFinalize` repository.
- Agents B and C require no interface changes.

No lockfile or sibling-owned path is part of this checkpoint.
