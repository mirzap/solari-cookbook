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

Initial configured MCP support is deliberately narrow: MCP Streamable HTTP on explicit loopback HTTP or public-hostname HTTPS, no URL credentials/query secrets, no authentication headers, explicit endpoint and selected-tool configuration, a separate local sanitized admitted/denied tool decision, per-run client cleanup, read-only admitted tools, bounded closed inputs/results, and semantic fallback. Every request receives best-effort hostname/address admission, but DNS is not connection-pinned. Server read-only annotations are only untrusted hints; raw MCP schemas and results remain untrusted. Authenticated enterprise MCP is deferred. A bounded manual gate passed against a real loopback Streamable HTTP fixture with deterministic public-DNS and transport stubs; it did not validate an external public or authenticated MCP server.

## Interfaces TraceGate evaluates

Agent-usable paths implemented in the POC:

- semantic and accessibility UI;
- page-provided WebMCP;
- developer-configured MCP.

Implementation does not imply live availability in every managed browser. The bounded page-WebMCP provider gate did not expose `document.modelContext`, so invocation and result sanitization remain externally blocked and unverified; semantic fallback completed and was graded only from fresh browser evidence. Configured-MCP validation is limited to the bounded manual fixture described above.

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

Production package composition, migration/check, and the bounded safe built-server gates pass. F3 now includes a bounded live-provider API PASS and a separately observed live UI run that remained honestly INCONCLUSIVE; F4 passed three independent concurrent runs with run-scoped evidence attribution, deterministic 3/3 PASS aggregation, acknowledged session release, and no leaks. Queue rejection without artifacts, terminal hard reload, redaction, and configured-MCP manual validation also pass within their documented limits. Page WebMCP remains externally unavailable and unverified, with semantic fallback proven instead.

F5 is not closed. The cancellation API and UI exist, but the runtime scheduler currently reports acceptance through a synchronous boolean after only an in-memory abort. HTTP 202 can therefore precede the durable `running → cancelling` transition. The required next handoff is an awaited D-owned scheduler cancellation contract; A can then make the durable compare-and-set the acceptance point and reconcile executor terminalization without fabricating a grade. Running-state reload and a live UI cancellation also remain unobserved. Until that ordering fix lands and one final bounded cancellation validation confirms persistence, independent cleanup, release, and reload behavior, the cancellation validation workstream is not ready.
