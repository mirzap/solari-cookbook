# TG-006 — Contract and architecture freeze evidence

- **Recorded:** 2026-09-01 (Europe/Sarajevo)
- **Branch:** `tracegate-poc-submission`
- **Scope:** TG-006 only
- **Status:** **PASS**
- **Blocker:** none

## Gate reconciliation

| Gate | Evidence | Result incorporated at checkpoint |
|---|---|---|
| TG-001 | `runtime.md` | PASS: Node `26.1.0`, global pnpm `12.0.0` without Corepack, TypeScript `7.0.2`, Turbo `2.10.12`, and exact workspace pins |
| TG-002 | `solari-connectivity.md` | PASS: HTTPS Cloudflare Quick Tunnel selected; real Solari render/mutation/admin verification; six acknowledged and six released sessions; zero unaccounted |
| TG-003 | `models.md` | P0 PASS: DeepSeek verified through TanStack/OpenRouter; optional Mistral/GPT-5 Mini routes deliberately remain unverified |
| TG-004 | `packages/shared` fixtures/tests | PASS: closed variants, transitions, failures, events, ports, redaction, canonical fakes, and downstream compile consumer |
| TG-005 | `persistence.md` | PASS: durable libSQL/Drizzle graph and milestone writes, public snapshot, publish-after-commit SSE, reconnect/refetch, and persisted-byte redaction proof |

No result was upgraded by inference. Optional model routes remain unverified, the Solari concurrency observation is a lower bound rather than an exact entitlement, and the TG-005 surface remains a feasibility spike rather than TG-010.

## Frozen selections and capability facts

- `DemoConnectivityProvider`: Cloudflare Quick Tunnel using an ephemeral HTTPS `*.trycloudflare.com` origin; admin verification remains loopback-only.
- Solari measured capacity: at least `5` simultaneously held Browser sessions with no limit response. Safe application cap: `5`; P0 requested default remains `3`.
- Recording/replay: recording accepted; replay reached `ready` after release. No replay URL was persisted.
- P0 model: `deepseek/deepseek-v4-flash-0731`, verified through `@tanstack/ai@0.52.0` and `@tanstack/ai-openrouter@0.19.5`.
- Optional models: `mistralai/mistral-small-2603` and `openai/gpt-5-mini` are registered but unverified.
- Persistence selection: Drizzle `0.45.2` with libSQL client `0.17.4`; authoritative snapshot plus new persisted SSE milestones, with disconnect recovery by refetch and resubscribe.
- Shared-contract freeze: Git tree `3e20d4d03de31e9ef1caae34e655b8b3a13e4760`; public imports are `@tracegate/shared` and `@tracegate/shared/testing`.

## Authoritative lockfile

All current manifests were present before regeneration: workspace root, `apps/demo`, `apps/web`, `packages/ai`, `packages/db`, `packages/shared`, and `packages/solari`.

```text
Node:             v26.1.0
pnpm:             12.0.0 (global /Users/mirzap/Library/pnpm/bin/pnpm)
Corepack:         not used
lockfileVersion:  9.0
SHA-256:          72a30e004b034f4082b2132c578a15f56debf40ea08129338cef3840e18a8430
policy entries:   294
```

Regeneration changed only the new `apps/web` and `packages/db` importers plus peer-resolution annotations for the already-present AI importer. No direct dependency version drift occurred.

## Checkpoint commands and results

The tool shell used an explicit PATH only to expose the measured global installation:

```bash
export PATH="$HOME/.nvm/versions/node/v26.1.0/bin:$HOME/Library/pnpm/bin:$PATH"
node --version
pnpm --version
pnpm install --no-frozen-lockfile
pnpm install --frozen-lockfile
pnpm probe:runtime
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

```text
node:            v26.1.0
pnpm:            12.0.0
workspace scope: 7 projects including the root; 6 runnable packages
frozen install:  PASS; 294 policy entries; lockfile up to date
runtime probe:   PASS; TypeScript 7.0.2, Turbo 2.10.12, Drizzle Kit/ORM 0.31.10/0.45.2, Vite 8.2.2
lint:            6/6 tasks successful
typecheck:       6/6 tasks successful
test:            8/8 Turbo tasks successful
owned tests:     shared 17, AI 14, demo 3, Solari 4, web persistence/SSE 2; all passed
build:           6/6 tasks successful; web client 123 modules and SSR 134 modules transformed
```

The db package intentionally has no colocated test yet; the owned persistence integration proof is the passing `apps/web/test/persistence-sse.test.ts`. Turbo emitted cache-output warnings only; no command failed.

## Redaction and ownership audit

- Evidence contains no API key, authorization value, provider capability, session ID, CDP endpoint, replay URL, challenge token, private tunnel URL, or database auth token.
- The persistence test seeds a fake secret, verifies `[REDACTED]` in stored data/SSE, and scans the SQLite database/WAL bytes to prove the seed is absent.
- TG-002 accounts for all six acknowledged Solari Browser sessions with six confirmed releases.
- Agent B changes are confined to `apps/demo`, `packages/solari`, and Solari evidence.
- Agent C changes are confined to `packages/ai` and model evidence.
- Agent D handoff is confined to `packages/db`, `apps/web`, and persistence evidence; Agent A integrated it byte-for-byte.
- Agent A changes are confined to root governance/configuration, `packages/shared`, checkpoint evidence, and the sole lockfile.
- Ownership violations: **none**.

The repository scan covered 92 tracked/untracked non-ignored files. It found eight provider-shaped negative-test sentinels and five URL fixtures using reserved `.invalid`, `.example`, or `.test` hosts; all were verified in redaction/fail-closed tests. Suspicious non-fixture matches: `0`. The first conservative scan intentionally returned nonzero until those fixtures were inspected and explicitly classified.

## Blocking finding and verified correction

The first checkpoint review confirmed that `PersistenceSpikeServer.milestones`, `MilestoneBus.publish()`, and `publishCommittedForTest()` were public. `publish()` could serialize a supplied envelope without repository-boundary redaction, allowing a caller to bypass `TracegateDatabase.persistRunMilestone()`. Agent A stopped without staging or editing D-owned source.

Agent D corrected the boundary: the bus implementation is unexported and held in `PersistenceSpikeServer.#milestones`; the arbitrary publication/test bypass is absent; the runtime module surface exposes only the server and subscribe-only SSE helper; and the sole connected publication follows validated, redacted database commit. Two web tests pass, including explicit no-bypass surface checks and a durable-before-live query of the exact envelope. Agent A independently reran the focused D suite and full checkpoint suite without editing D-owned source.

## Freeze result

`AGENTS.md` records the four exclusive lanes, commands, frozen public interfaces, contract-change rules, merge discipline, and sole lockfile ownership. TG-002 through TG-005 deliverables compile against the frozen shared surfaces. The corrected D boundary and full checkpoint are green, so TG-006 authorizes the planned Wave 1 fan-out. This checkpoint did not begin TG-007 or any later task.
