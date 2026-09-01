# TraceGate agent ownership and integration rules

Paths are relative to `examples/tracegate/`.

## Current checkpoint

- Authoritative plan: `docs/plans/tracegate-poc-build-2026-09-01.md`.
- Product boundary: local generic-site functional proof of concept.
- Generic V2 shared contracts: TG-004R PASS at `89e2c93`.
- Pivot/rebaseline record: `docs/evidence/generic-site-pivot.md`.
- F1/F2 lane history is integrated through B commit `2756d20`, including A `04eb4e8`, C `fdc7e7e`, and D `66069ae`.
- The sole pnpm 12 lockfile has been regenerated from all settled manifests; frozen install passes.
- Compilation, DB, and implemented functional suites pass, but the D-owned `@tracegate/ui` configured test currently reports zero tests and must be corrected before the checkpoint is called fully green.
- F3 real Solari plus DeepSeek composition has not started and must not be inferred from fake-port or lane-local evidence.
- Demo Store is test-only and never a production target, composition, or grading dependency.
- PASS means declared browser-observable assertions passed from fresh evidence; it never claims arbitrary backend business truth.

## Short critical path

```text
TG-004R PASS
  → integrate quarantined lane WIP against V2 contracts
  → parallel DB/API/UI + browser + agent + evaluation/grading slices
  → one real Solari/DeepSeek run
  → repeated runs/report
  → functional verification
```

Deferred provider-grade egress enforcement, perfect DNS-rebinding prevention, forced proxying, and provider inventory reconciliation are documented limitations, not functional-app blockers.

## Exclusive lanes and immediate assignments

| Agent | Exclusive paths | Immediate assignment |
|---|---|---|
| **A — integration/evaluation** | root TraceGate configs and this file, `packages/shared`, `packages/evaluation`, `packages/grading`, `tests/e2e`, `pnpm-lock.yaml`, integration evidence | Integrate shared consumers; implement atomic submission, one-evaluation queue, executor, deterministic grading/precedence, aggregation, finally cleanup, end-to-end composition, and final lockfile |
| **B — browser/target/discovery** | `packages/solari`, `packages/discovery`, `apps/demo`, browser/Solari evidence | Rebase provider/controller/discovery WIP to V2; implement exact-origin and practical observable request/action guards, capability-gated read-only WebMCP adapter, fresh evidence capture, semantic fallback, fixture-only Demo, and one bounded real public-site safety smoke |
| **C — AI/agent** | `packages/ai`, `packages/agent`, model/agent evidence | Rebase adapter/runner WIP to V2; implement verified DeepSeek/OpenRouter, assertion-blind prompt layers, dynamic safe tools including only admitted sanitized read-only WebMCP calls, FIFO/current-revision checks, budgets/history/cancellation, and bounded event mapping |
| **D — persistence/product UI** | `packages/db`, `packages/ui`, `apps/web`, persistence/UI evidence | Rebase DB/API/UI WIP to V2; implement clean V2 Drizzle migration/repositories, loopback API, authoritative snapshot/SSE, configure/live/report UI, and separate agent trace/grading report |

Do not edit, rename, format, stage, restore, or reset another lane’s exclusive paths. Agent A may integrate a completed lane handoff unchanged at an explicit integration checkpoint.

## Shared-contract rules

- `@tracegate/shared` is the authoritative cross-lane contract.
- Public consumers import only `@tracegate/shared` or `@tracegate/shared/testing`.
- Concrete DB, Solari, agent, UI, or Demo classes never appear in another lane’s public signature.
- Only Agent A edits `packages/shared`.
- A shared change requires a concrete compile/runtime blocker, named affected schemas/ports/events/lanes, compatibility impact, updated fixtures/tests, and downstream compile verification.
- Assertion-origin values remain outside the agent DTO, prompt, tools/results, model history/events, agent trace, and target traffic.
- Browser page text/accessibility semantics and WebMCP descriptors/annotations/results remain untrusted and never authorize an unsafe effect.
- WebMCP is experimental and user-opt-in. Only sanitized current-origin tools that declare read-only behavior and pass local bounded-schema/effect admission may appear; declarations are hints, results never grade directly, and semantic browser controls remain the fallback.

## WIP quarantine and staging

- Review and retain reusable work in place; remove V1/Demo production assumptions during the owning lane’s rebase.
- Do not infer success from untracked or compiling files without running the lane checks.
- Stage with explicit owned paths only.
- Do not blanket reset, clean, format, or stage the repository.
- Do not stage `pnpm-lock.yaml` while concurrent manifests are changing.
- Each lane commits only its exclusive paths and reports commands, results, changed files, and blockers.

## Runtime and commands

Use the globally installed pnpm directly; Corepack is not required.

```bash
cd examples/tracegate
node --version                 # v26.1.0
pnpm --version                 # 12.0.0
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm --filter <workspace-name> <script>` for lane-local checks. A green package-local command does not replace functional integration verification.

## Lockfile discipline

Only Agent A updates `pnpm-lock.yaml`. After intended manifests settle:

1. use Node `26.1.0` and global pnpm `12.0.0`;
2. regenerate the sole authoritative lockfile;
3. run frozen install plus workspace typecheck/test/build;
4. commit the lockfile with the integration checkpoint.

## Practical safety and cleanup boundary

P0 uses structural HTTPS validation, exact origins, best-effort public DNS preflight, fresh anonymous sessions, service-worker blocking where supported, observable unsafe-request interception, and obvious unsafe-control blocking. Coverage gaps are limitations, not hidden claims.

A Solari create is attempted once. An ambiguous unacknowledged create becomes INCONCLUSIVE/potential-leak evidence and is not retried. Every acknowledged session ID must still receive controller close and provider release attempts in `finally`, with durable cleanup state.

## Non-fabrication

Never:

- present fixture/local output as a real Solari run;
- claim optional models are verified;
- claim whole-browser network confinement or perfect DNS-rebinding prevention;
- hard-code or splice PASS/FAIL results;
- rewrite measured evidence to improve a result;
- persist credentials, CDP/replay capability URLs, full DOM, or raw provider payloads.

The immediate next action is to correct the zero-test UI suite, rerun the integration checkpoint, and only then begin an explicitly credentialed F3 composed Solari plus DeepSeek run.
