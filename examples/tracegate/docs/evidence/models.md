# TG-003 — TanStack AI/OpenRouter model compatibility evidence

- **Recorded:** 2026-09-01 (Europe/Sarajevo)
- **Branch:** `tracegate-poc-submission`
- **Scope:** TG-003 only
- **Status:** **P0 PASS — DeepSeek verified; optional model matrix intentionally partial**
- **P0 model pass:** `deepseek/deepseek-v4-flash-0731`
- **Blocker:** none

## Terminal decision

A credentialed, production-shaped probe of the exact planned DeepSeek route passed every required P0 capability through the pinned TanStack AI OpenRouter adapter. The hardened successful report returned `p0Eligible: true`, listed DeepSeek in `p0PassingModels`, had a `null` blocker and safe error, and exited `0`. TG-003's required DeepSeek gate is terminal; the three-model comparison matrix remains intentionally partial under the explicit credit-conservation cut line.

Per the credit-conservation instruction, the optional Mistral and GPT-5 Mini routes were not called after DeepSeek passed. They remain registered by their exact planned slugs but are unverified and must not appear in a verified-model selector until separately probed.

## Pinned production path

| Component | Exact version/path |
|---|---|
| Node.js | `26.1.0` |
| TanStack AI | `@tanstack/ai@0.52.0` |
| OpenRouter adapter | `@tanstack/ai-openrouter@0.19.5` |
| Zod | `zod@4.5.4` |
| Adapter | `createOpenRouterText(modelId, apiKey)` → OpenRouter chat-completions streaming |
| Structured output | strict Zod schema through `chat({ outputSchema, stream: true })` |
| Tool loop | Zod `toolDefinition(...).server(...)`, `maxIterations(6)` |

Agent A owns final multi-lane lockfile generation. A pnpm verification command materialized concurrent web/db importer updates in the working-tree `pnpm-lock.yaml`; per explicit direction, Agent C did not restore, stage, or commit that file. Agent A will regenerate/reconcile it at TG-006.

## Credentialed capability findings

`P` means a live credentialed capability pass. `D` means a deterministic in-process fail-closed mapper check executed during the credentialed probe, not a provider capability claim. `NR` means deliberately not run to conserve credit after the required P0 route passed.

| Exact requested model | Stream/tools | Multiple proposals | Parallel proposals | Strict schema | Usage | Cancellation | Tool error/recovery | Malformed/error mapping | Provider routing | P0 eligible |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `deepseek/deepseek-v4-flash-0731` | P | P | P | P | P | P | P | D | P | **Yes** |
| `mistralai/mistral-small-2603` | NR | NR | NR | NR | NR | NR | NR | NR | NR | Not evaluated |
| `openai/gpt-5-mini` | NR | NR | NR | NR | NR | NR | NR | NR | NR | Not evaluated |

### DeepSeek terminal measurement

| Field | Safe measured result |
|---|---|
| Started/completed | `2026-09-01T09:50:59.103Z` / `2026-09-01T09:51:17.256Z` |
| Duration | `18,142 ms` |
| Tool calls executed | `3` |
| Largest proposal batch | `2` in one model turn |
| Parallel proposal evidence | two tool starts before the first result |
| Max handler execution concurrency | `1` (proposals were parallel; handlers remained serialized) |
| Strict schema | exactly one strict Zod object plus clean terminal event passed on bounded attempt `2`; no additional fields |
| Usage | prompt `2,478`; completion `876`; total `3,354`; cost `0.001233376` |
| Cancellation | request signal propagated; stream terminated in `256 ms` |
| Tool-error path | intentional bounded server-tool throw, matching streamed error result, then exact `PROBE_COMPLETE` recovery marker |
| Malformed-event path | unknown event mapped to a bounded protocol error; raw event discarded |
| Requested route | `deepseek/deepseek-v4-flash-0731` |
| OpenRouter canonical model | `deepseek/deepseek-v4-flash-20260731` |
| Resolved provider | `Novita` |
| Safe terminal error | `null` |

OpenRouter generation metadata canonicalizes the public `-0731` route to the full-date `-20260731` identifier. The probe accepts only that observed DeepSeek alias mapping (or an exact match); unrelated resolved model IDs fail closed. Provider/model attribution is obtained from every generation ID returned by the tool-loop requests through the SDK generation-metadata endpoint. The probe waits for complete provider/model fields and fails if any tool turn remains unresolved or maps to an unexpected model. Only bounded provider/model strings are retained; metadata responses are discarded and never logged.

Routing used `dataCollection: "deny"`, `sort: "throughput"`, and fallbacks enabled. DeepSeek requested `parallelToolCalls: true`. Proposal concurrency and handler execution concurrency are measured separately because P0 must permit multiple provider proposals while serializing tool execution.

A preceding diagnostic run exposed a transient `missing structured result` from one provider request. The harness therefore permits one bounded retry of only the strict-schema subprobe and records the successful attempt number; both invalid attempts still fail the capability. The hardened terminal run passed on its second bounded schema attempt.

## Commands and exact results

Final post-review verification used package-local installed binaries so the shared package manager and lockfile were not invoked again:

```bash
cd examples/tracegate/packages/ai
export PATH="/Users/mirzap/.local/share/mise/installs/node/26.1.0/bin:/usr/bin:/bin"
node_modules/.bin/tsc -p tsconfig.json --noEmit
node --import tsx --test src/*.test.ts
```

```text
typecheck/lint/build-equivalent: exit 0
test: 14 pass, 0 fail; exit 0
```

An earlier combined Turbo invocation caused a local `node_modules` esbuild staging race between concurrent pnpm tasks. A later pnpm verification passed but regenerated the shared working-tree lockfile from concurrently added manifests; that file is intentionally unstaged and left to Agent A.

The terminal credentialed probe was run only for DeepSeek from `packages/ai`, with the ignored environment loaded without printing it and all probe output redirected:

```bash
set -a
source ../../.env
set +a
export TRACEGATE_PROBE_MODEL="deepseek/deepseek-v4-flash-0731"
node_modules/.bin/tsx src/probe-models.ts \
  > /tmp/tracegate-tg003-deepseek-terminal.json \
  2> /tmp/tracegate-tg003-deepseek-terminal.stderr
```

```text
probe exit=0
stdout bytes=2409
stderr bytes=0
configured=true
p0PassingModels=[deepseek/deepseek-v4-flash-0731]
blocker=null
p0Eligible=true
all 9 capability statuses=pass
```

The temporary report was inspected only through an allowlisted projection of capability statuses/details, counts, normalized usage, resolved model/provider, bounded safe error, and eligibility. It was not copied into the repository.

## Deterministic safety checks

The passing local suite verifies:

- only the three exact planned request slugs are registered and DeepSeek is preferred;
- only the observed DeepSeek canonical alias is accepted for its planned public route;
- the pinned adapter forwards the exact `AbortController.signal` and OpenRouter routing/privacy options to the SDK boundary;
- synthetic upstream stream errors map without raw metadata or secret leakage;
- retained model IDs, error codes, tool names, and call IDs are bounded and reject secret-shaped values;
- per-tool state machines reject duplicates and out-of-order `START → ARGS → END → RESULT` transitions;
- one outer run start plus multiple clean model-turn finishes is recognized as the pinned agent-loop terminal shape;
- missing credentials/account action cannot fabricate a pass;
- cancellation requires an abort-specific terminal observation;
- strict results reject extra keys, wrong literals, reversed tuple values, and coercion;
- multiple/parallel proposal lifecycles preserve bounded event order;
- malformed, unknown, and scalar events fail closed;
- raw-event fields are dropped rather than retained;
- secret-shaped diagnostics are redacted and bounded;
- usage remains nullable and rejects negative, non-finite, inconsistent, or overflowed values;
- P0 eligibility requires every declared capability to pass.

## Redaction review

No API key, authorization header, provider secret, live raw response, raw AG-UI event, raw generation metadata, CDP endpoint, replay URL, or challenge token is recorded. The ignored `.env` was sourced only inside the probe process. Raw provider objects remained ephemeral, and only allowlisted bounded summaries were written as evidence.
