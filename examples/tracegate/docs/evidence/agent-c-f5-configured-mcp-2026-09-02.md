# Agent C F5 configured-MCP capability gate — 2026-09-02

## Decision

**PASS for the C-owned configured-MCP capability gate.** A temporary, unauthenticated, read-only Streamable HTTP MCP fixture was started on loopback and exercised through TraceGate's production `StreamableHttpConfiguredMcpClient`. The product form's explicit opt-in path produced the endpoint configuration; opt-out produced no configured endpoint. No real provider session, external write-capable MCP, automated test file, test suite, or test command was used.

One C-owned defect was found and fixed: oversized structured output was shortened by redaction before its size check and therefore remained bounded while incorrectly reporting `truncated: false`. The client now measures the original serialized structured content before redaction and reports truncation honestly.

All session identifiers, the ephemeral port, fixture request bodies, and synthetic secrets are omitted from this evidence.

## Manual fixture and product path

The manual harness existed only at `/tmp/tracegate-f5-configured-mcp-manual.mts`; it was not added to the repository. It imported:

- `createEvaluationRequestFromDraft(...)`, proving the product configuration path emits `configuredMcpEndpoints` only when `configuredMcpEnabled === true`;
- `ConfiguredMcpEndpointV1Schema`, preserving the product's unauthenticated Streamable HTTP endpoint contract;
- the production `StreamableHttpConfiguredMcpClient`;
- `GradeInputV2Schema` for grading-channel isolation inspection.

The local fixture exposed one declared read-only tool, `read_status`, and one write-declared tool, `write_data`. The read tool accepted a closed `mode` enum and returned synthetic data containing a false `PASS` claim and redaction canaries. The write tool performed no operation and was never invoked.

Public-address behavior used an injected deterministic DNS resolver and a non-network protocol response stub. This proved admission policy and request ordering without contacting a public MCP service.

## Commands and observed results

Working directory: `examples/tracegate`.

```bash
mise exec -- pnpm exec tsx /tmp/tracegate-f5-configured-mcp-manual.mts
```

Result: did not run because `tsx` is not exposed at the workspace root (`Command "tsx" not found`).

```bash
mise exec -- pnpm --filter @tracegate/agent exec tsx /tmp/tracegate-f5-configured-mcp-manual.mts
```

First result: the harness reached invocation and failed the oversized-output assertion. Output was bounded, but `truncated` was false. This exposed the production defect described above.

After the C-owned fixes, the identical command returned exit `0` and `gate: PASS` with 26 observed checks. The redacted aggregate was:

- temporary local sessions established: `4`;
- DELETE attempts observed: `4`;
- requests in the fully instrumented normal local lifecycle: `7`;
- session IDs, port, request bodies, and fixture secrets printed: `0`.

Production verification after the fix:

```bash
mise exec -- pnpm --filter @tracegate/agent typecheck
mise exec -- pnpm --filter @tracegate/agent build
mise exec -- pnpm --filter @tracegate/ai typecheck
mise exec -- pnpm --filter @tracegate/ai build
```

All four commands passed with exit `0`. The Agent package production build is its configured no-emit TypeScript build; the AI build ran its no-emit typecheck and emitting `tsconfig.build.json` build. No test command ran.

## Validated behavior

### Explicit configuration and loopback rule

- Product opt-out omitted `configuredMcpEndpoints`; therefore no configured-MCP request path existed.
- Product opt-in emitted exactly one `authentication: "none"`, `transport: "streamable-http"` endpoint with the explicitly selected tools.
- `http://localhost:<ephemeral>/mcp` was accepted only after every resolved address was classified loopback.
- A configured private HTTP endpoint was rejected by the endpoint schema before client/network use.
- HTTPS public mode rejected IP literals and did not call fetch.

### Admission before every request

The normal local lifecycle observed seven exact `admit → fetch` pairs:

1. `initialize`;
2. `notifications/initialized`;
3. `tools/list`;
4. first `tools/call`;
5. second `tools/call`;
6. deeply nested result `tools/call`;
7. `DELETE`.

The synthetic public lifecycle likewise observed `admit → fetch` immediately before initialize, notification, list, and DELETE. Static inspection found only three production fetch sites—POST, notification POST, and DELETE—and each calls `#admitDestination(...)` immediately beforehand.

### Public DNS decisions

For a syntactically valid public HTTPS hostname:

- nonempty IPv4/IPv6 answers classified entirely public were admitted;
- an empty answer set was denied before fetch;
- a private answer was denied before fetch;
- a reserved/documentation answer was denied before fetch;
- mixed public/private answers were denied before fetch;
- denials used bounded `unsafe_action_blocked` / `origin_not_admitted` facts and did not expose resolver errors or addresses.

No external public request was made; accepted public transport was represented by a local protocol stub after the injected resolver supplied the all-public set.

### Read-only admission, bounds, and trust

- Only `read_status` was admitted, with `trust: "untrusted_configured_mcp_capability"` and `admission: "locally_admitted_read_only"`.
- The write-declared tool was denied as `missing_read_only_declaration` and never invoked.
- An invocation containing an extra, non-schema field was rejected as a bounded policy denial before any request.
- Normal output carried `trust: "untrusted_configured_mcp_result"` and `redacted: true`; synthetic bearer/API-key canaries were absent from the returned value.
- Oversized structured content was replaced by a bounded summary and, after the fix, reported `truncated: true`.
- A deeply nested JSON result that overflowed ordinary serialization was conservatively classified as truncated and replaced by the same bounded summary rather than escaping as a native error.

### Cleanup and failure paths

- The normal established session received DELETE and closed successfully.
- Two sessions were established in one client; the fixture made the first DELETE fail and the second succeed. Both DELETE attempts were observed before one bounded aggregate cleanup error was returned.
- Client reuse after close was rejected before network access.
- A session was established, its read-only invocation was deliberately delayed past a 50 ms abort boundary, and the invocation returned the closed cancellation error. A subsequent bounded close still produced the session's DELETE attempt.
- Total temporary local sessions established and DELETE attempts observed were both four.

### Grading isolation

The MCP result deliberately contained `claimedGrade: "PASS"`. It remained inside `UntrustedConfiguredMcpResultV1`; `GradeInputV2Schema` rejected a configured-MCP result as an unrecognized grading input channel. Product composition was also inspected read-only: configured-MCP execution occurs in the agent safe-tool runtime, while grading consumes separately captured and committed browser assertion evidence. The fixture's claim never became grade input or grading truth.

## Review and limitations

- Oracle review confirmed the original-byte truncation fix, then identified a deep-nesting serialization edge. The final implementation catches that untrusted serialization failure and conservatively reports truncation; the expanded manual fixture passed.
- The production diff is limited to `packages/agent/src/configured-mcp-client.ts`; the evidence file is C-owned model/agent evidence.
- Shared classifiers, endpoint schemas, grading schemas, browser/page WebMCP code, UI, database, lockfile, and tests were not edited.
- DNS admission is best effort and repeated before every request, but lookup results are not pinned to the subsequent connection. DNS rebinding between lookup and connect remains an explicit limitation.
- No real public configured-MCP transport or provider session was used. The gate proves C-owned client behavior with actual loopback HTTP and deterministic public-DNS boundary injection, not provider-grade egress enforcement.
- Cleanup was observed at the HTTP boundary; it does not prove remote resource destruction beyond the fixture's response.
