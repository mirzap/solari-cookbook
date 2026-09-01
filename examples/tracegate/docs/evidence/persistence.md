# F1 / F2 Agent D persistence, API, SSE, and UI evidence

Date: 2026-09-01

Lane: Agent D (`packages/db`, `packages/ui`, `apps/web`)

Plan baseline: functional-app plan commit `a696651`, frozen TG-004R public contracts

Scope: F1 reconciliation followed by Agent D's F2 slice only. No F3 runtime composition is claimed.

## Result

**PASS for the D-owned F2 slice.** The lane now provides:

1. one clean generated V2 Drizzle migration, `packages/db/drizzle/0000_dark_layla_miller.sql`, for ten tables: evaluations, runs, run steps, events, assertion evidence, grades, browser cleanup state, provider-create cleanup attempts, discovered interfaces, and capability checks;
2. durable canonical evaluation configuration columns (target URL, exact origins, prompt, assertions, full bounded config) plus a SHA-256 specification hash;
3. frozen-port adapters for evaluation submission, evaluation/run transitions, events, browser sessions, and provider-create attempts, plus D-local evidence, grade, cleanup, capability, and report repositories;
4. atomic evaluation/run/queued-event creation, atomic transition/event writes, ordered run-step/event milestones, and finalization that refuses a grade unless matching canonical assertion evidence is already committed;
5. authoritative snapshot, bounded historical report, assertion-blind agent trace, event-page, cleanup, evidence, and grade queries;
6. TanStack Start health, capabilities, loopback-only create, snapshot, report, trace, and events routes;
7. the events route as either bounded no-store JSON pagination or process-local SSE, selected by `Accept`;
8. a private subscribe-only SSE publication boundary: only repository-returned, schema-validated/redacted `EventEnvelope` values publish, and only after commit resolves;
9. subscribe-first client recovery: establish SSE, fetch a fresh authoritative snapshot, buffer concurrent committed milestones, refetch after live events, and repeat that handshake after reconnect;
10. functional configure/live/report UI for public HTTPS URL, exact origins, prompt, URL/text/semantic/state assertions, one-to-three verified models, runs, concurrency, optional recording, and opt-in read-only WebMCP;
11. distinct assertion-blind agent trace and deterministic grading report panels, plus persisted generic execution-environment evidence, cleanup state, privacy notes, and practical safety limitations.

The D lane does not schedule evaluations or invoke the sibling evaluation, Solari/discovery, AI, or agent implementations. That wiring is F3 composition and remains intentionally absent.

## Migration and persistence boundary

`0000_dark_layla_miller.sql` was regenerated from the reconciled V2 schema rather than layered over the disposable TG-005 spike. It is intended for a recreated local libSQL database; there is no V1 reader, conversion, or dual-write path.

Important durable rules:

- evaluation/run identity and ordering have unique indexes;
- event IDs and per-run sequences are unique; evaluation cursor reads are indexed;
- canonical assertion evidence contains only redacted display URL, document/loader hashes, bounded assertion observations, policy counts/codes, and the evidence hash;
- transient canonical URLs, raw DOM, raw model/provider bodies, credentials, CDP/replay URLs, and secret-bearing connection data have no persistence column;
- grades are linked to the committed evidence hash;
- cleanup queries combine durable run leak flags, browser release confirmation, and unresolved provider-create attempts;
- report history is anchored to the authoritative snapshot cursor and fails rather than silently exceeding the 10,000-event bound.

Repository-boundary redaction is configured with known server secrets and bounded JSON limits. Tests place a fake known secret in a run-step payload and verify `[REDACTED]`; secret-bearing canonical evidence is rejected because mutating hash-covered content would invalidate its evidence hash. The same tests verify absence from SSE and from SQLite/WAL bytes after checkpoint and close.

## API and privacy boundary

| Route | Responsibility |
|---|---|
| `GET /api/health` | no-store dependency health |
| `GET /api/capabilities` | database plus persisted model/Solari/WebMCP capability checks and blockers |
| `POST /api/evaluations` | loopback Host/Origin policy, frozen V2 request parsing, capability gate, atomic evaluation/run/queued-event creation |
| `GET /api/evaluations/:id` | authoritative bounded V2 snapshot |
| `GET /api/evaluations/:id/report` | deterministic assertion/grade report projection |
| `GET /api/evaluations/:id/trace?cursor=` | bounded, paginated assertion-blind agent-event projection |
| `GET /api/evaluations/:id/events?cursor=` with `Accept: application/json` | bounded committed event page |
| `GET /api/evaluations/:id/events` with SSE accept | process-local committed-event notification stream |

The report removes URL query/fragment data from its display URL. The agent trace accepts only the frozen `AgentTraceEventSchema`; assertion definitions, observations, and grades cannot enter that projection. Environment evidence is displayed separately from the agent trace and contains only the frozen generic run-environment fields. Browser/provider credentials remain server-only.

`PersistedMilestoneBus` is unexported, stored in a private field, and exposes no public publication seam. The exported SSE helper receives only a subscribe-capable source. `subscriberCount()` is the sole narrow read-only test seam. A process restart loses notifications, not truth: refresh/refetch/reconnect always recovers from the libSQL snapshot and cursor.

## UI safety and limitations shown to the user

- anonymous public HTTPS sites only;
- exact one-to-three allowed origins, including the start origin;
- no signed URLs, tokens, credentials, personal data, purchases, messages, uploads/downloads, or destructive tasks;
- structural URL checks, public-DNS preflight, request/action guards, and exact-origin enforcement are practical controls, not perfect whole-browser egress or DNS-rebinding prevention;
- unstable/incomplete evidence yields `INCONCLUSIVE` rather than guessed truth;
- `PASS` proves only the declared fresh browser-observable assertions.

No production UI, API, schema, or repository depends on Demo Store, admin routes, cart state, or demo-connectivity packages. Test fixtures may still use reserved fixture domains through `@tracegate/shared/testing`.

## Automated proof

Tests:

- `packages/db/test/database.test.ts`: clean migration, config hash, pre-hash evidence redaction enforcement, evidence-before-grade enforcement, full discovered-interface redaction, durable grade/cleanup/report reads, and no fake-secret bytes;
- `apps/web/test/persistence-sse.test.ts`: no public arbitrary-publish surface, commit-before-live delivery, redacted SSE, subscriber disposal, and authoritative snapshot recovery;
- `apps/web/test/tg010-flow.test.ts`: capability-gated generic V2 creation, frozen repositories, ordered persisted events, trace/report assertion separation, typed projection, close/reopen recovery;
- `apps/web/test/ui-flow.test.ts`: generic configure request building for all assertion kinds, unsafe target rejection, multi-model/runs/concurrency projection, and snapshot/live projection recovery.

## Commands and observed results

All commands used Node `v26.1.0` and installed workspace dependencies. No install command or lockfile generation was run.

```bash
cd examples/tracegate/packages/db
$HOME/.local/share/mise/installs/node/latest/bin/node ../../node_modules/drizzle-kit/bin.cjs generate --config drizzle.config.ts
# 10 tables; generated drizzle/0000_dark_layla_miller.sql

$HOME/.local/share/mise/installs/node/latest/bin/node ../../node_modules/drizzle-kit/bin.cjs check --config drizzle.config.ts
# Everything's fine; exit 0

$HOME/.local/share/mise/installs/node/latest/bin/node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
$HOME/.local/share/mise/installs/node/latest/bin/node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
$HOME/.local/share/mise/installs/node/latest/bin/node --test
# 2 tests, 2 pass, 0 fail

cd ../ui
$HOME/.local/share/mise/installs/node/latest/bin/node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
$HOME/.local/share/mise/installs/node/latest/bin/node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
# exit 0; no diagnostics

cd ../../apps/web
$HOME/.local/share/mise/installs/node/latest/bin/node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
$HOME/.local/share/mise/installs/node/latest/bin/node --test test/*.test.ts
# 7 tests, 7 pass, 0 fail

$HOME/.local/share/mise/installs/node/latest/bin/node ../../node_modules/vite/bin/vite.js build
# client: 248 modules; SSR: 155 modules; both builds passed
```

The first direct Node test attempt exposed Node's strip-only limitation for TypeScript parameter properties. D-owned constructors were rewritten as ordinary fields/assignments; the rerun above is green.

## Honest cut line

- This is F2 infrastructure and product UI, not F3 composition; queued runs require the sibling scheduler/runtime to execute.
- SSE fan-out is process-local and notification-only; durable cross-process replay/backplanes remain post-submission work.
- There is no cancellation mutation, replay viewer, full design-system polish, or TG-011 surface.
- No frozen shared contract change was required.
- The concurrently A-owned `pnpm-lock.yaml` was already dirty and was not edited or regenerated by this lane.
