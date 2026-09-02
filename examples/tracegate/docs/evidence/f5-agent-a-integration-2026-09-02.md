# F5 Agent A integration review — 2026-09-02

## Decision

The F5 lane commits are integrated and production-build clean:

- C `7eb59a8`: configured-MCP manual capability gate and bounded-output correction;
- B `749eb3a`: page-WebMCP real-browser capability evidence only;
- D `d041c79`: cancellation endpoint/UI plus queue, terminal reload, and redaction evidence.

**F5 remains blocked.** D's cancellation endpoint can return HTTP 202 after only an in-memory queue abort. The first durable `running → cancelling` transition occurs later in the A-owned executor, after active runs drain. No A-only asynchronous repository change can guarantee that the DB commit precedes the 202 while D's scheduler contract remains synchronous `cancel(...): boolean`.

Agent A did not edit B-, C-, or D-owned paths and did not add a fire-and-forget persistence task, synchronous-I/O workaround, or unused cancellation method. Those would not close the acceptance window.

## Commit and ownership audit

| Commit | Lane | Paths | Result |
|---|---|---|---|
| `7eb59a8` | C | `packages/agent/src/configured-mcp-client.ts`, C agent evidence | Within C ownership; integrated unchanged |
| `749eb3a` | B | B browser/WebMCP evidence only | Within B ownership; integrated unchanged |
| `d041c79` | D | `apps/web`, D UI/lifecycle evidence | Within D ownership; integrated unchanged |

No manifest changed and the lockfile was not regenerated.

## Integrated capability/lifecycle disposition

### F3 and F4

- F3's original provider/API/DB run passed.
- D's separate UI-attached run observed hydrated live progress through terminal state and closed the F3 live-UI requirement. That run honestly ended INCONCLUSIVE with no trustworthy final evidence; the UI matched API/DB authority and did not invent a PASS.
- F4 passed one evaluation with three concurrent independent runs, including three distinct Solari sessions, `3/3` deterministic PASS, one identical evidence hash correctly attributed through three run-bound evidence/grade rows, and confirmed release with zero leaks/nonterminal work.

### Configured MCP

C's manual gate passed for the deliberately narrow configured-MCP client:

- explicit product opt-in/opt-out shape;
- unauthenticated loopback Streamable HTTP lifecycle;
- deterministic injected public-DNS admission boundary without an external public MCP request;
- admission before each POST/notification/DELETE;
- read-only descriptor/input enforcement;
- bounded, redacted, untrusted results;
- truthful truncation, including deeply nested serialization failure;
- all established fixture sessions received DELETE attempts;
- configured-MCP result content, including a synthetic PASS claim, was rejected as grading input.

The C production fix measures original serialized structured output before redaction and conservatively marks serialization overflow as truncated. It does not prove authenticated, external public, enterprise, or provider-grade configured MCP.

### Page WebMCP

B's bounded real-browser gate could not observe `document.modelContext` in the managed browser. Page WebMCP remained `0/0/0/0/0`; descriptor discovery/admission/invocation and result handling remain externally blocked/unverified. The run did prove:

- `mcp-preferred` configuration does not fabricate page capability availability;
- unavailable page WebMCP safely falls back to semantic controls;
- model prose claiming WebMCP use cannot override authoritative terminal tool/interface evidence;
- fresh browser evidence alone grades;
- the acknowledged Solari session was confirmed released.

No production B code changed and visual fallback remains unavailable.

### D UI/lifecycle gate

D manually observed through the production UI:

- hydrated running state and live-update connection;
- queue-capacity rejection as bounded HTTP 409 with no second evaluation/run/event/session/provider-attempt artifacts;
- terminal hard reload restoring committed snapshot/report/trace/interface/cleanup state;
- redacted API/report/trace/event/SSE surfaces without provider IDs, credentials, CDP/WebSocket/replay capability URLs, or raw DOM;
- visible cancellation control while running;
- confirmed release and zero terminal leaks.

The accepted run completed before D could reload it while still running or activate cancellation. Running-state reload recovery and visible cancellation remain unobserved.

## Durable cancellation blocker

### Current accepted-cancel flow

1. `apps/web/src/routes/api/evaluations/$id/cancel.ts` awaits `TracegateServer.cancelEvaluation(...)`, then returns 202.
2. `apps/web/src/server/tracegate-server.ts` defines `EvaluationSubmissionScheduler.cancel?(evaluationId): boolean`.
3. `TracegateServer.cancelEvaluation(...)` durably reads `running`, then synchronously treats `scheduler.cancel(...) === true` as acceptance.
4. `apps/web/src/server/functional-runtime.ts` supplies `cancel: (evaluationId) => this.#queue.cancel(evaluationId)`.
5. A-owned `OneEvaluationQueue.cancel(...)` synchronously aborts only the active `AbortController` and returns true.
6. A-owned `FunctionalEvaluationExecutor.execute(...)` drains active run work and only afterward attempts durable `running → cancelling → cancelled`.

A process loss after steps 3–5 but before step 6 leaves a durable `running` evaluation even though the API already returned 202. Startup recovery currently converts a stranded running evaluation to failed; it cannot recover the lost user cancellation intent.

### Why A alone cannot close it

The repository transition is asynchronous. With D fixed to a synchronous boolean scheduler result, A can only:

- abort and return true before durability (current defect);
- start an unawaited write and return true (same defect);
- block the event loop/use unsafe synchronous persistence (rejected);
- mark every evaluation cancelling before a request exists (invalid lifecycle).

Shared schemas already contain `cancelling`/`cancelled`, and `EvaluationRepository.compareAndSetStatus(...)` already provides the needed durable CAS. No schema or grading change is missing.

### Minimal required D handoff

Both D changes must land atomically with the later A executor reconciliation:

1. `apps/web/src/server/tracegate-server.ts`
   - change scheduler cancellation to `cancel?(evaluationId): Promise<boolean>`;
   - `await` it;
   - return success only after resolved `true`; persistence rejection must not return 202.
2. `apps/web/src/server/functional-runtime.ts`
   - replace the direct queue delegate with an async adapter;
   - confirm active queue ownership;
   - await A executor durable cancellation admission using an internal bounded signal;
   - only after `running → cancelling` commits, synchronously deliver `queue.cancel(...)`;
   - resolve true based on durable acceptance, not merely abort delivery.

After that D handoff, A can concretely add `FunctionalEvaluationExecutor.requestCancellation(...)` and reconcile precommitted `cancelling` state with signal-driven cleanup and completion races. Before `cancelling → cancelled`, A must durably cancel every never-dispatched queued run without acquiring resources or grading, and require every dispatched run to return a trustworthy terminal record. Any run rejection, unconfirmed release, or failed durable run cancellation must prevent a clean cancelled evaluation and instead take the systemic-failure path without overwriting an unrelated terminal result. Cancelled runs will continue using `transactionallyCancel(...)`, with no grade fabricated; non-cancellation evidence failures remain INCONCLUSIVE under existing authority.

The proposed idempotence is internal to A's CAS/re-read reconciliation for `cancelling`/`cancelled` and terminal non-overwrite. It does not claim HTTP-level retry idempotency: D's current server pre-read admits only `running`, so a repeated request after the state changes still conflicts.

## Production-only verification

Commands ran from `examples/tracegate` with no automated test or provider session:

```bash
test ! -e /tmp/tracegate-f5-integration-blocker-20260902.db
mise exec -- node --version
mise exec -- pnpm --version
mise exec -- pnpm build
DATABASE_URL=file:/tmp/tracegate-f5-integration-blocker-20260902.db mise exec -- pnpm db:migrate
DATABASE_URL=file:/tmp/tracegate-f5-integration-blocker-20260902.db mise exec -- pnpm db:check
```

Results:

- Node `v26.1.0`, pnpm `12.0.0`;
- all 11 production workspaces built successfully; `@tracegate/e2e` was excluded;
- C's Agent and AI builds and D's web client/SSR build compiled in the integrated graph;
- migration `0000` applied to the previously absent DB;
- Drizzle check reported `Everything's fine`;
- Turbo retained the known warning that the Agent no-emit build declares no output files.

Safe terminal API validation used the existing terminal F4 temporary DB; starting it created no provider session:

```bash
DATABASE_URL=file:/tmp/tracegate-f4-talon-20260902-d754a61.db \
  TRACEGATE_PORT=3107 mise exec -- pnpm start
curl -X POST -H 'Origin: http://127.0.0.1:3107' \
  http://127.0.0.1:3107/api/evaluations/<redacted-completed-id>/cancel
curl -X POST -H 'Origin: http://127.0.0.1:3107' \
  http://127.0.0.1:3107/api/evaluations/00000000-0000-7000-8000-000000000000/cancel
```

Results:

- terminal cancellation returned HTTP `409` in `1.182433 s`: `conflict`, “Only a running evaluation can be cancelled.”;
- missing evaluation returned HTTP `404` in `0.018816 s`: `not_found`;
- DB cardinality remained one evaluation, three runs, three released sessions, unresolved sessions zero;
- Ctrl-C stopped the server; the pnpm wrapper's interruption exit was `1`.

## Readiness

The integrated production graph is build/migration clean, but it is **not ready for the final accepted-cancellation validation**. Required order:

1. D lands the awaited async cancellation scheduler/runtime adapter handoff.
2. A lands durable admission plus executor race reconciliation, terminalizes never-dispatched runs, and refuses clean cancellation when any dispatched run lacks trustworthy cleanup/terminalization.
3. Production build and safe static/manual re-gate.
4. One separately authorized live UI cancellation validates running-state reload, accepted 202 only after durable `cancelling`, per-run cleanup, terminal `cancelled` authority, no fabricated grades, confirmed releases, and zero leaks/nonterminal rows.

Until steps 1–2 land, F5 is open for the durable-intent blocker as well as running-state reload and visible UI cancellation. Replay, external page-WebMCP invocation, authenticated/external configured MCP, visual fallback, optional models, and broader recovery remain unsupported or unverified and must not be implied by F5 closure.
