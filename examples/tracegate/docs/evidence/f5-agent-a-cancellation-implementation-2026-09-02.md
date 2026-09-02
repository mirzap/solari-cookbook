# F5 Agent A durable cancellation implementation — 2026-09-02

## Decision

D commit `00725bc` supplies the required awaited runtime handoff, and Agent A now implements the durable cancellation admission and evaluation/run reconciliation in `packages/evaluation/src/orchestrator.ts`.

The integrated production graph, clean migration/check, and bounded empty-DB built-server sanity gate pass. No automated test or provider session was created or run. The code is ready for one separately authorized final live cancellation validation; that live gate remains necessary before F5 can close.

## D handoff accepted unchanged

D-owned code now performs this ordering:

1. confirm that the runtime is not closing and the queue owns the active evaluation;
2. `await executor.requestCancellation(evaluationId, boundedSignal)`;
3. only after durable admission resolves `true`, synchronously call `queue.cancel(evaluationId)`;
4. return acceptance to the server/route, which may then return HTTP 202.

Agent A did not edit D paths. This removes the former window in which an in-memory abort could be accepted before durable cancellation intent existed.

## A-owned semantics

### Durable admission

`FunctionalEvaluationExecutor.requestCancellation(...)` uses `EvaluationRepository.compareAndSetStatus(...)` with `running → cancelling` as the acceptance linearization point.

- It resolves `true` only after that CAS commits or an independent reread proves `cancelling`/`cancelled` already exists.
- A CAS loss is reconciled by status. `completed`, `failed`, `queued`, or missing returns false without mutation.
- An ambiguous persistence error receives one independent bounded reread. If durable cancellation cannot be proved, the original error is propagated and D cannot return 202.
- A bounded retry handles a false CAS followed by a still-`running` row without looping indefinitely.
- A per-evaluation dispatch barrier is raised synchronously before admission persistence begins. Capacity/dispatch continuations wait for that barrier, so no new run is launched between the durable CAS commit and its promise resolution. The cancellation-admitted flag is set only after durability is proved; the durable DB state remains authoritative across process loss.
- Repeated route behavior may remain HTTP 409 because D's route/server admits only a currently running evaluation. Internal CAS/reread reconciliation is idempotent and never overwrites a terminal state.

### Dispatched-run reconciliation

At the first observed durable admission or queue abort, the orchestrator captures the active run indices and the never-dispatched suffix and stops normal dispatch.

All active work drains. A cancellation-required dispatched run is accepted only when it returns:

- the correct durable run identity;
- `terminalized: true` and status `cancelled`;
- null outcome, grade, run failure, and executor failure;
- no potential session leak;
- either no acquired lease with `releaseStatus=not_started`, or a provider-confirmed release with durable `releaseStatus=released`.

The run executor already closes safe-tool/controller resources and attempts provider release with independent timeout signals. An acknowledged session whose release is not confirmed causes the run executor to reject; the evaluation cannot become `cancelled`.

A run that durably completed before cancellation remains terminal and is never rewritten. If it was still active at the captured cancellation boundary and returns completed instead of cancelled, the evaluation takes the failure path rather than claiming clean cancellation.

### Never-dispatched runs

Every never-dispatched queued run is passed sequentially through the existing run executor with an already-aborted signal.

The initial signal-bound `queued → acquiring_browser` transition cannot apply, so no target admission, provider acquisition, browser connection, model call, evidence capture, or grader call occurs. The executor then uses its independent transactional cancellation path to commit `queued → cancelled` plus the canonical `run.cancelled` event.

The orchestrator additionally requires the returned row to retain:

- `startedAt=null` and `resolvedProvider=null`;
- zero iterations, tool calls, and browser actions;
- null token usage, outcome, grade, and failure;
- no lease/release object, `releaseStatus=not_started`, and no potential leak.

The DB legitimately derives cancelled duration from creation time even when `startedAt` is null, so duration is not used as evidence that resources were acquired.

Every queued cancellation is attempted even if an earlier one fails, so peer cleanup is not skipped.

### Evaluation terminal authority

`cancelling → cancelled` is allowed only after all cancellation-required runs return trustworthy durable cancelled records and every pre-boundary run has a durable terminal record.

Any executor rejection, wrong identity, missing/nonterminal row, active completed race, unconfirmed provider release, potential leak, or failed queued-run cancellation commits `cancelling → failed` with a bounded infrastructure failure. No grade is synthesized or changed.

Normal completion and failure CAS losses reread durable state:

- terminal `completed`, `failed`, or `cancelled` is preserved;
- a cancellation that wins a normal failure race first cancels every never-dispatched row, then commits `cancelling → failed` because the original failure prevents clean cancellation;
- a cancellation that wins normal completion moves to cancellation finalization;
- no helper falls back from durable `cancelling` to an unrelated `running` write before run cleanup reconciliation.

Evaluation cancellation finalization and failure writes use independent bounded signals after intent is durable. A queue/shutdown abort observed without prior route admission attempts the same durable admission before draining active work. If admission cannot be proved, the orchestrator still attempts every queued cancellation and fails from the durable `running` or `cancelling` state rather than exiting with a clean cancellation claim.

## Production-only verification

Commands ran from `examples/tracegate`:

```bash
mise exec -- pnpm --filter @tracegate/evaluation build
mise exec -- pnpm build
DB=/tmp/tracegate-f5-cancel-a-final-20260902.db
test ! -e "$DB"
DATABASE_URL="file:$DB" mise exec -- pnpm db:migrate
DATABASE_URL="file:$DB" mise exec -- pnpm db:check
DATABASE_URL=file:/tmp/tracegate-f5-cancel-a-final-20260902.db \
  TRACEGATE_PORT=3109 mise exec -- pnpm start
curl http://127.0.0.1:3109/api/health
curl -X POST -H 'Origin: http://127.0.0.1:3109' \
  http://127.0.0.1:3109/api/evaluations/00000000-0000-7000-8000-000000000000/cancel
sqlite3 /tmp/tracegate-f5-cancel-a-final-20260902.db \
  "select (select count(*) from evaluations), (select count(*) from runs), (select count(*) from browser_sessions), (select count(*) from provider_create_attempts);"
```

Results:

- evaluation production build passed;
- all 11 production workspaces built successfully; `@tracegate/e2e` was excluded;
- the final Turbo gate reported `11 successful`, `9 cached`, total `1.88s`;
- web client and SSR composition compiled against D's awaited `requestCancellation` call;
- migration applied successfully to the previously absent DB;
- Drizzle check reported `Everything's fine`;
- final built health returned HTTP 200 in `0.756552s`, with database/WebMCP okay and unused model/Solari dependencies degraded;
- missing evaluation cancellation returned bounded HTTP 404 in `0.003982s`;
- the fresh DB retained `0` evaluations, `0` runs, `0` browser sessions, and `0` provider-create attempts;
- Ctrl-C stopped the server; the pnpm wrapper reported interruption exit `1`.

Static inspection confirmed that cancellation reconciliation never invokes the grader or creates a grade, queued cancellation enters the run executor with an already-aborted signal, acknowledged release remains mandatory before run terminalization, and evaluation failure from `cancelling` is legal in the existing shared transition graph.

## Ownership and remaining live gate

Changed production path:

- Agent A: `packages/evaluation/src/orchestrator.ts`.

Changed documentation paths:

- Agent A: this evidence record and the authoritative source plan.

No shared, grading, root, lockfile, test, B, C, or D file changed.

The final live cancellation validation is now ready but not yet executed. One separately authorized provider/UI run must still observe:

1. hydrated running-state reload;
2. visible cancellation submission;
3. HTTP 202 only with durable `cancelling` already committed;
4. active run abort and provider-confirmed release;
5. every configured run terminal, including never-dispatched rows;
6. terminal evaluation `cancelled` only with trustworthy cleanup;
7. no grade/evidence fabrication, no leaks, and no nonterminal rows after shutdown.

A failure of any condition keeps F5 open. This checkpoint does not claim replay, external page-WebMCP invocation, authenticated/external configured MCP, visual fallback, or broader recovery support.
