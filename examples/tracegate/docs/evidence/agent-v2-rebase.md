# Agent C V2 rebase evidence

Date: 2026-09-01

Owner: Agent C (`packages/ai`, `packages/agent`)

Shared baseline: TG-004R `89e2c93`, WebMCP checkpoint `2e8e21e`

## Disposition

- Retained the pinned TanStack/OpenRouter adapter, exact P0 slug `deepseek/deepseek-v4-flash-0731`, provider-resolution boundary, usage normalization, redaction, cancellation propagation, and strict stream compatibility probes.
- Removed V1 Demo goal/success-criterion prompts, Demo-native tool assumptions, direct `BrowserController` ownership, obsolete failure codes, and raw tool argument/result milestones.
- Rebased the runner to `AgentRunner.run(AgentExecutionInputV2, SafeAgentToolPort, AbortSignal)`.
- The fixed system policy, separate untrusted user task, bounded capability summary, and untrusted browser/tool conversation are constructed without assertion schemas or values. The assertion-only canary fixture is absent from prompts and compacted history.
- Tool definitions are the current `SafeAgentToolSurface` only. Proposals are admitted once, normalized to non-provider IDs, executed FIFO, and revalidated against current surface/revision/origin/cancellation/budgets immediately before dispatch.
- Sanitized read-only WebMCP appears only when the canonical surface contains both `invokeWebMcpReadOnly` and a non-empty `WebMcpToolDescriptorV1` catalog. The adapter validates the descriptor's closed input schema; the runner revalidates tool ID/current origin; the browser-owned safe port remains the authority for effect admission and invocation. Results remain bounded, redacted, and explicitly untrusted. No local duplicate WebMCP contract was introduced.
- Model turns, tool proposals, browser actions, total tokens, wall time, per-tool timeout, observation bytes, and history bytes remain independent bounds. External cancellation becomes a redacted `operation_aborted` control error.
- Agent milestones use only the frozen bounded trace projection; provider call IDs and raw arguments/results are not emitted.

## Measured commands

Environment used the measured Node `26.1.0` and global pnpm `12.0.0` binaries from the TraceGate runtime evidence.

```text
pnpm --filter @tracegate/agent lint   PASS
pnpm --filter @tracegate/agent test   PASS — 7/7
pnpm --filter @tracegate/agent build  PASS
pnpm --filter @tracegate/ai lint      PASS
pnpm --filter @tracegate/ai test      PASS — 18/18
pnpm --filter @tracegate/ai build     PASS
```

Tests cover assertion non-flow, history redaction/compaction, independent budgets, dynamic omission, FIFO serialization, current-revision rejection, sanitized WebMCP admission and omission, cancellation, pinned routing/provider identity, bounded usage, malformed/unknown lifecycle rejection, and provider-error redaction.

No credentialed model call was rerun for this rebase. The real DeepSeek/OpenRouter capability claim remains the preserved TG-003 measurement in `docs/evidence/models.md`; these checks are deterministic adapter/runner verification only.

## Integration boundary

- Agent A/evaluation constructs the per-run runner with the selected model/sampling and passes the frozen assertion-free execution DTO plus a B-owned `SafeAgentToolPort`.
- Agent B owns descriptor discovery/sanitization, practical request/effect guards, WebMCP invocation, and current browser observations.
- Agent D consumes only bounded persisted agent milestones; grading evidence and assertion results remain separate.
- `pnpm-lock.yaml`, root configuration, shared contracts, and B/D paths were not edited or staged by Agent C.
