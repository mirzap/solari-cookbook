# TG-005 persistence and SSE feasibility evidence

Date: 2026-09-01  
Lane: Agent D (`packages/db`, `apps/web`)  
Scope: TG-005 only; this is not the broad TG-010 API/UI.

## Result

**PASS.** The spike proved:

1. local `file:` libSQL boot with foreign keys, WAL, and a 5-second busy timeout;
2. Drizzle transactions that durably create an evaluation, run, and initial events;
3. atomic compare-and-set run status + ordered run-step + ordered event persistence behind one process-local writer queue;
4. a frozen-contract `EvaluationSnapshot` read from SQLite with the latest authoritative event cursor;
5. publish-after-commit process-local pub/sub and bounded Fetch/SSE delivery;
6. disconnect recovery by refetching a fresh snapshot, followed by a new SSE subscription;
7. repository-boundary redaction and absence of a seeded fake secret in the SQLite database/WAL bytes.

No credentials, provider sessions, CDP endpoints, replay URLs, or real challenge tokens were used or persisted.

## Versions exercised

- Node.js `v26.1.0`
- TypeScript `7.0.2`
- `@libsql/client` `0.17.4`
- `drizzle-orm` `0.45.2`
- `@tanstack/react-start` `1.168.49`
- Vite `8.2.2`
- lockfile SHA-256: `c4b24304eca44c87145d82c2b57595f0d5fed7460c5d8337ee4e214e90ff356e`

The available global pnpm was `11.24.0`, while the workspace requires pnpm `12.0.0`. No dependency was downloaded. A local install attempt was rejected for that engine mismatch, and the TanStack build refreshed importer metadata while discovering the two new workspace manifests; both changes were discarded by restoring the checked-in lockfile byte-for-byte. Final verification with `git diff --exit-code -- examples/tracegate/pnpm-lock.yaml` exited `0`. Workspace links used for this isolated lane validation were untracked `node_modules` links only; Agent A remains the lockfile owner.

## Automated proof

Test: `apps/web/test/persistence-sse.test.ts`

Observed durable sequence:

| Phase | Snapshot/event observation |
|---|---|
| durable create | `evaluation.created` cursor `1`, `run.queued` cursor `2` |
| initial snapshot | run `queued`, `latestCursor = "2"` |
| first live connection | committed `queued -> acquiring_browser` milestone delivered at cursor `3` |
| disconnected write | committed `acquiring_browser -> connecting_browser` milestone at cursor `4` with no subscriber |
| authoritative refetch | run `connecting_browser`, `latestCursor = "4"` |
| reconnect | committed `connecting_browser -> discovering` milestone delivered at cursor `5` |
| ordered reads | run-step sequences `[1, 2, 3]`; events after cursor `2` are `[3, 4, 5]` |

The snapshot response is parsed by the frozen `EvaluationSnapshotSchema`; its public target omits `adminBaseUrl`. The test seeds `solari_test_secret_123456789` under an `authorization` payload key, verifies the stored step contains `[REDACTED]`, verifies the SSE frame omits the secret, checkpoints/closes SQLite, then scans the database/WAL files and confirms the secret bytes do not exist.

SSE defaults are a 15-second heartbeat, `Cache-Control: no-cache, no-transform`, abort/cancel subscription disposal, and a 64 KiB serialized frame limit. The production bus is an unexported implementation held in an ECMAScript private field. Its publisher is unreachable to ordinary callers; the exported SSE helper accepts only a subscribe-only source. The sole production publication call follows successful `TracegateDatabase.persistRunMilestone()` completion, so the envelope has already passed shared-schema validation, repository-boundary redaction, and commit.

## Commands and results

Successful lane validation (all exit `0`):

```bash
PATH='/Users/mirzap/.local/share/mise/installs/node/26.1.0/bin:/usr/bin:/bin' \
  examples/tracegate/node_modules/.bin/tsc \
  -p examples/tracegate/packages/db/tsconfig.json --noEmit

PATH='/Users/mirzap/.local/share/mise/installs/node/26.1.0/bin:/usr/bin:/bin' \
  examples/tracegate/node_modules/.bin/tsc \
  -p examples/tracegate/packages/db/tsconfig.build.json

PATH='/Users/mirzap/.local/share/mise/installs/node/26.1.0/bin:/usr/bin:/bin' \
  examples/tracegate/node_modules/.bin/tsc \
  -p examples/tracegate/apps/web/tsconfig.json --noEmit

cd examples/tracegate/apps/web
PATH='/Users/mirzap/.local/share/mise/installs/node/26.1.0/bin:/usr/bin:/bin' \
  /Users/mirzap/.local/share/mise/installs/node/26.1.0/bin/node \
  --test test/*.test.ts
# 2 tests, 2 pass, 0 fail

PATH='/Users/mirzap/.local/share/mise/installs/node/26.1.0/bin:/usr/bin:/bin' \
  ../../node_modules/.bin/vite build
# client and SSR builds completed successfully
```

## Deliberate TG-005 limits

- The pub/sub bus is process-local and intentionally has no durable arbitrary-cursor replay.
- The client protocol is snapshot first, then new SSE events. Query/subscribe race elimination, retained catch-up, cursor expiry, pruning, and slow-consumer policy remain post-submission work exactly as planned.
- The Start surface contains only the snapshot route, SSE route, composition seam, and a minimal proof page. Evaluation creation, scheduling, complete product UI, report UI, health/capabilities, and replay access belong to TG-010 or later.
- This spike migration covers only the tables required to prove evaluation/run/step/event feasibility. The full TG-010 schema and Drizzle Kit migration journal remain future lane work.

## TG-006 blocking-audit correction

The TG-006 audit correctly identified that the original spike exported `MilestoneBus.publish`, exposed the bus on `PersistenceSpikeServer.milestones`, and retained `publishCommittedForTest`. Those paths could emit an arbitrary `EventEnvelope` without persistence and have been removed.

Correction proof:

- `PersistedMilestoneBus` is not exported and is stored in `PersistenceSpikeServer.#milestones`.
- `PersistenceSpikeServer` exposes only `persistMilestone`, snapshot/SSE reads, and the narrow read-only `subscriberCount` test seam.
- Runtime surface tests assert that neither server module nor instance exposes `publish`, `publishCommittedForTest`, or `milestones`; the SSE module exports only `createMilestoneSseResponse` at runtime.
- The integration test queries SQLite after `persistMilestone()` and before reading SSE, proving the exact live envelope already exists durably.
- The existing redaction, disconnect/refetch, and reconnect-at-next-cursor checks remain green.

Correction validation on 2026-09-01:

```bash
pnpm --dir examples/tracegate --filter @tracegate/db typecheck
pnpm --dir examples/tracegate --filter @tracegate/db build
pnpm --dir examples/tracegate --filter @tracegate/web typecheck
pnpm --dir examples/tracegate --filter @tracegate/web test
pnpm --dir examples/tracegate --filter @tracegate/web build
```

All commands exited `0`. Web tests reported `2` passed and `0` failed. The TanStack Start client and SSR production builds both completed successfully.

The lockfile was already modified by concurrent integration work before the correction build. Its SHA-256 was `72a30e004b034f4082b2132c578a15f56debf40ea08129338cef3840e18a8430` both immediately before and after the build, proving this correction did not alter it. Agent D did not restore or edit that concurrent state.

No shared contract change was required.
