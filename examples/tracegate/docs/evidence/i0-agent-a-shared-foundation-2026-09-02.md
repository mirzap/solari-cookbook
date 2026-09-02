# Integration Checkpoint I0 — Agent A shared foundation

Date: 2026-09-02
Owner: Agent A
Scope: TraceGate root guidance, `packages/shared`, `packages/evaluation`, `packages/grading`, and this integration evidence only

## Status boundary

This is a workstream checkpoint, not an authoritative plan-status or product-capability update. No external provider, browser, MCP, database, API, SSE, or UI behavior is claimed here. No automated test was created, modified, or run.

## Contract decisions

1. Prompt admission is deterministic, bounded to the existing 1,000-character public prompt, model-independent, and returns only closed codes with static product-safe messages. `PublicEvaluationConfigV2Schema` applies it before persistence-facing code can accept a config. Navigation/read-only surface references and immediate negations remain distinct from prohibited requested effects.
2. Agent completion is closed to `completed | policy_refused | blocked | needs_input`. Only `completed` is gradable; the other dispositions force overall INCONCLUSIVE with a closed terminal failure. Legacy `completedBelief: false` parses conservatively as `blocked`.
3. Fresh deterministic browser assertions remain authoritative evidence, but an already-true assertion cannot elevate a non-completed task to PASS. The grader retains browser-policy precedence and does not fabricate assertion failures.
4. Queue admission now has a synchronous reservation boundary. Capacity and duplicate failures are typed before persistence; reserved IDs consume bounded capacity but are exposed separately from durable queued evaluations.
5. `AgentRunResult.warnings` defaults to an empty array and accepts at most 10 closed warnings. The run executor deduplicates and merges them into the existing 50-warning run envelope without changing grade authority.
6. Shared hostname and resolved-IP classifiers are pure and cover loopback, public, private/reserved, link-local, unspecified, multicast, documentation/reserved, carrier-grade NAT, IPv6, and IPv4-mapped IPv6. DNS remains caller-owned.
7. Independent-run continuation and first-terminal event projection rules are reconfirmed but not claimed complete at I0. No other lane was edited.

## Exact downstream handoffs

The normative B/C/D producer and consumer rules are recorded in `AGENTS.md` under “Integration Checkpoint I0 workstream gate (2026-09-02)”. In summary:

- B replaces target-admission address logic with the shared classifiers while retaining exact-origin and all-answer public DNS semantics.
- C explicitly produces completion dispositions and bounded provider warnings, and applies the same network classifiers before every configured-MCP request.
- D explicitly performs prompt admission before repository access, consumes synchronous queue reservations around the atomic submission transaction, maps typed admission failures to bounded 409 responses, and treats persisted deterministic grade/failure as the only terminal success authority.
- C/D retain the existing failure-aware terminal event vocabulary, first-terminal-by-cursor rule, trace-only starts, and legacy-unclassified failure behavior.

## Commands and observed results

Working directory: `examples/tracegate`

| Command | Result |
|---|---|
| `pnpm --filter @tracegate/shared typecheck` | Did not start: `pnpm` was not on the initial shell PATH (exit 127). |
| `mise exec -- node --version` | `v26.1.0`. |
| `mise exec -- pnpm --version` | `12.0.0`. |
| `mise exec -- pnpm --filter @tracegate/shared typecheck` | PASS; TypeScript completed with no diagnostics. This repository script uses `tsconfig.test.json`; no tests executed. |
| `mise exec -- pnpm --filter @tracegate/evaluation typecheck` | BLOCKED by three pre-existing paused test-source type errors in `test/executor.test.ts` (`SafeAgentToolFactory` return shape and missing `configuredMcpTools`). No test file was changed and no test executed. |
| `mise exec -- pnpm --filter @tracegate/shared build` | PASS; production `tsconfig.build.json`. |
| `mise exec -- pnpm --filter @tracegate/evaluation build` | PASS; production `tsconfig.build.json`. |
| `mise exec -- pnpm --filter @tracegate/grading build` | PASS; production `tsconfig.build.json`. |

## Static review

- The final production builds were rerun after all code edits and remained green for shared, evaluation, and grading.
- Oracle diff review identified two in-scope hardening changes, both applied: the evaluation boundary now normalizes every `AgentRunResult` through the compatibility schema before consuming warnings/disposition, and universal outcome precedence now checks fatal browser policy before agent non-completion.
- The remaining Oracle findings were the already-declared B/C/D integrations (server reservation consumption, configured-MCP admission, target-admission migration, and shutdown handling); no other lane was edited.
- Static prompt-path inspection confirms the required safe examples are masked/negated before effect matching, while a later requested effect after a conjunction remains visible to the closed classifier. No prompt text is returned in a decision.
- Static queue inspection confirms reserve/duplicate/capacity mutations are synchronous, reservations count against `1 + maxPending`, commit is single-use, release cannot cancel committed work, reserved cancellation never invokes the job, idle includes reservations, and synchronous executor throws settle through the job promise without wedging the active slot.
- Static network inspection confirms bracketed input is accepted only as valid IPv6, IPv4-mapped IPv6 delegates to IPv4 classification, mixed-answer policy remains caller-owned, and the shared module imports no Node API or DNS implementation.
- `events.ts`, assertion capture/evaluation, safe tool names/effects, redaction utilities, and persistence schemas were not weakened. Existing legacy terminal-event parsing and exact-origin rules remain intact.

## Blockers after I0

- D must consume queue reservations before the submission transaction; until then the API cannot claim pre-persistence queue rejection.
- C must explicitly produce the new completion disposition and provider warnings.
- B and C must consume the shared network classifiers at their respective network boundaries.
- A's later independent-run orchestration change remains outstanding by the explicit I0-only scope.
- The existing evaluation scripted typecheck cannot be green while the paused test-source fixture errors remain; they are outside this workstream and may not be edited under the current test prohibition.
- No whole-workspace or external/provider validation has run.

No manifest changed, so `pnpm-lock.yaml` is intentionally unchanged.
