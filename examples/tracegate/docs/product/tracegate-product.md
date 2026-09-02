# TraceGate product compass

TraceGate tells developers whether their app or public site is ready for the agent era: **can agents use it reliably?**

A developer describes an outcome-oriented task and observable success criteria. TraceGate repeats the task in independent browser sessions, verifies the final browser-observable result without asking the model whether it succeeded, explains where unsuccessful runs diverged, and measures which interfaces the agent discovered and used.

## What a developer configures

- a public HTTPS start URL and exact allowed navigation origins;
- a bounded natural-language task;
- deterministic URL, text, semantic, and state assertions;
- the single configured DeepSeek model, run count, concurrency, and practical safety options;
- interface strategy: automatic, semantic-only, or MCP-preferred;
- optional page WebMCP and explicitly configured unauthenticated MCP endpoints.

Initial configured MCP support is deliberately narrow: MCP Streamable HTTP on explicit loopback HTTP or public-hostname HTTPS, no URL credentials/query secrets, no authentication headers, explicit endpoint and selected-tool configuration, a separate local sanitized admitted/denied tool decision, per-run client cleanup, read-only admitted tools, bounded closed inputs/results, and semantic fallback. Every request receives best-effort hostname/address admission, but DNS is not connection-pinned. Server read-only annotations are only untrusted hints; raw MCP schemas and results remain untrusted. Authenticated enterprise MCP is deferred. Real configured-MCP provider validation has not yet been performed.

## Interfaces TraceGate evaluates

Agent-usable paths implemented in the POC:

- semantic and accessibility UI;
- page-provided WebMCP;
- developer-configured MCP.

Readiness signals detected for reporting only, and not provided to the agent:

- `llms.txt`;
- JSON-LD.

Visual fallback is not an implemented agent path in this version. Recording/replay and optional models are not presented as available capabilities without fresh verification.

Page content, accessibility semantics, WebMCP metadata, MCP metadata, and tool results are untrusted. They can help an agent navigate or retrieve information, but they do not authorize unsafe effects and never grade a run directly.

## What TraceGate reports

- repeatability across independent sessions;
- deterministic PASS, FAIL, INCONCLUSIVE, or CANCELLED outcomes;
- the assertion evidence behind each result;
- failure phase and safe explanation;
- interface discovery, admission, invocation, success, and failure counts;
- model/tool/browser usage, duration, cleanup, and practical limitations.

A **PASS** proves only that all declared browser-observable assertions were true in the accepted fresh evidence capture after an explicitly completed agent run. It does not prove arbitrary backend business truth. `policy_refused`, `blocked`, and `needs_input` dispositions are always INCONCLUSIVE; assertion truth or completion copy cannot turn them into success. The persisted deterministic grade is authoritative.

## Product safety boundary

TraceGate supports anonymous, bounded, observable public-site tasks. It blocks obvious authentication, credential, financial, purchasing, messaging/publication, destructive, upload/download, permission, and irreversible-submit actions. Unknown or unobservable effects are denied. Provider-grade whole-browser egress confinement, perfect DNS-rebinding prevention, authenticated enterprise MCP, and backend truth verification are deferred hardening—not hidden product claims.

Demo Store is a fixture only. Production evaluation, grading, and reporting must remain independent of it.

## Current readiness

Production package composition, clean migration/check, and safe built-server reads pass. Real Solari/OpenRouter sessions were intentionally not run in the current phase. The external validation workstream is **not ready**: concurrent runs with identical evidence hashes can currently collide in the D-owned grade-milestone binding, so F3/F4 remain blocked until that run-attribution defect and the remaining submission/readiness lifecycle risks are corrected and the production gate is rerun.
