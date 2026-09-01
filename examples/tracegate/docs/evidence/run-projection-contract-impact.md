# Run projection contract impact

Date: 2026-09-01
Owner: Agent A

The canonical `Run` already stores duration, token usage, release status, and replay status, but `RunSnapshot` omitted them. Because the evaluation report embeds `RunSnapshot`, Agent D could not truthfully implement the functional live cleanup state or required usage/duration report without defining a duplicate public projection.

This checkpoint adds only these derived fields to `RunSnapshotSchema`:

- `durationMs`;
- typed `usage`;
- `releaseStatus`;
- `replayStatus`.

`EvaluationReportProjectionSchema` gains them transitively through its existing run array. A canonical fixture projects all fields from the V2 run fixture and focused contract coverage verifies cleanup and usage values. Persistence schema and source rows are unchanged.

Affected lanes: Agent D maps durable rows into the expanded canonical snapshot/report; Agent A consumes the same projection in integration tests. B/C interfaces are unchanged. No lockfile or sibling-owned path is included.
