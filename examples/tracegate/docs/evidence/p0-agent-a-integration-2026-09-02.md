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

## Blocking D-owned findings

### Pre-provider blocker

`apps/web/src/server/functional-runtime.ts` binds `PersistingGrader` state as one `Map<evidenceHash, RunId>`. Independent concurrent runs can legitimately produce identical evidence hashes. A later bind can overwrite the first run, the first grade can emit under the wrong run and delete the shared binding, and the other grade can then fail as unbound. This violates independent-run attribution and blocks repeated-run/provider validation.

Required D correction: use run-scoped or exact-invocation/object-scoped grade binding. Do not make evidence hashes run-specific; identical evidence should remain identical content evidence.

### Additional D-owned lifecycle risks

- Semantic readiness is derived from retained semantic control count, while terminal `inspect`/`scroll` activity can be classified as `semantic_ui`; a `0/0` readiness tuple plus invocation can fail the interface-usage invariant.
- Shutdown cancels uncommitted reservations and may consider the queue idle while `transactionallyCreateSubmission` is still in flight, allowing database close or a cancelled reservation to race a just-committed durable submission.

These paths were reviewed but not edited because they are D-owned.

## Checkpoint decision and residual gaps

**Decision: pre-provider NO-GO.** Production compilation, DB packaging, prompt rejection, and safe loopback reads are green, but the D-owned grade-attribution defect must be corrected before a real provider validation workstream is ready.

Deferred or unverified:

- real Solari/OpenRouter run and confirmed release;
- page WebMCP invocation against a real or explicitly labeled capability fixture;
- configured-MCP invocation/cleanup and public-HTTPS limitation validation;
- queue-full runtime rejection without rows/events;
- repeated independent sessions and aggregate/report reconstruction;
- assertion canary non-flow inspection;
- cancellation, reconnect/gap recovery, and restart recovery;
- recording/replay, optional models, and visual fallback remain unavailable or outside current claims;
- provider-grade egress enforcement and perfect DNS-rebinding prevention remain explicit hardening limitations.
