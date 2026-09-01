# TraceGate agent ownership and integration rules

This file records the green TG-006 contract and architecture checkpoint. Paths are relative to `examples/tracegate/`.

## Frozen checkpoint

- Checkpoint: `TG-006`, 2026-09-01.
- `packages/shared` Zod v4 schemas and inferred TypeScript types are the authoritative cross-lane contract.
- Frozen shared Git tree: `3e20d4d03de31e9ef1caae34e655b8b3a13e4760`.
- Public consumers import only `@tracegate/shared` or `@tracegate/shared/testing`; they do not import another lane's concrete internals.
- After this checkpoint, only Agent A may edit `packages/shared`, TraceGate root workspace configuration, or `pnpm-lock.yaml`.
- TG-006 authorizes the planned Wave 1 fan-out under these ownership rules; it does not claim TG-007+ features are already implemented.

## Exclusive lanes

| Agent | Exclusive paths | Responsibilities |
|---|---|---|
| **A — integration/evaluation** | root configs and `AGENTS.md`, `packages/shared`, `packages/evaluation`, `packages/grading`, `tests/e2e`, `pnpm-lock.yaml`, checkpoint/final evidence | contracts, state/outcome semantics, evaluation runtime, deterministic grading, integration, evaluation tests, final lockfile |
| **B — Solari/target/discovery** | `packages/solari`, `packages/discovery`, `apps/demo`, `docs/evidence/solari-*.md` | connectivity, Demo Store, Solari lifecycle/CDP, semantic refs/discovery, cleanup and replay |
| **C — AI/agent runtime** | `packages/ai`, `packages/agent`, `docs/evidence/models.md` | TanStack/OpenRouter model capabilities, prompts, tools, budgets, event mapping, failure-analysis calls |
| **D — data/product UI** | `packages/db`, `packages/ui`, `apps/web`, `docs/evidence/persistence.md` | Drizzle/libSQL, repositories, TanStack Start API/SSE, snapshot projection and product UI |

Do not edit, rename, format, stage, or revert another lane's exclusive paths. Ask the owning lane to fix a concrete defect. Agent A may stage an owner's completed handoff unchanged at an integration checkpoint.

## Runtime and commands

Use the globally installed pnpm directly. Corepack is not required or used.

```bash
cd examples/tracegate
node --version                 # v26.1.0
pnpm --version                 # 12.0.0
pnpm install --frozen-lockfile
pnpm probe:runtime
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm --filter <workspace-name> <script>` for a lane-local check. A green package-local run does not replace checkpoint-wide verification.

## Current cross-lane interfaces

- Zod schemas are authoritative; exported TypeScript types are inferred from them.
- IDs, timestamps, cursors, JSON values, configuration, entities, actions/observations, discovery, grading, capabilities, API snapshots, events, safe errors, and lifecycle states come from `@tracegate/shared`.
- `EvaluationConfig` retains the server-only admin target. Public API snapshots and `AgentRunContext` use the public configuration and must not expose `adminBaseUrl`.
- The closed evaluation/run transition tables, lease guards, terminal failure mapping, and event vocabulary are fixed at this checkpoint.
- Persisted ordering uses `EventEnvelope.cursor`; run scope requires paired `runId` and `runSequence`.
- Runtime operations use the exported AbortSignal-aware ports. Cleanup receives a fresh bounded signal rather than a previously aborted run signal.
- Repository, log, and SSE boundaries use the shared redactor. Replay URLs, CDP endpoints, credentials, challenge tokens, and authorization values are never durable data.
- Canonical downstream fakes and fixtures come from `@tracegate/shared/testing`.

## Measured checkpoint capabilities

- Connectivity: Cloudflare Quick Tunnel over HTTPS is selected. Public and admin origins remain separate.
- Solari: at least five simultaneous Browser sessions were observed without a limit response; the safe cap is five, while the P0 requested default remains three. A future real `429` must reduce scheduling honestly.
- Recording/replay: recording was accepted and replay reached `ready`; presigned replay access was discarded after validation.
- Models: `deepseek/deepseek-v4-flash-0731` is the sole verified P0 model through pinned TanStack AI/OpenRouter. Mistral Small and GPT-5 Mini remain optional and unverified, and must not appear as verified.
- Persistence: local libSQL/Drizzle transactions, authoritative public snapshots, ordered milestone persistence, publish-after-commit process-local SSE, reconnect-by-refetch, and repository-boundary redaction are feasible.

## Contract-change discipline

After TG-006, a shared-contract change is exceptional and may land only through Agent A at an explicit integration checkpoint. The change must:

1. name every affected schema, event, port, and downstream lane;
2. describe compatibility and migration impact;
3. update canonical fixtures and focused negative tests;
4. pass the downstream compile consumer and the full workspace suite;
5. include a redaction review and synchronized rebase/acknowledgement from affected lanes.

Temporary concrete cross-lane imports, duplicate local contract types, and drive-by shared edits are rejected.

## Merge and lockfile discipline

- Each lane commits only its exclusive paths and reports exact commands, evidence, and redaction review.
- Agents do not independently stage, restore, or hand-edit `pnpm-lock.yaml`.
- After all intended manifests are present, Agent A runs pnpm `12.0.0`, regenerates the one authoritative lockfile, runs frozen install plus the full suite, and commits it with the checkpoint.
- Preserve exact external dependency pins; internal packages use `workspace:*` and resolve to local links in the lockfile.
- A red verification, secret-shaped persisted fixture, unmatched acknowledged browser session, fabricated capability result, or ownership violation blocks the next wave.
- Measured evidence is append-only in meaning: correct errors with an explicit note; never rewrite a result to improve the submission.

## TG-006 acknowledgement

The TG-002 through TG-005 lane deliverables and evidence compile against the frozen public surfaces at this checkpoint. Subsequent work in every lane is subject to this ownership map and these interfaces.
