# TraceGate agent ownership and integration rules

This file records ownership and integration rules. The green TG-006 checkpoint is historical; the approved generic-site V2 pivot plan is now authoritative, but no V2 implementation contract is frozen until TG-006R passes. Paths are relative to `examples/tracegate/`.

## Historical checkpoint and V2 rebaseline

- Historical base checkpoint: `TG-006`, 2026-09-01.
- Historical exceptional shared-contract checkpoint: TG-007 impact note `docs/evidence/tg-007-shared-contract-impact.md`, 2026-09-01.
- Historical shared Git tree: `63cb741672f75f39884788c2fd59fb0f58185591`.
- Approved V2 source plan: `docs/plans/tracegate-poc-build-2026-09-01.md`.
- Pivot decision/quarantine record: `docs/evidence/generic-site-pivot.md`.
- V1 Demo target/grading contracts are superseded for V2 production use. They remain historical/fixture contracts until TG-004R replaces public surfaces.
- Assigned TG-002R/TG-004R/TG-005R rebaseline work may selectively stage only its owned gate paths. No Wave 1 production implementation may resume and no agent may claim a V2 freeze until TG-006R is green.
- After TG-006R, `packages/shared` Zod v4 schemas and inferred TypeScript types are again the authoritative cross-lane contract.
- Public consumers import only `@tracegate/shared` or `@tracegate/shared/testing`; they do not import another lane's concrete internals.
- After this checkpoint, only Agent A may edit `packages/shared`, TraceGate root workspace configuration, or `pnpm-lock.yaml`.
- TG-006 historically authorized V1 fan-out. The pivot revokes that authorization for V2; only TG-006R may authorize the revised Wave 1.

## Exclusive lanes

| Agent | Exclusive paths | Responsibilities |
|---|---|---|
| **A — integration/evaluation** | root configs and `AGENTS.md`, `packages/shared`, `packages/evaluation`, `packages/grading`, `tests/e2e`, `pnpm-lock.yaml`, checkpoint/final evidence | V2 contracts, assertion/outcome semantics, evaluation runtime, deterministic grading, integration, final lockfile |
| **B — browser/target/discovery** | `packages/solari`, `packages/discovery`, `apps/demo`, target/Solari evidence | public-network admission and runtime egress/effect safety, Solari lifecycle/CDP, stable evidence capture, semantic refs/discovery, fixture-only Demo, cleanup/replay |
| **C — AI/agent runtime** | `packages/ai`, `packages/agent`, model/tool-confinement evidence | TanStack/OpenRouter capability, assertion-blind prompts, safe tools, budgets, history, cancellation and event mapping |
| **D — data/product UI** | `packages/db`, `packages/ui`, `apps/web`, persistence/UI evidence | V2 migration/repositories, API/SSE, snapshots, generic target/assertion UX and reports |

Do not edit, rename, format, stage, or revert another lane's exclusive paths. Ask the owning lane to fix a concrete defect. Agent A may stage an owner's completed handoff unchanged at an integration checkpoint.

## Pivot WIP quarantine

- Current dirty B/C/D source and the interrupted A shared checkpoint remain unstaged and unintegrated.
- Explicitly assigned rebaseline gates may selectively stage only their owned reviewed paths; all unrelated dirty paths remain quarantined.
- Do not blanket-reset, stage, format, or commit unrelated quarantined work.
- Do not stage `pnpm-lock.yaml` while concurrent manifests are changing.
- Preserve reusable infrastructure, but production Demo administration/cart grading, assertion exposure to the model, raw controller access from the agent, and generic native-tool invocation are superseded.
- Demo Store is a test fixture only and never a V2 production target or grader dependency.
- PASS means declared browser-observable assertions passed from fresh stable evidence; it never claims arbitrary backend business truth.

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

## Cross-lane interface status

### Historical V1 surface

- The current committed shared tree remains the historical V1 authority for evidence/rebase purposes only.
- Its server-only Demo admin target, Demo grading, fixed terminal mapping, and event vocabulary are superseded for V2 production and must not guide new implementation.

### V2 rules pending TG-004R/TG-006R

- Zod schemas and inferred TypeScript types will be authoritative after TG-006R.
- IDs, cursors, lifecycle/lease guards, persisted ordering, AbortSignal-aware ports, cleanup with a fresh bounded signal, central redaction, and canonical fakes remain architectural invariants.
- V2 replaces Demo target/grading with admitted public HTTPS targets, assertion-blind agent context, trusted fresh evidence, generic assertion results, and revised policy/outcome events.
- Public consumers import only `@tracegate/shared` or `@tracegate/shared/testing`; concrete cross-lane types remain forbidden.

## Measured checkpoint capabilities

- Historical connectivity: Cloudflare Quick Tunnel over HTTPS was selected for the V1 fixture; public/admin separation remains historical fixture evidence, not a V2 production dependency.
- Solari: at least five simultaneous Browser sessions were observed without a limit response; the safe cap is five, while the P0 requested default remains three. A future real `429` must reduce scheduling honestly.
- Recording/replay: recording was accepted and replay reached `ready`; presigned replay access was discarded after validation.
- Models: `deepseek/deepseek-v4-flash-0731` is the sole verified P0 model through pinned TanStack AI/OpenRouter. Mistral Small and GPT-5 Mini remain optional and unverified, and must not appear as verified.
- Persistence: local libSQL/Drizzle transactions, authoritative public snapshots, ordered milestone persistence, publish-after-commit process-local SSE, reconnect-by-refetch, and repository-boundary redaction are feasible.

## Contract-change discipline

TG-004R replaces the V1 target/grading production contracts and TG-006R freezes V2. Shared changes may land only through Agent A at explicit impact checkpoints. The change must:

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

## Historical acknowledgement and V2 stop rule

TG-002 through TG-005 evidence remains truthful for the historical V1 checkpoint. It does not prove generic-site runtime safety or V2 evidence privacy. Until TG-006R, the current shared tree is historical rather than V2 production authority, and all implementation lanes remain stopped except for explicitly assigned rebaseline gates.
