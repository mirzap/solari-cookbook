# Run cancellation contract impact

Date: 2026-09-01
Owner: Agent A

## Concrete defect and fix

The frozen V2 ports could atomically apply intermediate transitions and completed-run terminalization, but cancellation exposed only `RunRepository.compareAndSetStatus`. Appending `run.cancelled` separately would create a crash window in which the durable run and ordered event stream disagree.

`RunRepository.transactionallyCancel(CancelRunInput)` now symmetrically commits:

- the legal lease-safe transition to `cancelled`;
- null outcome/grade/failure as required by the canonical run schema;
- finish time, duration, cleanup status, warnings, and potential-leak state;
- the matching non-zero-sequence `run.cancelled` event and exact typed reason.

Cancellation with a possibly live lease is rejected. `leaseDisposition: released` requires `releaseStatus: released`. The canonical repository test proves both the rejection and atomic successful path.

Agent A uses this operation after `finally` cleanup. Agent D must implement the same transaction in the durable repository. B/C interfaces are unchanged. No sibling path or lockfile is included.
