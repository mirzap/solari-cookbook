# P0 Agent A integration evidence — 2026-09-02

## Scope and constraints

Agent A reviewed the oracle plan, the authoritative source plan, `AGENTS.md`, and commits `647e4dd`, `ef7e1fb`, `e478598`, and `443c5e7`. Work remained inside Agent A ownership: TraceGate root guidance, `packages/evaluation`, product/plan/integration evidence, and final lockfile authority. No B/C/D-owned implementation file was edited.

Automated tests were not created, edited, compiled as claimed evidence, or run. No real Solari, OpenRouter, page-WebMCP, or configured-MCP provider session was started. Temporary validation databases were created under `/tmp`; the repository database was not recreated or removed.

## Integrated contract review

- `AgentRunResultSchema` carries the closed `completionDisposition` and bounded closed warnings. Legacy `completedBelief` is read conservatively, and explicit belief/disposition disagreement is rejected.
- `FunctionalRunExecutor` passes `agentResult.completionDisposition` into deterministic grading and merges both discovery warnings and agent/provider warnings using stable `(code, phase, message)` deduplication with the run-level cap.
- `DeterministicObservableGrader` preserves PASS/FAIL/INCONCLUSIVE authority. `policy_refused`, `blocked`, and `needs_input` produce INCONCLUSIVE failures; browser policy evidence retains `unsafe_action_blocked` precedence. Assertion truth cannot make a non-completed run pass or fail.
- `FunctionalEvaluationExecutor` now records individual run executor/finalization failures by configured index, continues dispatching safely runnable peers while capacity/control-plane state remains usable, drains active work, does not fabricate missing terminal records, and selects the lowest configured failed index deterministically.
- Queue reservation remains synchronous and occurs before submission persistence. Unsafe prompt admission occurs before repository access or queue reservation.
- B target admission and C configured-MCP request admission both use the A-owned pure hostname/IP classifiers. C rechecks before initialize, notifications, requests, tool calls, and cleanup requests.
- D report/UI projections read persisted run outcome/failure rather than model completion text or assertion truth.

## Ownership audit of requested commits

| Commit | Lane | Paths observed | Ownership result |
|---|---|---|---|
| `647e4dd` | A | `AGENTS.md`, A evidence, `packages/shared`, `packages/evaluation`, `packages/grading` | Within A ownership |
| `ef7e1fb` | C | `packages/agent`, `packages/ai` | Within C ownership; integrated unchanged |
| `e478598` | B | B evidence, `packages/discovery`, `packages/solari` | Within B ownership; integrated unchanged |
| `443c5e7` | D | `packages/db`, `apps/web` | Within D ownership; integrated unchanged |

Agent A changed only:

- `examples/tracegate/AGENTS.md`;
- `examples/tracegate/packages/evaluation/src/executor.ts`;
- `examples/tracegate/packages/evaluation/src/orchestrator.ts`;
- `examples/tracegate/docs/plans/tracegate-poc-build-2026-09-01.md`;
- `examples/tracegate/docs/product/tracegate-product.md`;
- this evidence file.

No manifest changed. `pnpm-lock.yaml` remained unchanged because frozen installation reported it current.

## Commands and observed results

All successful runtime commands used the installed mise toolchain; Corepack was not used.

1. Direct PATH probe:

   ```bash
   node --version && pnpm --version
   ```

   Result: exit `127`, `node: command not found`. No build or install ran from this failed command.

2. Toolchain and lockfile:

   ```bash
   mise exec -- node --version
   mise exec -- pnpm --version
   mise exec -- pnpm install --frozen-lockfile
   ```

   Result: Node `v26.1.0`, pnpm `12.0.0`; all 13 workspace projects resolved from the existing lockfile; supply-chain policy check passed for 294 entries; lockfile was up to date.

3. Agent A production package builds:

   ```bash
   mise exec -- pnpm --filter @tracegate/shared build
   mise exec -- pnpm --filter @tracegate/grading build
   mise exec -- pnpm --filter @tracegate/evaluation build
   ```

   Result: exit `0`; all three production TypeScript build configurations passed on the final working tree.

4. Environment and whole production composition:

   ```bash
   mise exec -- pnpm env:check
   mise exec -- pnpm build
   ```

   Result: exit `0`. Environment parsing reported loopback bind and configured provider credentials without exposing them. Turbo built 11 production packages and excluded `@tracegate/e2e`; all 11 succeeded. Vite produced client and SSR bundles. Turbo warned that `@tracegate/agent#build` declares no output files, but the command itself completed successfully.

5. Fresh temporary database:

   ```bash
   DATABASE_URL=file:/tmp/tracegate-agent-a-final-20260902.db mise exec -- pnpm db:migrate
   DATABASE_URL=file:/tmp/tracegate-agent-a-final-20260902.db mise exec -- pnpm db:check
   ```

   Result: migration `0000` applied successfully; Drizzle check reported `Everything's fine`; both commands exited `0`.

6. Final built-server smoke, without evaluation execution:

   ```bash
   DATABASE_URL=file:/tmp/tracegate-agent-a-final-server-20260902.db TRACEGATE_PORT=3103 mise exec -- pnpm start
   curl http://127.0.0.1:3103/api/health
   curl http://127.0.0.1:3103/api/capabilities
   curl -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3103' \
     --data '{"prompt":"Buy this item now"}' \
     http://127.0.0.1:3103/api/evaluations
   curl -H 'Host: evil.example' http://127.0.0.1:3103/api/health
   curl http://127.0.0.1:3103/
   /usr/bin/sqlite3 /tmp/tracegate-agent-a-final-server-20260902.db \
     'select (select count(*) from evaluations), (select count(*) from runs), (select count(*) from events);'
   ```

   Observed:

   - production server started on `127.0.0.1:3103` after applying migrations;
   - health returned `200` and `degraded`: database/WebMCP were `ok`, while model/Solari were intentionally `degraded` because no live usage/session was performed;
   - capabilities returned `200`: database was verified, the configured model and Solari remained honestly `pending`, and no blocker code was fabricated;
   - the prohibited purchase prompt returned `400 unsafe_prompt_rejected` at `prompt_admission`;
   - SQLite counts remained `0|0|0`, confirming that this rejected request created no evaluation, run, or event row;
   - hostile `Host: evil.example` returned `403` before application repository access;
   - the product shell returned `200` with 7,082 bytes;
   - stopping the foreground preview with Ctrl-C produced the wrapper's expected nonzero interruption exit; it was not a product startup failure.

Queue-full behavior was not exercised because safely occupying the queue would require evaluation submissions that could start real provider work. Its no-row/no-event guarantee is static-review-only at this checkpoint.

## Agent D correction re-audit — `c8f79c2`

Agent A reviewed commit `c8f79c29aa03f2c57ae00338fa38f749c1df4582` without modifying its four D-owned files.

### Run-scoped grading identity — resolved

- `FunctionalTracegateRuntime` creates an `AsyncLocalStorage<RunId>` context around each `runExecutor.execute(...)` invocation.
- Assertion capture requires the async run ID to match the controller's registered run ID before evidence persistence.
- `PersistingGrader` no longer stores `evidenceHash → RunId`. It obtains the active run ID from the invocation context, reloads committed evidence by that run ID, and requires the canonical persisted evidence to match the grading input.
- Equal evidence hashes therefore remain equal content evidence and cannot overwrite or consume another concurrent run's grading binding.

This is statically and production-build verified. Concurrent equal-hash provider executions remain a later F4 runtime observation, not a current provider claim.

### Semantic evidence projection — resolved

- `PersistingAgentRunner` deduplicates the first `run.tool.completed` event per tool call and uses `toolCompletionInterfaceUsageDelta(...)`; starts, names, summaries, durations, and arbitrary text do not establish invocation.
- A dispatched semantic terminal completion is positive evidence that the proposal passed refreshed surface, schema/revision, and policy checks and entered the admitted semantic tool port. It therefore supports binary semantic `discovered/admitted = 1/1`, independent of whether the terminal call succeeded or failed.
- The same evidence rule is applied in runtime finalization, DB snapshot reconstruction, and UI/report projection. Explicit persisted invocation remains the fallback only when that channel has no terminal tool trace.

This resolves the former `0/0` semantic readiness plus invocation schema failure without turning tool activity into task or grade success. Real provider-generated terminal projection remains unverified until F3/F4.

### Submission shutdown settlement fence — resolved

- Every successful queue reservation registers a settlement promise before returning to `TracegateServer`.
- `commit()` and `release()` settle the promise exactly once through a shared guarded closure.
- Shutdown sets `#closing` synchronously, preventing later reservations; cancels the current queue snapshot; waits for all already-registered reservation-to-transaction settlements; then waits for queue idle before closing the provider and database.
- A transaction already in flight can finish while the database remains open. If shutdown won the race, the reservation is released and any durably queued evaluation remains recoverable instead of starting against closing resources.

This is statically and production-build verified. A shutdown during a deliberately delayed live submission was not exercised because tests and provider-triggering submissions are forbidden in this phase.

## Final production-only re-gate

Commands:

```bash
cd examples/tracegate
mise exec -- node --version
mise exec -- pnpm --version
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm env:check
mise exec -- pnpm build
DATABASE_URL=file:/tmp/tracegate-agent-a-dreaudit-20260902.db mise exec -- pnpm db:migrate
DATABASE_URL=file:/tmp/tracegate-agent-a-dreaudit-20260902.db mise exec -- pnpm db:check
DATABASE_URL=file:/tmp/tracegate-agent-a-dreaudit-server-20260902.db TRACEGATE_PORT=3104 mise exec -- pnpm start
```

Observed:

- Node `v26.1.0`, pnpm `12.0.0`;
- frozen install passed its 294-entry supply-chain policy check and reported the lockfile current;
- environment parsing passed with loopback binding and configured credentials without disclosing them;
- all 11 production packages built successfully; `@tracegate/e2e` was excluded;
- fresh migration `0000` and Drizzle `db:check` passed;
- built server started on `127.0.0.1:3104`;
- health returned `200 degraded`, with DB/WebMCP `ok` and model/Solari honestly `degraded` because no live provider usage occurred;
- capabilities returned `200`, database verified and model/Solari pending;
- missing evaluation read returned bounded `404 not_found`;
- prohibited purchase prompt returned `400 unsafe_prompt_rejected`;
- hostile Host returned `403`;
- product shell returned `200` with 7,082 bytes;
- SQLite counts remained `0|0|0` for evaluations/runs/events after the rejected prompt;
- Ctrl-C stopped the foreground preview and produced the wrapper's expected interruption exit.

No automated tests, test files, provider sessions, or D-owned edits were involved. `pnpm-lock.yaml` did not change.

Queue-full behavior was not exercised because occupying the queue could start provider work. Its reservation-before-persistence behavior remains static-review-only for this checkpoint.

## Checkpoint decision and residual gaps

**Decision: pre-provider GO for one bounded F3 validation.** The former three D blockers are genuinely resolved, the final production graph and clean DB gate pass, and no new P0 blocker was found. This decision authorizes the real-provider validation workstream; it does not claim that workstream succeeds.

Still unverified or deferred:

- one real Solari/OpenRouter run, deterministic terminal outcome, authoritative snapshot/report/trace, and confirmed release;
- concurrent equal-evidence run attribution and repeated-run aggregate reconstruction;
- queue-full runtime rejection without rows/events;
- shutdown while a submission transaction is actually in flight;
- page WebMCP invocation against a real or explicitly labeled capability fixture;
- configured-MCP invocation/cleanup and public-HTTPS limitation validation;
- assertion canary non-flow inspection;
- cancellation, reconnect/gap recovery, and restart recovery;
- recording/replay, optional models, and visual fallback remain unavailable or outside current claims;
- provider-grade egress enforcement and perfect DNS-rebinding prevention remain explicit hardening limitations.
