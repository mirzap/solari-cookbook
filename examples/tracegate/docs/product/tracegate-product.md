# TraceGate product compass

TraceGate tells developers whether their app or public site is ready for the agent era: **can agents use it reliably?**

A developer describes an outcome-oriented task and observable success criteria. TraceGate repeats the task in independent browser sessions, verifies the final browser-observable result without asking the model whether it succeeded, explains where unsuccessful runs diverged, and measures which interfaces the agent discovered and used.

## What a developer configures

- a public HTTPS start URL and exact allowed navigation origins;
- a bounded natural-language task;
- deterministic URL, text, semantic, and state assertions;
- model, run count, concurrency, and practical safety options;
- interface strategy: automatic, semantic-only, or MCP-preferred;
- optional page WebMCP and explicitly configured unauthenticated MCP endpoints.

Initial configured MCP support is deliberately narrow: MCP Streamable HTTP on loopback HTTP or HTTPS, no URL credentials/query secrets, no authentication headers, explicit endpoint and selected-tool configuration, a separate local sanitized admitted/denied tool decision, per-run client cleanup, read-only admitted tools, bounded closed inputs/results, and semantic fallback. Server read-only annotations are only untrusted hints; raw MCP schemas and results remain untrusted. Authenticated enterprise MCP is deferred.

## Interfaces TraceGate evaluates

- semantic and accessibility UI;
- page-provided WebMCP;
- developer-configured MCP;
- `llms.txt`;
- JSON-LD;
- visual fallback when semantic structure is insufficient.

Page content, accessibility semantics, WebMCP metadata, MCP metadata, and tool results are untrusted. They can help an agent navigate or retrieve information, but they do not authorize unsafe effects and never grade a run directly.

## What TraceGate reports

- repeatability across independent sessions;
- deterministic PASS, FAIL, INCONCLUSIVE, or CANCELLED outcomes;
- the assertion evidence behind each result;
- failure phase and safe explanation;
- interface discovery, admission, invocation, success, and failure counts;
- model/tool/browser usage, duration, cleanup, and practical limitations.

A **PASS** proves only that all declared browser-observable assertions were true in the accepted fresh evidence capture. It does not prove arbitrary backend business truth.

## Product safety boundary

TraceGate supports anonymous, bounded, observable public-site tasks. It blocks obvious authentication, credential, financial, purchasing, messaging/publication, destructive, upload/download, permission, and irreversible-submit actions. Unknown or unobservable effects are denied. Provider-grade whole-browser egress confinement, perfect DNS-rebinding prevention, authenticated enterprise MCP, and backend truth verification are deferred hardening—not hidden product claims.

Demo Store is a test fixture only. Production evaluation, grading, and reporting must remain independent of it.
