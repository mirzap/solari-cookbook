# F1/F2 integration checkpoint

- Date: 2026-09-01
- Owner: Agent A (integration/evaluation)
- Branch: `tracegate-poc-submission`
- Status: **BLOCKED** — all compilation, build, database, implemented test, and audit checks pass, but the configured `@tracegate/ui` test suite discovers zero tests. This cannot be counted as a green checkpoint under the no-silent-skip requirement.
- F3: **not started and not claimed**. No composed Solari + DeepSeek run was executed by this checkpoint.

## Integrated history and ownership

Local `HEAD` was `2756d20bfdf1a9bf3eae09309c32391eaaf3699b`; `origin/tracegate-poc-submission` was `fdc7e7e6ceec97aa1d0d4bbd81629f7eebe42b5b` before this checkpoint.

The intended lane commits are linear ancestors of `HEAD`:

| Lane | Commit | Owned paths observed |
| --- | --- | --- |
| A | `04eb4e8` | `packages/evaluation`, `packages/grading`, `tests/e2e`, Agent-A evidence |
| C | `238d15c`, `fdc7e7e` | `packages/ai`, `packages/agent`, model/agent evidence |
| D | `66069ae` | `packages/db`, `packages/ui`, `apps/web`, persistence/UI evidence |
| B | `32bf0f2`, `2756d20` | `packages/solari`, `packages/discovery`, `apps/demo`, browser evidence |

`git show --name-only` inspection found no cross-lane ownership violations in these commits. Agent A did not modify B/C/D-owned source during integration.

## Runtime and authoritative lockfile

Measured runtime:

```text
node --version
v26.1.0

$HOME/Library/pnpm/bin/pnpm --version
12.0.0
```

Commands were run from `examples/tracegate` with `$HOME/.local/share/mise/installs/node/26.1.0/bin` prepended to `PATH` and the globally installed pnpm binary invoked directly (no Corepack).

```text
pnpm install --lockfile-only --no-frozen-lockfile
PASS — all 13 workspace projects; lockfile reconciled after all settled manifests.

pnpm install --frozen-lockfile
PASS — resolution skipped; supply-chain policy checked 294 entries.
```

Authoritative `pnpm-lock.yaml` SHA-256:

```text
82552bb68de614b45a93172cbb72224f2fc8cbdba392e435a0e76283a302a960
```

## Workspace verification

```text
pnpm lint
PASS — Turbo 12/12 packages.

pnpm typecheck
PASS — Turbo 12/12 packages.

pnpm build
PASS — Turbo 12/12 packages, including Vite client and SSR builds for apps/web.

pnpm test
PROCESS PASS — Turbo 18/18 tasks, 137 implemented tests passed and 0 failed.
CHECKPOINT BLOCKER — @tracegate/ui reported 0 tests.
```

Meaningful test counts reported by the workspace run:

| Workspace | Tests |
| --- | ---: |
| `@tracegate/shared` | 28 |
| `@tracegate/grading` | 9 |
| `@tracegate/evaluation` | 14 |
| `@tracegate/agent` | 15 |
| `@tracegate/ai` | 24 |
| `@tracegate/solari` | 22 |
| `@tracegate/discovery` | 10 |
| `@tracegate/db` | 2 |
| `@tracegate/web` | 7 |
| `@tracegate/demo` | 5 |
| `@tracegate/e2e` | 1 |
| `@tracegate/ui` | **0** |

Turbo's “no output files found” messages are cache-output configuration warnings, not test failures. They do not alter the zero-test UI blocker.

## Database verification

```text
pnpm --filter @tracegate/db db:generate
PASS — 10 tables; no schema changes.

DATABASE_URL='file:./tracegate.integration.db' pnpm --filter @tracegate/db db:migrate
PASS — migrations applied to the disposable integration database.

pnpm --filter @tracegate/db db:check
PASS — Drizzle reported “Everything's fine”.
```

The disposable `packages/db/tracegate.integration.db` was removed after verification and is not tracked.

## Local integration/e2e scripts

The root `test:integration` task initially completed only dependency builds and executed no test. Agent A corrected the owned `tests/e2e/package.json` wiring to execute the existing fake-port test explicitly.

```text
pnpm test:e2e:local
PASS — 1/1 fake-port end-to-end test.

pnpm test:integration
PASS after A-owned wiring — 1/1 fake-port integration test; 7 Turbo tasks.

pnpm verify
PROCESS PASS — Turbo 48/48 tasks.
CHECKPOINT BLOCKER — it re-executed the configured @tracegate/ui suite with 0 discovered tests.
```

No configured Agent-A integration suite is silently skipped after the wiring correction.

## Architecture and security audits

### Demo independence

Production source in `apps/web/src` and package `src` directories (excluding tests/testing fixtures) was scanned for `@tracegate/demo`, `apps/demo`, `DemoAdmin`, `DemoChallenge`, `CartGrade`, and `ChallengeId`.

Result: **PASS** — no production dependency on Demo Store. Demo remains fixture/test-only.

### Assertion non-flow

Production `packages/agent/src` and `packages/ai/src` (excluding tests) was scanned for assertion-only canaries and assertion fields.

Result: **PASS** — assertions and assertion-only canaries do not flow into the agent DTO/model execution path.

### SSE durability and privacy

Inspection of `apps/web/src/server/sse.ts` and `tracegate-server.ts` confirms:

- `PersistedMilestoneBus` is not exported;
- the bus and `#publishPersisted` are private fields/methods;
- mutation paths publish the canonical returned `EventEnvelope` only after their database transaction completes;
- no arbitrary/unpersisted public publish API is exposed;
- web tests covering durable-before-SSE publication, authoritative snapshot recovery, and absence of a bypass API pass.

Result: **PASS**.

### Secret and capability scans

- No tracked `.env*` files were found.
- Production source (excluding tests, fixtures, and probes) contains no literal provider-secret patterns.
- A repository-wide scan for real-looking `sk-live`, `sk-proj`, `AKIA`, and private-key material passed.
- Synthetic `sk-or-…` strings exist only in intentional redaction test fixtures; they are not credentials.
- Production source contains no persisted Solari capability fields such as connect/replay/CDP URLs.
- WebSocket capability literal scans in production passed.

Result: **PASS**.

## Blocker and required owner action

Concrete D-lane defect:

```text
@tracegate/ui > node --test
0 tests
```

Agent D must add at least one meaningful UI package test or intentionally replace/remove the configured empty suite in the D-owned manifest. Agent A reported this defect and did not edit D-owned files. After correction, rerun at minimum:

```text
pnpm test
pnpm verify
```

Only after that checkpoint is green should F3 composition begin. A real F3 claim additionally requires an actual composed Solari + verified DeepSeek/OpenRouter execution; it is not implied by this fake-port checkpoint.

## Agent-A checkpoint files

- `examples/tracegate/AGENTS.md`
- `examples/tracegate/pnpm-lock.yaml`
- `examples/tracegate/tests/e2e/package.json`
- `examples/tracegate/docs/evidence/f1-f2-integration-checkpoint.md`
