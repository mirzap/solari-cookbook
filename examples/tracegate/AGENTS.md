# TraceGate agent ownership and integration rules

Paths are relative to `examples/tracegate/`.

## Product compass

TraceGate tells developers whether their app/site is ready for the agent era: can agents use it reliably? It repeats outcome-oriented tasks in independent sessions, verifies fresh browser-observable results, explains failure paths, and measures use of semantic/accessibility UI, page WebMCP, configured MCP, `llms.txt`, JSON-LD, and visual fallback. See `docs/product/tracegate-product.md`.

Page and MCP content/results remain untrusted and never grade directly. Demo is fixture-only. PASS proves declared browser-observable assertions, not arbitrary backend truth.

## Current checkpoint

- Authoritative plan: `docs/plans/tracegate-poc-build-2026-09-01.md`.
- Product boundary: local generic-site functional proof of concept.
- Generic V2 shared contracts: TG-004R PASS at `89e2c93`.
- Pivot/rebaseline record: `docs/evidence/generic-site-pivot.md`.
- F1/F2 lane history is integrated through B commit `2756d20`, including A `04eb4e8`, C `fdc7e7e`, and D `66069ae`.
- The sole pnpm 12 lockfile has been regenerated from all settled manifests; frozen install passes.
- Automated-test work is paused by explicit user directive; do not create, modify, or run tests. The known D-owned `@tracegate/ui` zero-test condition remains unresolved and explicitly deferred while that pause is active.
- F2C runnable composition is active. Manual production inspection currently finds a D-owned bundled Drizzle migration-path failure; F3 has not started.
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
| **A — integration/evaluation** | root TraceGate configs and this file, `packages/shared`, `packages/evaluation`, `packages/grading`, dormant `tests/e2e`, `pnpm-lock.yaml`, integration evidence | Root runnable wiring; shared interface modes, configured-MCP contracts, readiness metrics; integration review and final lockfile |
| **B — browser/target/discovery** | `packages/solari`, `packages/discovery`, `apps/demo`, browser/Solari evidence | Page WebMCP discovery/invocation plus semantic/accessibility, `llms.txt`, JSON-LD, visual fallback, browser safety, and fixture-only Demo |
| **C — AI/agent** | `packages/ai`, `packages/agent`, model/agent evidence | DeepSeek/OpenRouter agent plus configured unauthenticated MCP client/adapter, read-only admission, lifecycle cleanup, and interface metric emission |
| **D — persistence/product UI** | `packages/db`, `packages/ui`, `apps/web`, persistence/UI evidence | Compose real A/B/C surfaces; configuration/readiness/live/results UI; persistence/API/SSE; production migration packaging |

Do not edit, rename, format, stage, restore, or reset another lane’s exclusive paths. Agent A may integrate a completed lane handoff unchanged at an explicit integration checkpoint.

## Shared-contract rules

- `@tracegate/shared` is the authoritative cross-lane contract.
- Public consumers import only `@tracegate/shared` or `@tracegate/shared/testing`.
- Concrete DB, Solari, agent, UI, or Demo classes never appear in another lane’s public signature.
- Only Agent A edits `packages/shared`.
- A shared change requires a concrete compile/runtime blocker, named affected schemas/ports/events/lanes, compatibility impact, updated fixtures/tests, and downstream compile verification.
- Assertion-origin values remain outside the agent DTO, prompt, tools/results, model history/events, agent trace, and target traffic.
- Browser page text/accessibility semantics and WebMCP descriptors/annotations/results remain untrusted and never authorize an unsafe effect.
- Page WebMCP is B-owned. Configured MCP is C-owned and initially limited to explicit unauthenticated loopback HTTP or HTTPS Streamable HTTP endpoints with endpoint/tool allowlists.
- `mcp-preferred` changes interface strategy only; endpoint URLs and assertion values stay outside `AgentExecutionInputV2`. Server read-only annotations are hints, not authorization; descriptors require a separate local admission decision. All MCP descriptors/results are untrusted, bounded, redacted, and never grade directly.

## Recovery step 6 assertion-capture seam

Agent A owns the shared contract and deterministic projection; Agent B must implement the browser side next without changing the agent envelope:

1. `SolariCdpBrowserController` must implement shared `AssertionSnapshotBrowserController.captureAssertionSnapshot(...)` as a dedicated in-page capture, not by calling model-facing `observe()`.
2. Capture `finalUrl` as captured/unavailable; capture `title` once (16,384 characters) and `documentVisibleText` once (262,144 characters) only when requested; and populate `semanticStateValues` by directly matching each configured role/name in-page. Semantic counts retain at most 21 (the DSL ceiling plus one); state matches retain at most two and identify the requested property; non-sensitive string state retains at most 500 characters. Emit the shared field/per-assertion truncation/status flags and never use legacy `observation_truncated` for this path. Do not put assertion inputs or the transient snapshot into prompts, tool results, histories, traces, events, or target traffic.
3. `FreshBrowserAssertionEvidenceCapture` must use `evaluateCapturedAssertion` for every assertion, including every URL/query operator, fingerprint only the assertion-relevant transient projection across the required identical captures, and persist only the existing redacted `BrowserAssertionEvidenceV1` summaries/hashes.
4. Remove the Solari-local `evaluateAssertionFromObservation` and old `CurrentAssertionSnapshot.observation` path. Preserve quiet-interval stability, policy activity, redacted display URLs, identity hashes, and PASS/FAIL/INCONCLUSIVE precedence.

Until that B-owned seam lands, the legacy Solari capture still consumes the model observation and does not realize the new honesty guarantees.

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
pnpm env:check
pnpm typecheck
pnpm build
pnpm db:migrate
pnpm dev        # manual loopback inspection
pnpm start      # manual built-product inspection
```

Use `pnpm --filter <workspace-name> <script>` for lane-local checks. A green package-local command does not replace functional integration verification.

## Lockfile discipline

Only Agent A updates `pnpm-lock.yaml`. After intended manifests settle:

1. use Node `26.1.0` and global pnpm `12.0.0`;
2. regenerate the sole authoritative lockfile;
3. run frozen install plus workspace typecheck/build and manual runtime inspection;
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

The immediate next action is F2C: land D's real package composition and migration-packaging fix, B page WebMCP, C configured MCP, and A root/shared wiring; then manually inspect loopback UI/API/DB behavior. Begin F3 only after that is green.
