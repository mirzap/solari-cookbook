# Agent B F5 page-WebMCP capability gate — 2026-09-02

## Decision

**BLOCKED for verified page-WebMCP invocation.** One bounded, production-built, fresh-database evaluation used the existing generic `apps/demo` capability fixture through two ephemeral public HTTPS origins and one real acknowledged Solari Browser session. The managed browser reported page WebMCP unavailable, so no descriptor was discovered or admitted and no page WebMCP invocation occurred. The runtime safely used semantic controls, navigated to the second admitted origin, captured fresh browser evidence, graded only that evidence, and provider-confirmed release of the acknowledged session.

This is fixture-backed validation of unavailable-capability semantic fallback, supplemented by static adapter review only. It is not a generic-site product result, reliability claim, production target dependency, or proof of WebMCP invocation. The page-WebMCP completion claim must remain **implemented but unverified** until a browser exposing the current `document.modelContext` API completes one admitted call.

## Scope and controls

- Existing production-built `@tracegate/demo` job-board handler only; no target-specific production branch or fixture coupling was added.
- Two distinct ephemeral `https://*.trycloudflare.com` origins exposed the same loopback fixture. Capability URLs were retained only in temporary process files, omitted here, and truncated after shutdown.
- Start page: fixture `/jobs`, whose existing inline code conditionally registers `search_jobs` only when `document.modelContext.registerTool` exists.
- Final page: fixture `/unsafe-controls` on the second allowed origin. That page has semantic content but no WebMCP descriptor. The instruction required heading inspection only and no control interaction.
- Evaluation: `mcp-preferred`, `webMcpReadOnlyEnabled: true`, one model, one run, concurrency one, recording off, two allowed exact origins.
- Exactly one evaluation POST was accepted (`202`). The fresh DB contained one provider-create-attempt row and one acknowledged browser-session row. No create retry, second evaluation, replay, or recording request was made.
- The inline Node host command only wired `apps/demo/dist`'s existing `handleJobBoardFixture` to loopback HTTP. It did not inject a browser API, tool descriptor, browser script, selector, or result.
- Automated tests and test files were not created, modified, compiled as evidence, or run.

## Production and fresh-DB commands

The installed Node/pnpm toolchain was placed on `PATH`; credentials were checked only as set/unset booleans.

```bash
node --version
pnpm --version
/opt/homebrew/bin/cloudflared --version
# SOLARI_API_KEY=set-in-env-file; OPENROUTER_API_KEY=set-in-env-file

test ! -e /tmp/tracegate-f5-page-webmcp-20260902.db
pnpm build
DATABASE_URL=file:/tmp/tracegate-f5-page-webmcp-20260902.db pnpm db:migrate
DATABASE_URL=file:/tmp/tracegate-f5-page-webmcp-20260902.db pnpm db:check
```

Results:

- Node `v26.1.0`, pnpm `12.0.0`, cloudflared `2026.8.3`;
- all 11 production workspaces built successfully; the e2e workspace was not included;
- migration `0000` applied to a previously absent database path;
- Drizzle check returned `Everything's fine`.

A bounded inline Node host started the already-built demo handler on loopback. Two Cloudflare Quick Tunnels were started with output redirected to temporary logs. Both public readiness reads returned HTTP `200`, and the origins were distinct. The production server then started on loopback against the fresh DB. Preflight reported database and WebMCP adapter healthy, with model/Solari pending before live use and no blocker codes.

One request file was assembled under `/tmp` and submitted once to the production API. Read-only polling fetched terminal snapshot, report, trace, and events. SQLite inspection used count/boolean queries and did not copy provider session identifiers.

## Runtime evidence

### Discovery and fallback

`run.discovery.completed` at cursor `8` recorded:

- observation revision `1`;
- `15` semantic controls;
- `llms.txt` available, bounded, and explicitly `agentAccess: discovery_only`, `contentProvidedToAgent: false`;
- no JSON-LD types;
- `webMcpGate: unavailable`;
- progressive-semantic metadata with bounded direct-handle/rebind/ambiguous/exhausted and observation-recovery counters, all zero for this run;
- no discovery warnings.

The final interface tuple was:

```text
semantic_ui:   discovered/admitted/invoked/succeeded/failed = 1/1/3/3/0
page_webmcp:   discovered/admitted/invoked/succeeded/failed = 0/0/0/0/0
llms_txt:      discovered/admitted/invoked/succeeded/failed = 1/0/0/0/0
json_ld:       discovered/admitted/invoked/succeeded/failed = 0/0/0/0/0
visual:        discovered/admitted/invoked/succeeded/failed = 0/0/0/0/0
```

The dispatched semantic completions were `type`, `select`, and `click`. One stale `select` proposal was truthfully `rejected_before_dispatch` with the closed `stale_element_exhausted / tool_error / pre_dispatch_validation` failure; the subsequent `select` succeeded. A separate dispatched `navigate` changed to the second exact allowed origin. No unsafe control was activated.

This proves safe semantic fallback when page WebMCP is unavailable. It does **not** prove malformed/unsafe descriptor rejection by runtime observation; those paths remain only statically implemented.

### Agent belief versus authority

The model's final bounded summary claimed that it had used the read-only page capability. That claim was false. The authoritative terminal events contain no `invokeWebMcpReadOnly` start or completion, and both snapshot/report record page WebMCP `0/0/0/0/0`.

The false summary did not grade. `run.evidence.captured` at cursor `42` recorded two fresh capture attempts and zero unverifiable assertions. `run.grade.completed` at cursor `44` passed only the independently captured final exact origin/path and the assertion-specific `Unsafe controls` heading count. The evaluation's assertion-only result was PASS, but the page-WebMCP capability gate remained blocked.

### Origin change and rediscovery

The dispatched navigation to the second allowed exact origin and fresh final-origin evidence were observed. However, the durable event stream contains only the initial discovery event. The current composed runtime does not persist a second full discovery generation after navigation, so this run cannot prove current-origin descriptor rediscovery from durable evidence. No claim is made that rediscovery was observed.

### Cleanup

Terminal events were contiguous through cursor `48` and included:

- cursor `46`: `run.release.status_changed`, `releasing -> released`, `confirmed: true`;
- cursor `47`: `run.passed` for the independent assertions;
- cursor `48`: `evaluation.completed`, requested/completed/passed `1/1/1`, potential leaks `0`.

Final identifier-suppressing DB audit:

```text
evaluations:                    1
runs:                           1
browser sessions:               1
unresolved browser sessions:    0
unresolved provider attempts:   0
potential-leak runs:            0
nonterminal runs:               0
secret-marker event rows:       0
```

After terminal state, the production server, both tunnels, and the loopback fixture were stopped. Both loopback listeners were confirmed down. Temporary tunnel logs, origin file, request, and creation response were truncated. A final DB audit again returned zero unresolved sessions/attempts, potential leaks, and nonterminal runs.

## Static B-lane review

The production B implementation remains fail-closed and generic:

- discovery reads only `document.modelContext` on the current guarded page;
- `SolariWebMcpReadOnlyAdapter` requires exact current origin before and after discovery;
- admission requires `annotations.readOnlyHint === true` and a closed, bounded primitive object input schema;
- the adapter stores only the sanitized current-controller catalog;
- invocation re-discovers immediately, requires descriptor/raw-schema equality, validates closed input, invokes through the guarded page, rejects an origin change, and bounds/redacts the returned value as untrusted;
- absence/failure yields no WebMCP tool surface, leaving semantic controls available;
- WebMCP results do not enter fresh evidence or deterministic grading.

The fixture follows the current WebMCP shape (`document.modelContext.registerTool`), conditionally registers only on browser support, declares the tool read-only, and supplies a closed schema. The observed `unavailable` gate is therefore an environment/capability limitation, not evidence of a B-owned production defect. No B production code was changed.

## Exact capability disposition

Proven by this bounded real session:

- explicit opt-in and MCP-preferred configuration persisted;
- exact two-origin admission and dispatched origin change;
- unavailable page-WebMCP degrades to bounded semantic interaction;
- passive model prose cannot override authoritative tool/interface evidence;
- fresh browser evidence is the only grading authority;
- `llms.txt` remains discovery-only and is not admitted/invoked;
- one acknowledged Solari session was provider-confirmed released, with zero unresolved/leak/nonterminal records.

Not proven and still blocking a verified page-WebMCP claim:

- current-origin descriptor discovery in the managed browser;
- runtime descriptor sanitization/read-only admission against an observed descriptor;
- one actual page WebMCP invocation;
- bounded/redacted untrusted WebMCP result handling by live observation;
- malformed or unsafe descriptor rejection by live observation;
- durable evidence of rediscovery after the admitted origin change.

No fake WebMCP or visual path was introduced. Visual fallback remains unimplemented and must stay outside primary product claims.
