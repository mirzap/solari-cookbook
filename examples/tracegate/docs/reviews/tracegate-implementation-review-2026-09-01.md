# TraceGate implementation review — architecture, product, and readiness

- **Date:** 2026-09-01
- **Reviewer:** independent review session (`TraceGate architecture & product review 2026-09-01`)
- **Scope:** full implementation under `examples/tracegate` at working tree `8134197` + 5 uncommitted modified files; the authoritative plan (`docs/plans/tracegate-poc-build-2026-09-01.md`), `AGENTS.md`, product compass, evidence corpus, git history, both local run databases (read before probing was stopped), and agent-session history for the Talon evaluation
- **Constraints honored:** no tests created/modified/run; no application code changed; no further runtime/DB probing after the user's stop
- **Deliverable:** this document only

---

## 1. Executive summary

TraceGate's idea is strong and its engineering substrate is far better than a one-day build has any right to be: real Zod-frozen contracts, a genuinely assertion-blind agent DTO, redaction-at-the-repository-boundary persistence, honest BLOCKED evidence documents, and a careful browser/MCP trust model.

But the product has **never produced a single PASS or FAIL on a real site**. Every recorded real run ended INCONCLUSIVE, and the final coordinator status at 17:45 was, verbatim, *"Honest functional result: **3/3 INCONCLUSIVE**."* The root causes are not exotic infrastructure failures; they are **design decisions that make the current safety/validation posture structurally incompatible with real public websites**:

1. Any policy denial or timeout on a "mutating" action (including `navigate`) terminates the entire run as INCONCLUSIVE — one strike and the sample is dead.
2. The composed runtime forbids clicking links (`functional-runtime.ts:617`), on sites where links are the primary interface.
3. After the first agent action, *any* blocked background request — e.g. an analytics POST that nearly every commercial site fires — becomes a fatal policy violation that kills the next observation.
4. `observe()` costs ~2 serial CDP round-trips per element over a remote browser; on a 60–100 element page that alone can exceed the 15 s tool budget that also has to cover the navigation.
5. Observation truncation (near-certain on real pages) makes text/semantic/state assertions unverifiable by construction, collapsing the usable assertion DSL to URL/title checks.

The post-mortem fix wave (navigation deadline hardening, failure-cause preservation, terminal-uncertainty scoping, UI stall notices) is **real but sits uncommitted in five files across four ownership lanes, and no re-run was ever recorded after it landed**. The fixes also address only causes 1 (partially) and 4 (partially) — causes 2, 3, and 5 remain fully in place. If the Talon evaluation were re-run right now, the most likely outcome is still 3/3 INCONCLUSIVE, just faster and with better error messages.

**Verdict: not functionally ready.** The remaining distance to a working product is small and well-understood — roughly a day of focused, product-first changes to the policy/termination/observation layers plus one honest re-validation — but it is exactly the kind of work the process has so far deprioritized in favor of contracts, evidence documents, and hardening.

---

## 2. The product idea, stated accurately

TraceGate is **reliability testing for the agentic web**. A developer supplies a public HTTPS start URL, exact allowed navigation origins, one bounded natural-language outcome task ("navigate to the pricing and select the standard plan"), and 1–20 deterministic browser-observable success criteria (URL equality / origin+path / origin+path+query-parameter, visible text/title, accessibility role+name counts, element state). TraceGate then:

- runs the task repeatedly in **independent, isolated remote browser sessions** (Solari) driven by a pinned LLM agent (`deepseek/deepseek-v4-flash-0731` via TanStack AI + OpenRouter);
- keeps the agent **assertion-blind** — success criteria never enter the prompt, tools, results, history, or target traffic (`packages/shared/src/agent.ts:262` builds the DTO from prompt + capabilities + observation + budgets only);
- captures **fresh post-action browser evidence** and grades it deterministically (PASS / FAIL / INCONCLUSIVE / CANCELLED) with a frozen precedence — the model's own belief never grades;
- measures **which interfaces the agent discovered, was admitted to, and actually used**: semantic/accessibility UI, page WebMCP (`document.modelContext`), developer-configured MCP (Streamable HTTP, read-only, allowlisted), `llms.txt`, JSON-LD, and visual fallback;
- reports **repeatability** (pass rate with raw numerators/denominators), per-run failure paths, interface readiness/usage, and explicit limitations.

A PASS means only that every declared browser-observable assertion held in the accepted fresh capture — not backend truth. The product compass (`docs/product/tracegate-product.md`) and plan state this correctly and consistently.

This is a coherent, differentiated product thesis: *"a website working once for an agent is not reliability; TraceGate measures whether it works repeatedly, and tells you which agent-facing interfaces helped."*

---

## 3. What concretely works vs. what is scaffolded or failing

### Works (verified in code, and in DB/evidence where noted)

| Capability | Evidence |
|---|---|
| Contract layer: config, assertion DSL (incl. new query-param operator), agent DTO, grading schemas, transitions, events | `packages/shared/src/*` — strict Zod, invariants enforced in-schema (e.g. `GradeResultV2Schema` outcome/assertion consistency, `grading.ts:36–44`) |
| Atomic submission → evaluation + run rows + queued events, in one transaction | `tracegate-server.ts` `createEvaluation` → `db.transactionallyCreateSubmission`; run rows for real evals exist in both DBs |
| Serialized single-writer persistence with redaction-before-write and known-secret scrubbing | `packages/db/src/database.ts` (writer queue at every mutation, `sanitizeEvent`/`redactClosedRecord`; `knownSecrets` injected at `composition.ts:33`) |
| Publish-after-commit SSE + authoritative snapshot recovery + bounded frames/heartbeats | `apps/web/src/server/sse.ts`, `tracegate-server.ts` `#publishPersisted`, `use-live-evaluation.ts` buffering/refetch |
| Real Solari lifecycle: single create attempt, ambiguous-create → potential-leak, release in `finally`, attempt ledger | `packages/solari/src/browser-provider.ts`, `evaluation/src/executor.ts` finally block; DB rows show `release_status=released`, `potential_session_leak=0` for all real runs |
| Practical target admission: structural HTTPS checks, IP-literal/localhost rejection, real public-range IPv4/IPv6 DNS preflight, honest limitation records | `packages/discovery/src/practical-target-admission.ts` |
| Real model execution through TanStack/OpenRouter with streamed protocol validation, usage accounting, provider identity resolution | `packages/ai/src/tanstack-agent-driver.ts`; runs at 17:22 reached DeepSeek and dispatched actions (session `D3932B8A`) |
| WebMCP and configured-MCP trust pipeline: sanitization, closed input schemas, read-only admission, re-verification before invoke, bounded untrusted results | `packages/solari/src/webmcp-readonly-adapter.ts`, `packages/agent/src/configured-mcp-client.ts`, `packages/shared/src/mcp.ts` |
| Deterministic grader incl. correct query-parameter re-evaluation from the transient canonical URL | `packages/grading/src/index.ts:18–41` |
| Configure / live / report UI with plain-language copy, run cards, interface insight cards, assertion result tables | `apps/web/src/routes/index.tsx`, `evaluations/$id.tsx` |
| Demo-fixture independence | no production import of `@tracegate/demo` or `shared/testing` outside tests (searched); fixture is now a test-only job board |
| Assertion non-flow | `buildAgentExecutionInputV2` carries no assertion fields; strict schemas make accidental flow a compile/parse error |

### Scaffolded / present but not product-effective

- **llms.txt and JSON-LD**: discovered and persisted (`discovery-controller.ts`) but **never exposed to the agent** — no tool reads them, so their "used" metrics are structurally zero. The report implies six agent-usable interfaces; two are measurement-only today.
- **Visual fallback**: an `InterfaceChannel` and UI card exist; no implementation path produces it (readiness always 0 via `PersistingDiscoveryController`).
- **Optional models** (`mistralai/mistral-small-2603`, `openai/gpt-5-mini`): listed in `packages/ai/src/models.ts` and in the UI as "unavailable"; server rejects them (`FUNCTIONAL_MODEL_IDS`). Honest, per plan.
- **Recording/replay**: `recordingRequested` plumbed end-to-end; `replayStatus` persists `pending` forever — no replay surface (deferred per plan, but the flag in the UI suggests more than exists).
- **`EvaluationSubmissionService` and `FunctionalEvaluationExecutor`'s A-lane siblings**: `packages/evaluation/src/submission.ts` is dead code — `TracegateServer.createEvaluation` re-implements submission itself. Two parallel implementations of the same atomic invariant now exist.
- **`tests/e2e`**: one fake-port test; dormant by directive.

### Failing / never demonstrated

- **F3 "one real end-to-end readiness run" and F4 "repeated runs report" — the actual definition of done — have never succeeded.** Recorded outcomes across both databases: eval `01a05df5` 17:12 **failed**, `01a05df8` 17:16 **failed** (stranded in `apps/web/tracegate-v2.db`), `01a05dfe` 17:22 **failed** with runs 0–1 INCONCLUSIVE, `01a05e0e` 17:39 **completed** with run 0 INCONCLUSIVE (`target_unavailable` at `connecting_browser`, 0 iterations, 0 tool calls, 19.75 s). No `passed` or `failed` *outcome* exists anywhere; no PASS was ever observed in session history either.
- **The post-fix state is unvalidated**: all remediation commits (17:59–19:44) and the five uncommitted files post-date the last recorded evaluation attempt (17:39). There is no evidence any evaluation was attempted after any fix landed.

---

## 4. Post-mortem: why the Talon evaluation ended 3/3 INCONCLUSIVE

**Target:** `https://www.talon.ba` (a real Bosnian-language commercial site). **Task:** "navigate to the pricing and select the standard plan. expected routed URL should contain planId=12."

### 4.1 Failure mechanics (reconstructed from DB rows + sessions `262A1019`, `D3932B8A`, `44F719C9`)

**Runs at 17:22 (2 recorded, both INCONCLUSIVE):**
1. Solari session acquired and acknowledged; controller connected; `https://www.talon.ba` opened; initial observation succeeded at revision 1; discovery found 63–64 semantic controls.
2. DeepSeek was invoked successfully and proposed `navigate` to the pricing page.
3. The `navigate` tool = `page.goto(waitUntil: "domcontentloaded")` **plus a full `observe()`**, all inside one 15 s `toolTimeoutMs`. It exceeded the budget: **15,048 ms and 15,093 ms**.
4. `BudgetLedger.withToolTimeout` threw `budget_exhausted`; because `navigate` is in `MUTATING_ACTIONS` (`packages/agent/src/executor.ts:32`) the executor latched `#terminalUncertainty` → every subsequent step failed with `target_evidence_lost` ("A prior timed-out tool left browser state uncertain").
5. Grading fabricated the all-zero-hash inconclusive grade; the run finalized INCONCLUSIVE. The evaluation itself ended **failed** (a third run never reached a durable terminal state — see orchestrator finding H3).

**Run at 17:39 (1 recorded, INCONCLUSIVE):** the CDP connect/setup phase itself exceeded its deadline (~19.7 s duration, 0 iterations); the then-current `evaluation/src/executor.ts` catch-all **masked the real error** into `target_unavailable` / "Run execution stopped before trustworthy browser evidence was available." — which is exactly why the (now uncommitted) failure-preservation fix exists.

**Two earlier evaluations (17:12, 17:16) are stranded in a different database file** (`apps/web/tracegate-v2.db`): `DATABASE_URL=file:./…` was resolved against the Vite process CWD, so the app wrote to `apps/web/` while tooling migrated `.tracegate/`. Commit `0a46a49` (19:13, "root env loading") absolutized the path in `scripts/tracegate.mjs` — but `composition.ts:26` still falls back to a **relative** `file:tracegate-v2.db` (see H2).

### 4.2 Root causes, ranked

1. **Latency physics vs. a single flat tool budget.** `navigate` bundles goto + stabilization + `observe()`. `observe()` (`browser-controller.ts` ~line 640–700) walks up to 100 locators with `isVisible()` + `evaluate(readElement)` per element — ≈2 *serial* CDP round-trips each, against a **remote us-west browser**. At 100–150 ms RTT, 60 visible elements ≈ 12–18 s of pure round-trips. The budget was spent before the site did anything wrong.
2. **One-strike terminalization.** A timeout on a mutating action doesn't degrade the run — it poisons it. The design intent ("state may have changed without fresh evidence") is defensible for a click; for a *timed-out initial navigation on the first action* it converts an infrastructure hiccup into a full INCONCLUSIVE with zero salvage.
3. **Failure masking.** The status-based error coercion in `evaluation/src/executor.ts` hid the precise browser-phase cause, so diagnosis required forensic session archaeology instead of reading the persisted failure record.
4. **Environment drift mid-campaign.** The dual-database CWD bug plus a dev-port collision (fixed in `944a09c`, 19:26) meant the earliest two evaluations ran on a broken composition and their evidence is stranded.

### 4.3 Process/coordination failures around the evaluation

- **Gate inversion.** The plan is explicit: *"F3 begins only after manual loopback UI/API/DB inspection is green."* In reality, real Talon evaluations (F3/F4-class activity) were launched at 17:12–17:39 while F2C composition defects (env loading, migration packaging, port selection, interface-readiness overwrite `8134197`) were still being found and fixed until 19:44. The runs executed against uncommitted work-in-progress; the commit record post-dates the runtime it describes.
- **The fix wave was never closed.** Four short fix sessions (`Harden Solari navigation deadlines`, `Harden AI Agent Timeout Handling`, `Preserve Evaluation Failure Cause`, `Agent D — Evaluation Stall DB/UI`, each 3–6 minutes) produced coordinated changes to `packages/solari`, `packages/agent`, `packages/evaluation`, and `apps/web` — **five files, four ownership lanes, all left uncommitted**, violating the repo's own lane-commit discipline (`AGENTS.md` §WIP quarantine: "Each lane commits only its exclusive paths"). No integration checkpoint, no lockfile-style sign-off, and — decisively — **no re-run**.
- **Diagnosis by proxy.** Because failure records were masked (4.2.3) and the UI showed no stall/failure surface (the uncommitted `$id.tsx` notices are the patch for this), each INCONCLUSIVE required spawning a fresh investigation agent to read raw DB rows. The observability gap multiplied coordination cost at the exact moment time mattered most.
- **Partial fixes presented as the fix.** The navigation-deadline hardening reduces goto waiting (`waitUntil: "commit"` + bounded DOMContentLoaded grace) and adds phase deadlines — but the dominant cost term (`observe()`'s per-element round-trips) is untouched, and root causes 2/3/5 from §1 are untouched. Integrating these five files does **not** make the Talon evaluation pass; treating them as "the fixes" without a validating run would be a repeat of the same failure mode.

---

## 5. Findings, ranked by severity

Severity: **C** = defeats the product's core function on real sites; **H** = will corrupt results, block the milestone, or is a materially unsafe/incorrect behavior; **M** = quality/robustness/product-coherence defect; **L** = polish.

### Critical

**C1 — Post-first-action background requests are fatal; most real sites cannot survive an agent action.**
`browser-controller.ts:1231` (`#recordPolicy` inside the `context.route` handler) marks every blocked request after `#hasDispatchedAgentAction` (set by *every* action incl. `wait` and `scroll`, lines 741–915) as **fatal**, and `observe()`/`#resolve` throw `unsafe_action_blocked` on any fatal code. `classifyObservableRequest` (`policy.ts:120–146`) denies **all** non-GET/HEAD requests and request bodies — including third-party analytics beacons (GA4/Meta/etc. POST on click, scroll, or timers on virtually every commercial site, talon.ba included). Sequence on a healthy run: agent clicks → page fires analytics POST → blocked (correct) → recorded fatal (wrong) → next observation throws → run INCONCLUSIVE. Blocking the request is right; treating an *ambient, blocked, third-party* request as evidence-invalidating agent misbehavior is product-lethal.
*Remediation:* keep aborting them, but classify by causality and target: only a **main-frame or same-origin state-changing** request (or an explicitly agent-initiated one) is fatal; blocked cross-origin subresource POSTs become passive warnings with counts in `policyActivity`. This is a ~15-line change in `#recordPolicy`/`classifyObservableRequest` plus honest surfacing in the report.

**C2 — The composed runtime forbids clicking links.**
`functional-runtime.ts:617`: `if (element.attributes.href) throw blockedByPolicy("unknown_effect", "Link activation is not an admitted reversible control action")`. On a marketing/pricing site, anchors are *the* interface; "select the standard plan" is an `<a href="/register?planId=12">`. The controller layer already implements the correct policy — `click()` (`browser-controller.ts:735–744`) validates the href against exact allowed origins before dispatch — so the composition layer's blanket ban both breaks the product and disagrees with its own lower layer. Worse, because `click` is a mutating action, this denial is thrown *inside* `tools.execute` after `dispatched = true`, so it doesn't just deny — it **terminates the run** via C3. The agent's only remaining path is synthesizing `navigate` calls from href attributes that survive observation truncation.
*Remediation:* delete the href ban in `RuntimeSafeTools.execute` and rely on the controller's exact-origin href check; classify same-origin link activation as an admitted navigation effect.

**C3 — Every denial/failure of a mutating action is run-terminal; the product converts model friction into INCONCLUSIVE instead of signal.**
`packages/agent/src/executor.ts` (`#executeNow` catch): any error after `dispatched = true` on a `MUTATING_ACTIONS` member latches `#loseTargetEvidence` → terminal `target_evidence_lost`. But `dispatched` is set **before** `tools.execute` runs, and `RuntimeSafeTools.execute` performs *pre-dispatch* checks (surface revision, policy assertion, C2's href ban, unsafe-control matching) inside that call — so pure policy denials that never touched the browser are treated as evidence loss. Additionally, protocol slips (unavailable tool name, invalid JSON args, schema mismatch — `admit`/`#executeNow`) throw terminal `provider_protocol_error`. Real LLMs commit these sins routinely; a reliability product must convert them into denials-fed-back-to-the-model (bounded by budgets) and keep measuring. The current design measures *TraceGate's intolerance*, not the site's reliability — and directly manufactured the Talon outcome.
*Remediation:* (a) move the `dispatched` flag so it reflects actual controller dispatch (set it inside the port after guards pass, or split guard/dispatch phases); (b) return policy denials and malformed proposals to the model as bounded `safe_tool_error` results (already the pattern for non-mutating failures); (c) reserve terminal uncertainty for failures of *actually dispatched* state-changing operations, and even then prefer "resynchronize via fresh `observe()` + continue" over run death when the browser is still on an admitted origin.

**C4 — `observe()`'s per-element round-trips cannot fit real pages inside the tool budget over remote CDP.**
See §4.2.1. `observe()` runs up to 100 × (`isVisible()` + `evaluate(readElement)`) sequentially; every mutating action then calls `observe()` again, and the uncommitted navigation rework caps it with the same internal deadline — so navigation on element-heavy pages will *still* blow its budget after the fix.
*Remediation:* collect the entire semantic snapshot in **one** `page.evaluate` (or `locator.evaluateAll` over `SEMANTIC_SELECTOR`) that walks matching elements in-page and returns the bounded array in a single round-trip; keep the Node-side byte-budget trimming. This is the single highest-leverage performance change in the codebase (~sub-second observations instead of 10–20 s).

**C5 — Truncated observations make text/semantic/state assertions unverifiable, so the assertion DSL collapses on real pages.**
`fresh-evidence-capture.ts:127–149`: `document_visible_text` assertions are unverifiable when `observation.truncated`; semantic/state assertions are unverifiable when `observation.truncated` (line 146). `observe()` sets `truncated` whenever >100 selector matches, any 500-char field overflows, or the 12 KiB (default) byte budget bites — i.e. on essentially every real commercial page (talon.ba's 17:39 grade shows the text criterion: "No trustworthy final browser evidence was available"). Grading capture reuses the *model-facing* observation bounds, but grading has no model-context reason to be bounded to 12 KiB.
*Remediation:* decouple grading capture from model-observation limits — capture assertion evidence from a dedicated, larger-bounded pass (full visible text up to e.g. 256 KiB hashed + the specific roles/names the assertions target, queried directly), and scope `truncated`-invalidations per assertion (an element-cap truncation shouldn't invalidate a text assertion whose text was fully captured, and vice versa). URL/title assertions already survive; the fix restores the other three kinds.

**C6 — The remediation is uncommitted, cross-lane, and unvalidated; the milestone claim rests on nothing.**
Five modified files (`packages/solari/src/browser-controller.ts`, `packages/agent/src/{executor,runner}.ts`, `packages/evaluation/src/executor.ts`, `apps/web/src/routes/evaluations/$id.tsx`) sit in the working tree with no commit, no integration checkpoint, and no post-fix evaluation. Until a real re-run happens, F3 remains unstarted-in-effect regardless of how much code exists.
*Remediation:* land the five files through the normal lane-commit + A-integration path (they are good changes), then immediately run one single-run evaluation against a *simple, static* page (see §10 step 5) before returning to Talon.

### High

**H1 — The unsafe-control classifier is English-only; on non-English sites the "obvious unsafe control" boundary silently vanishes.**
`policy.ts:7–9` (`UNSAFE_CONTROL`, `SENSITIVE_FIELD`) match `sign in|buy|checkout|password|…` — none of `prijava`, `kupi`, `korpa`, `plaćanje`, `pošalji`. The very first real target chosen was Bosnian. Today the link-click ban (C2) accidentally masks much of the exposure; the moment C2 is fixed, the safety net for non-English sites is the type/attribute heuristics only (`type=password/submit/file`, `formmethod`, `download`, `target=_blank`) — real but much thinner than the product's stated boundary. The docs claim keyword blocking without qualifying its language.
*Remediation:* short-term, state the limitation honestly in report/UI copy and lean harder on structural signals (form membership, `formmethod!=get`, `type`, `autocomplete`, `aria-*`); medium-term add a small multilingual lexicon or model-free heuristic set for the top prohibited categories.

**H2 — The CWD-relative database fallback that stranded two evaluations is still in the composition.**
`composition.ts:26`: `DATABASE_URL: process.env.DATABASE_URL ?? "file:tracegate-v2.db"`. Anyone starting the server without the wrapper script reproduces the split-brain (two DBs exist on disk right now as proof). Also note `tracegate-v2.db` vs. the script default `.tracegate/tracegate.db` — two different defaults in one codebase.
*Remediation:* make the composition **fail closed** on missing `DATABASE_URL` (parseServerEnv already exists to do this) or resolve the same absolute default the script uses; delete the stray `apps/web/tracegate-v2.db` after archiving its rows.

**H3 — One run's unexpected error aborts the remaining sample and marks the whole evaluation "failed".**
`orchestrator.ts:58–60` stops dispatching further runs when `firstError` is set, then `:105–118` marks the evaluation failed when `completeResults.length !== runs.length`. For a *reliability measurement* product, run independence is the point: a repository hiccup or CAS conflict in run 2 should record run 2 as inconclusive and still execute run 3. This is why the 17:22 evaluation shows status `failed` with only two run rows terminal — the sample was abandoned mid-campaign.
*Remediation:* catch per-run unexpected errors inside the dispatch wrapper, terminalize that run as inconclusive/infrastructure via the normal finalize path, continue the loop; reserve evaluation-level `failed` for systemic conditions (DB down, cancellation cleanup failure).

**H4 — Provider-metadata and usage strictness are additional run-killers with no product payoff.**
(a) `tanstack-agent-driver.ts` `resolveProvider` polls OpenRouter generation metadata up to ~5.5 s per ID and **throws `provider_protocol_error`** (run-terminal) when identity stays unresolved — after the turn already succeeded. (b) `budgets.ts:46–50` terminal-fails the run when the provider omits usage or `prompt+completion !== total` (reasoning-token accounting on some routes breaks this arithmetic). Both were already patched once mid-campaign (`19b111a`).
*Remediation:* degrade to `resolvedProvider: null` + warning; accept absent/inconsistent usage as nulls + warning. Keep strictness for genuinely protocol-corrupt streams.

**H5 — Interface metrics are partially synthesized and systematically miscount the semantic path.**
(a) `tracegate-server.ts` `summarizeInterfaceUsage` and the UI's `AgentInterfaceInsights` floor `discovered`/`admitted` with `Math.max(..., invoked > 0 ? 1 : 0)` — fabricating discovery from usage to satisfy the schema invariant. (b) `agent/src/executor.ts:34–39` maps `navigate` to `orchestration`, so on link-ban sites (C2) the dominant semantically-informed action is excluded from `semantic_ui` usage; llms_txt/json_ld can never be "used" (§3, scaffolded). The report's headline "which interfaces helped" is therefore directionally unreliable at exactly its selling point.
*Remediation:* persist real per-channel discovery counts (they exist in `RunRuntimeRegistry.readiness`) instead of flooring; classify `navigate` as `semantic_ui` when its URL originated from an observed href (or introduce an `agent_navigation` channel); label unimplemented channels as "not yet measured" in the UI rather than "not observed".

**H6 — Capture stability rule + dynamic pages = chronic `page_unstable` INCONCLUSIVE.**
`fresh-evidence-capture.ts:23–24, 233–252`: three attempts, 750 ms apart, requiring two *byte-identical* fingerprints over URL+title+visibleText+elements. Any carousel, ticking clock, rotating testimonial, or lazy-loaded image alt-text defeats it, and each attempt costs a full `observe()` (see C4). The one F1 safety-smoke run that reached this stage stopped exactly here (`docs/evidence/solari-public-site-safety-smoke.md`, `smoke_internal:fresh_evidence`).
*Remediation:* fingerprint only assertion-relevant projections (final URL, title, the queried roles/names/states, and a normalized text digest with volatile-run stripping), not the whole envelope; raise attempts/interval modestly; record which fields were unstable.

**H7 — Configured-MCP endpoint reachability is unconstrained HTTPS while browser targets get DNS preflight — an inconsistent egress posture.**
`shared/src/mcp.ts:14–24` admits any non-loopback **HTTPS** URL with no IP-literal/private-range/preflight check; the local server then POSTs MCP protocol bodies to it (`configured-mcp-client.ts`). The browsing path rejects IP literals and private DNS answers; the MCP path doesn't. Single-user local tool → low practical risk, but it's the one outbound-request surface the *server* owns, and the plan's "loopback HTTP or HTTPS" wording deserves the stricter reading.
*Remediation:* apply the same hostname rules as targets (no IP literals, no `.local`) and optionally reuse `PracticalTargetAdmission`'s public-DNS preflight for non-loopback HTTPS endpoints.

### Medium

**M1 — Talon-flow copy is baked into the generic product UI.** `routes/index.tsx:150–165` labels the query operator "Registration page with plan," placeholders `planId`/`12`; `evaluations/$id.tsx` `successCriterionDescription` renders "Registration page …". The operator itself is generic (good — the promise "no Talon-specific logic enters the runtime" holds), but the copy encodes one customer's flow. *Remediation:* rename to "Final page with query parameter"; neutral placeholders.

**M2 — Evidence/grade divergence for the query-parameter operator.** `solari/src/fresh-evidence-capture.ts` `evaluateAssertionFromObservation` treats `origin_path_and_query_parameter_equals` as origin+path only; the grader corrects it (`grading/src/index.ts:18–41`) from the transient URL, but the **durable** `assertion_evidence` row and its `actualSummary` ("Final URL matched") can contradict the persisted grade. Three URL evaluators now exist (shared, solari, grading merge). *Remediation:* make capture call shared `evaluateUrlAssertion`; delete the local variant.

**M3 — Read-side API has no Host/DNS-rebinding guard.** `http.ts` checks loopback Host/Origin only for mutations; `GET` snapshot/report/trace/events (incl. SSE) will happily serve a rebound hostname. Local single-user data, but the fix is 3 lines in a shared guard. *Remediation:* apply the Host check to all `/api/*` handlers.

**M4 — Live UI request amplification.** `evaluations/$id.tsx` refetches report + trace + up to 10 event pages on every `latestCursor` change, and `use-live-evaluation.ts` refetches the full snapshot after *every* SSE event. Hundreds of milestones per run → O(events²) reads on a single-writer SQLite. Works at POC scale; will visibly degrade live UX on real multi-run evaluations. *Remediation:* debounce cursor-driven refetches; fetch events incrementally from the last cursor (the API already supports it).

**M5 — Monkey-patching OpenRouter client internals.** `tanstack-agent-driver.ts` `observeGenerationIds` swaps `orClient.chat.send` at runtime and reads private response fields; any adapter minor release breaks provider resolution → with H4, breaks runs. *Remediation:* after H4 softening, treat metadata as best-effort; upstream a supported hook.

**M6 — Migration-folder guessing.** `db/src/migrate.ts:8–23` probes four CWD-relative candidates (the residue of the F2C "bundled migration-path failure"). Works from the repo; brittle anywhere else (the `import.meta.url` candidate resolves inside `dist` only because `drizzle/` sits beside `src/`). *Remediation:* resolve strictly from package root via `import.meta.url` + package-relative constant; keep `TRACEGATE_MIGRATIONS_DIR` as the sole override.

**M7 — Config duplication and drift seeds.** `maximumConcurrency: 3` hard-coded (`composition.ts:40`) alongside schema `requestedConcurrency` ≤ 5; form default concurrency 1 vs schema default 3; `OneEvaluationQueue(4)` pending bound un-surfaced (submit #6 while busy → raw 500 via `#failScheduledEvaluation`… actually rejected promise → evaluation marked failed post-creation, a confusing UX path). *Remediation:* single source for runtime capacity; surface queue-full as a 409 at submission.

**M8 — `evaluateAssertionFromObservation` title-scope inconsistency.** Title text assertions grade even when `truncated` (title itself is capped at 500 chars with its own flag folded into `truncated`) while a 500-char *element name* overflow anywhere flips global `truncated` and poisons semantic/state assertions (C5 adjacent). Per-field truncation tracking would fix both. *(Folded into C5 remediation.)*

**M9 — Dead/duplicated submission + a "compatibility alias" layer that grew immediately.** `EvaluationSubmissionService` unused (§3); `EvaluationConfigSchema`/`GradeResultSchema` aliases point at V2 "for compatibility" in a codebase 12 hours old. Low-cost cleanup; keeps the contract surface honest.

### Low

- **L1** `.env` handling is correct (gitignored, `.env.example` clean, keys never printed; redaction patterns cover `sk-or-…`/Solari shapes and known secrets are scrubbed at the DB boundary). Residual nit: `scripts/tracegate.mjs env` prints "configured" only — good.
- **L2** Build hygiene: `dist/`, `.turbo/`, and compiled `.js/.d.ts` inside `packages/*/src` are correctly gitignored (`.gitignore:1–18`) but litter the working tree and the shared `src/` dirs, inviting accidental imports of stale artifacts; `drizzle/meta` at repo root is an empty stray.
- **L3** `pnpm dev` builds the entire workspace (incl. e2e-filtered turbo graph) before serving — slow feedback during exactly the debugging loop that mattered; consider `--filter` scoping.
- **L4** UI pipeline "Verify" step renders done only for passed runs (`RunCard`); inconclusive runs show a half-finished pipeline even though grading ran.
- **L5** `apps/web/dist` ships alongside `src` with `vite preview` as the "production" server — acceptable for a local POC; document that judged runs must use `pnpm start` (built server), echoing the prior critique's HMR-singleton warning (the `globalThis`-free singletons in `composition.ts` are only safe on the built server).

---

## 6. Security, secrets, and trust boundaries — assessment

**Overall: strong for a local POC; several deliberate, documented limitations; no secret-handling defects found.**

- **Secrets:** environment-validated via branded `SecretString` (`shared/src/env.ts`); never persisted; known-secret scrubbing at the single persistence choke point (`TracegateDatabase.open({ knownSecrets })` from `composition.ts:33`); pattern-based redaction for bearer/basic/`sk|or|solari` tokens, ws(s) URLs, and sensitive query params (`shared/src/redaction.ts`); CDP endpoints typed `SensitiveBrowserEndpoint` and never written; the F1/F2 checkpoint's secret scans corroborate.
- **Assertion non-flow (prompt-side integrity):** enforced by construction (`buildAgentExecutionInputV2`), not just convention; strict schemas mean an accidental extra field fails parse. The system prompt (`agent/src/prompts.ts`) correctly labels task/page/tool content untrusted.
- **Prompt-injection posture:** page text, WebMCP descriptors/results, and MCP results are wrapped as explicitly untrusted JSON envelopes; tool surfaces are closed enums; WebMCP/MCP inputs validate against locally sanitized closed schemas with prototype-key rejection (`webmcp-readonly-adapter.ts:66–95`); re-discovery + descriptor equality immediately before WebMCP invoke defeats swap attacks. This is genuinely above-par work.
- **SSRF / origin safety:** target admission does structural HTTPS + IP-literal/localhost rejection + real public-range A/AAAA preflight with honest `dns_rebinding_not_fully_prevented` limitation records; browsing egress is additionally constrained in-browser (exact-origin main frames, GET/HEAD-only, no bodies, WS blocked, popups closed, service workers triple-blocked). Gaps are the documented ones (no provider-side enforcement; cross-origin GET subresources allowed) plus H7 (MCP endpoint asymmetry).
- **Control plane:** loopback bind enforced by env schema; mutation CSRF via Host/Origin checks (`http.ts`); M3 (read-side Host check) is the one cheap gap.
- **Honesty controls:** non-fabrication rules in `AGENTS.md` were *followed under pressure* — the team recorded 3/3 INCONCLUSIVE rather than splicing a pass; evidence documents carry BLOCKED statuses. This is a real cultural asset; preserve it through the recovery.

**Trust-boundary defects found are product defects, not leaks** — C1/C3 over-enforce (converting ambient noise into outcome corruption) rather than under-enforce. One conceptual note: `currentAssertionSnapshot` synthesizes `documentId`/`loaderId` from a local navigation counter (`browser-controller.ts:960–975`) — capture "freshness" is Playwright-event-based, not CDP-document-identity-based. Fine for the POC, but the evidence schema's names imply more than is measured; rename or note it.

---

## 7. Architecture and code quality

**The port/adapter discipline is real.** `shared` is a genuine dependency apex; concrete Solari/DB/AI classes never cross lane signatures; the executor consumes only ports; fakes exist under `shared/testing`. The uncommitted-fix diffs slotted into existing seams cleanly — evidence the seams are right.

**The composition root is doing too much.** `apps/web/src/server/functional-runtime.ts` (1,011 lines) contains seven decorator classes, a registry keyed by three parallel WeakMaps, policy re-implementation (`RuntimeSafeTools` re-instantiates `AgentPolicy`, duplicating checks the agent executor already performs — same-check-different-layer divergence is how C2 happened), and metric assembly. It is D-lane code wrapping A/B/C surfaces with logic that belongs *in* those packages (e.g. the safe-tool port belongs beside the agent policy; readiness metrics beside discovery).

**Over-engineering is concentrated exactly where product function is missing.** Three URL evaluators (M2); two submission implementations (M9); duplicated closed-input validators in four places (`agent/policy.ts`, `ai` superRefines, `webmcp-readonly-adapter`, `configured-mcp-client`); a five-state provider-attempt ledger — while no run has ever passed. The codebase optimizes for "no unsafe or untrue result can ever be recorded" and got there; it never optimized for "a true result can be achieved."

**Error semantics are the weakest layer.** A single `TraceGateError { safe }` shape carries policy denials, protocol violations, budget exhaustion, and infrastructure failures, and almost every site that catches one rethrows it as terminal. The missing concept is **recoverability**: a `deny` that feeds back to the model vs. a `terminal` that ends the run. `FailureRecord.retryable` exists but is set `false` nearly everywhere and consulted nowhere.

**Observability:** milestone/event pipeline, per-phase steps, attempt ledger, and policy-activity counters are excellent *once written* — the campaign's pain came from the coercion layer discarding causes (fixed, uncommitted) and the UI not surfacing stalls (fixed, uncommitted). Add: a plain server log line per run phase (currently almost no logging at all — `TRACEGATE_LOG_LEVEL` is parsed and unused), and persist per-action durations (schema already carries `durationMs`).

---

## 8. Plan/milestone alignment, ownership, and process

**Where the build stands against the plan's own gates:** F1 ✅ (integrated, honest checkpoint), F2 ✅ (all four lanes landed real implementations), F2C ⚠️ (composition exists and boots; the checkpoint's own bar — "one manual evaluation flow works" — was only met in the degenerate sense that evaluations *run and terminate*), F3 ❌ (attempted out of order, never achieved), F4 ❌ (`3/3 INCONCLUSIVE` is a repeatability report of infrastructure noise), F5 ❌.

**The lane model worked for building and failed for firefighting.** Clean parallel construction, zero cross-lane commit violations in history, a real integration checkpoint with per-lane test counts — followed by a fix phase where ownership boundaries dissolved (five uncommitted files across four lanes, C6) because no protocol existed for "cross-cutting incident response."

**A previous independent review already shaped this codebase — selectively.** `docs/reviews/tracegate-poc-plan-critique-2026-09-01.md` (plan-stage) demanded shared redaction, canonical fakes, sampling persistence, `maxHistoryBytes`, attempt-row ambiguous-create handling, the single-writer queue, and the 120 s wall clock — all present in today's code. But its deepest product warnings — *"budget exhaustion converts orchestration latency into false outcomes"* (§3.1) and *"history/latency will look like model failure"* (§4.1) — are precisely what materialized as 3/3 INCONCLUSIVE, transplanted from `failed` to `inconclusive`. The process absorbs structural feedback and under-absorbs product-risk feedback.

**Process deadlock on record:** the no-automated-tests directive froze the `@tracegate/ui` zero-test blocker that the F1/F2 checkpoint declared must be fixed before F3 (`AGENTS.md` "explicitly deferred"). Either the checkpoint bar or the directive has to give; currently both are honored and the gate is simply unresolvable.

**Documentation-to-outcome inversion.** ~20 evidence documents, a 372-line plan, a 310-line critique, meticulous AGENTS.md — and zero passing runs. The documentation is *good*; the ratio is the finding. Every hour of the final three hours spent on evidence prose was an hour not spent re-running one evaluation against a static page.

---

## 9. Submission-vs-product scope drift

The branch is `tracegate-poc-submission`; the repo is a fork of a Solari examples cookbook; `docs/evidence/generic-site-pivot.md` records the mid-day decision that *"fork establishment, video, social post, challenge submission, and submission polish are no longer product deliverables."* The pivot away from the Demo-Store challenge scenario to generic public sites was correct and is genuinely reflected in the code (Demo is test-only; no scenario IDs in production). Residual drift to watch:

- **Deadline-shaped choices persisting as design:** the one-day, single-target push produced M1's Talon copy, the C2 link ban (a fast way to feel safe for a demo), and the 17:xx gate-skipping. None are marked as temporary anywhere.
- **Submission-era safety framing** (maximum-caution INCONCLUSIVE bias, heavy limitation prose in UI copy) now *works against* the product promise of measuring reliability — a paying user needs signal, and "inconclusive because your analytics fired" is anti-signal.
- The examples-cookbook siblings and root README still frame the repo as examples; harmless, but a reviewer landing at the repo root cannot find TraceGate's own README (there is none under `examples/tracegate/` — the plan's F-gates referenced one).

---

## 10. Readiness assessment and prioritized recovery plan

**Candid readiness:** *Infrastructure-ready, product-blocked.* Persistence, lifecycle, contracts, safety plumbing, and UI are near-F3 quality. The action policy, termination semantics, observation cost, and evidence bounds make real-site success nearly impossible, so the headline capability — a PASS/FAIL reliability report for an arbitrary site — has never existed. No further scaffolding, hardening, or documentation moves that number; only the following sequence does.

Ordered for **maximum functional progress per step**; each step names its acceptance signal. Steps 1–6 are plausibly one focused day.

1. **Land the orphaned fix wave** (C6). Commit the five modified files through lane owners + A integration; `pnpm typecheck && pnpm build`. *Signal: clean tree, green build.*
2. **Make one page cheap to see** (C4). Single-round-trip `observe()` via one in-page evaluation; keep byte budgets. *Signal: manual dev-run log shows observation < 1 s on talon.ba.*
3. **Stop killing runs for surviving-able events** — the three-part termination fix:
   a. C1: blocked cross-origin subresource requests → passive warnings, never fatal;
   b. C2: delete the composition-level link-click ban, rely on the controller's exact-origin href gate;
   c. C3: policy denials + malformed proposals → bounded error results fed back to the model; terminal uncertainty only for dispatched-and-failed state changes.
   *Signal: a scripted-fake run (existing `shared/testing` fakes, manual node script — not an automated test) shows a denial followed by continued execution.*
4. **Preserve causes and soften provider strictness** (H4): keep the failure-preservation change; make provider-identity and usage anomalies warnings. *Signal: induced failure shows its real phase/message in the run row.*
5. **Re-validate honestly, easiest target first.** One 1-run evaluation against a simple static HTTPS page (e.g. a docs site) with a URL assertion; then the 3-run Talon evaluation with the `planId=12` query assertion. Record both in a new evidence doc *whatever the outcome*. *Signal: first-ever `outcome=passed` row — or a truthful post-mortem with the now-unmasked cause.*
6. **Fix the split-brain fallback** (H2) and run independence (H3). *Signal: killing a run mid-flight leaves the other runs completing; a fresh checkout with only `.env` produces exactly one DB file.*
7. **Then** the honesty/productization tier: C5 evidence-capture decoupling (restores text/semantic/state assertions), H5 metric truth (real discovery counts, navigate attribution, "not yet measured" labels for llms.txt/JSON-LD/visual), H6 stability fingerprint scoping, M1 copy neutralization, H1 language-limitation disclosure.
8. **Then** hygiene: M2/M3/M6/M7/M9, read-side Host check, dead-code deletion, a TraceGate-local README with the run book, and — once the user lifts the test pause — resurrect the checkpoint bar (UI zero-test blocker first).

**What not to do next:** more shared-contract refinement, more evidence documents before step 5, any new interface channel (visual fallback, extra models), or provider-grade egress hardening — the plan already correctly defers these, and every one of them is downstream of a product that has never passed once.

---

## Appendix A — verified factual record

**Git:** branch `tracegate-poc-submission`; 34 TraceGate commits, all 2026-09-01 09:54–19:44; baseline fork commits from 2026-08-18. Key commits: `89e2c93` TG-004R contracts · `04eb4e8`/`32bf0f2`/`238d15c`/`66069ae`/`2756d20` lane implementations · `d37d64f` 17:39 F1/F2 checkpoint · fix wave `19b111a` 17:59 → `8134197` 19:44. Working tree: 5 modified files (+275/−48), uncommitted.

**Databases (read before probing stopped):**
- `.tracegate/tracegate.db` — eval `01a05dfe…` 17:22:47 `failed`, runs 0–1 `completed/inconclusive`, released, no leaks; eval `01a05e0e…` 17:39:47 `completed`, run 0 `inconclusive`, failure `target_unavailable`@`connecting_browser`, 19,751 ms, 0 iterations/tool calls, evidenceHash `000…0`; both target `https://www.talon.ba`, prompt "navigate to the pricing and select the standard plan. expected routed URL should contain planId=12".
- `apps/web/tracegate-v2.db` — evals `01a05df5…` 17:12:50 `failed`, `01a05df8…` 17:16:34 `failed` (stranded by the CWD-relative `DATABASE_URL`).
- No `passed` outcome exists in either file.

**Session history (RepoPrompt, 2026-09-01):** coordinator `44F719C9` ("TraceGate: Independent Architecture Review", 73 turns/8.2 h) — 17:19 "Three-run Talon evaluation: not started"; 17:34 "No Talon-specific logic … will enter the runtime"; 17:45 "Ran three real isolated sessions; all sessions were released. Honest functional result: **3/3 INCONCLUSIVE** … navigation still exceeded the 15-second deadline…". Investigations `262A1019` (Solari no-action), `D3932B8A` (Agent C: `Tool timeout exhausted`, runs 15,048/15,093 ms). Fix sessions `E40AC09E`, `3B55EDA0`, `3503C35D`, `451B5969` (3–6 min each) map 1:1 to the five uncommitted files. `47136AE3` (Agent D Talon URL criteria, 53 turns). No post-fix evaluation session exists.

**Assertion-provenance spot-check:** repo-wide search for `talon` → 0 hits in tracked sources; `planId` → 1 hit, a UI placeholder (`routes/index.tsx:159`). The runtime promise held; the copy promise (M1) did not.
