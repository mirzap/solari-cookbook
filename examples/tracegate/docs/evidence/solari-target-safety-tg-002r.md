# TG-002R — Solari generic-target safety feasibility

**Date:** 2026-09-01

**Plan authority:** `docs/plans/tracegate-poc-build-2026-09-01.md` at `dbce78d16fc49a8d4194e964079c1d11a801c1f6`

**Owner:** Agent B

**Terminal result:** **BLOCKED**

TG-002R is a disposable feasibility/vendor-capability probe. It creates no TG-008 production acceptance credit.

## Terminal blocker

The measured installed Solari Browser SDK/API/account surfaces did not expose or demonstrate either mandatory enforcement mechanism:

1. no provider-side policy API was available to observe and deny the actual destination IP:port before connection for every browser/browser-process context; and
2. no supported option was available to force the entire remote browser process through a TraceGate-controlled outbound proxy.

Playwright/CDP URL routing successfully blocked several controlled HTTP/WebSocket probes, and a response exposed a remote IP:port after connection. Neither result counts as actual-destination enforcement under the V2 plan.

A second independent stop condition also failed: the measured SDK/API/account surfaces exposed no session inventory or create-attempt correlation mechanism capable of reconciling an ambiguous unidentified browser create without retrying it.

V2 P0 and TG-008 must remain stopped.

## Environment and secret handling

- Node: `v26.1.0`
- pnpm: `12.0.0`
- cloudflared: `2026.8.3`
- `@solarisdk/browser`: `0.1.2`
- `playwright-core`: `1.62.1`
- `.env`: present; `SOLARI_API_KEY`: present
- Credentials, CDP endpoints, provider session IDs, tunnel URLs, resolved IPs, and canary capability URLs were never printed or written to evidence.
- The controlled HTTPS canary URL existed only in probe-process memory. The tunnel and loopback server were stopped in `finally`.

## Reviewed probe

Path:

```text
packages/solari/probes/tg-002r-probe.mjs
```

The probe:

- starts a loopback-only controlled canary;
- starts a Cloudflare Quick Tunnel as a child process, retains its URL only in memory, and verifies the controlled canary before consuming a Solari create attempt;
- configures Solari with `maxAttempts: 1`;
- counts actual SDK `POST /sessions` calls without logging request headers or bodies;
- connects to real Solari over CDP;
- attempts a fresh non-persistent context with `serviceWorkers: "block"`;
- installs context-wide HTTP and WebSocket interception before creating the test page;
- distinguishes passive baseline events from a bounded causal action window;
- exercises only the controlled canary;
- closes controller/context, positively releases every acknowledged session, and stops the tunnel/server in `finally`;
- prints only redacted booleans, counts, HTTP status codes, and bounded blocker codes.

## Commands

Commands were run from `examples/tracegate/` with the pinned Node binary added to `PATH`.

```bash
node --version
pnpm --version
cloudflared --version
node --check packages/solari/probes/tg-002r-probe.mjs
node packages/solari/probes/tg-002r-probe.mjs
```

Account/API shape checks were credentialed in memory and printed only response status and top-level response shape:

```text
GET /health
GET /sessions
GET /sessions/capabilities
GET /network-policies
GET /proxy-countries
```

A one-attempt custom-proxy negative create used a non-routable `.invalid` proxy sentinel. It printed only acknowledgement/status/release booleans.

## Installed SDK/API/account capability findings

### Provider-side destination policy

**Not exposed or demonstrated on the measured surfaces.**

The installed `CreateSessionOptions` exposes profile, recording, stealth, captcha, Web Bot Auth, and Solari-managed proxy selection. It has no destination-policy, IP/port allowlist, pre-connect decision callback, egress firewall, custom proxy server, or request-policy field.

The normalized managed proxy result contains country/tier/timezone confirmation only. It does not expose or configure a TraceGate-controlled proxy.

Account endpoint shape results:

| Probe | Result |
|---|---|
| `GET /health` | 200; pool health only |
| `GET /sessions` | 404; no inventory |
| `GET /sessions/capabilities` | 404 |
| `GET /network-policies` | 404 |
| `GET /proxy-countries` | 404 on the probed account/API surface |

These negative endpoint-shape probes do not prove that no equivalent provider API exists outside the installed SDK or documented/measured account surface. They prove that TG-002R cannot currently configure or verify one.

### Forced TraceGate-controlled proxy

**Not accepted or demonstrated on the measured account surface.**

A one-attempt create using a non-routable `.invalid` custom proxy URL was rejected with HTTP 400. No session was acknowledged. No retry occurred. The 400 alone does not distinguish an unsupported field from a recognized but invalid proxy configuration; either interpretation leaves no supported, working forced-proxy path demonstrated for this account.

This was a negative configuration probe only. No proxy capability URL or third-party endpoint was contacted or retained.

### Ambiguous-create inventory/correlation

**Not exposed or demonstrated on the measured surfaces.**

- The installed `SessionsResource` has create, release, replay, and download operations, but no list/get/reconcile-by-attempt operation.
- `GET /sessions` returned 404.
- No create correlation ID, inventory endpoint, or provider reconciliation handle was returned or accepted by the installed SDK surface.
- Browser create retries were explicitly disabled for TG-002R. This avoids creating ambiguity in the successful probe but does not solve transport-timeout ambiguity.

Therefore an unidentified ambiguous create cannot be reconciled under measured provider semantics, which independently blocks TG-002R.

## Real Solari results

The corrected final coverage run reported:

| Measurement | Result |
|---|---:|
| SDK create attempts configured | 1 |
| observed HTTP create calls | 1 |
| acknowledged sessions | 1 |
| positively released sessions | 1 |
| positive release status | 204 |
| deliberate invalid release status | 404 |
| invalid 404 rejected as failure | yes |
| fresh non-persistent context created | yes |
| post-response remote IP:port observable | yes |
| pre-connect actual IP:port observable | **no** |

Two full coverage runs completed while correcting measurement of service-worker suppression and non-idempotent canary hits. Two later hardened reruns stopped at `main_navigation`; both still completed positive cleanup. Across all credentialed normal-create runs:

- normal create runs: 4;
- HTTP create calls: 4, exactly one per run;
- acknowledged sessions: 4;
- explicit positive releases: 4/4, all HTTP 204;
- unconfirmed acknowledged sessions: 0;
- potential acknowledged-session leaks: 0;
- custom-proxy negative create attempts: 1;
- sessions acknowledged by the custom-proxy attempt: 0.

After a controlled tunnel-readiness gate was added, three additional executions stopped before provider create because their fresh Quick Tunnels never served the controlled canary. The final bounded diagnostic observed 20/20 client/network-layer `TypeError` failures with no HTTP response. Each such execution recorded zero SDK create calls, zero acknowledged sessions, and therefore no release obligation. This external Quick Tunnel failure does not change the earlier real-Solari capability findings.

The invalid release sentinel returned HTTP 404 and the SDK rejected it. A 404 was never counted as cleanup success.

## Fresh context and service-worker result

A fresh non-persistent browser context was successfully created over real Solari CDP with `serviceWorkers: "block"` before the canary page.

The page's service-worker registration promise resolved, but:

- browser-context service-worker count remained zero;
- `navigator.serviceWorker.getRegistrations()` returned zero;
- the controlled `/sw.js` canary received zero requests.

For this controlled case, service-worker script/registration activity was effectively suppressed. This does not supply browser-process actual-destination enforcement and does not make TG-002R pass.

## Request and causal-attribution feasibility

The controlled final run observed:

- five blocked passive/baseline routed requests;
- four blocked requests/WebSocket attempts inside the explicit causal action window;
- controlled POST fetch, POST XHR, and beacon paths received zero canary hits;
- the controlled WebSocket server received zero upgrade requests;
- invalid/non-idempotent bodies could be classified and aborted before the controlled HTTP canary.

This proves feasibility for the routed request classes only. It does not prove destination enforcement, browser-process coverage, semantic backend reversibility, or complete causal attribution for unobservable traffic.

## Coverage matrix

`URL observable` means Playwright/CDP surfaced a URL or event. It does **not** mean the actual destination was known before connection.

| Context | URL/event observable | Controlled block observation | Pre-connect actual IP:port enforced | Result |
|---|---|---|---|---|
| Main frame | yes | allowed canary reached | no | STOP |
| Subframe | yes | controlled denied path did not reach canary | no | STOP |
| Redirect hops | yes | controlled redirect completed | no | STOP |
| fetch/XHR | yes | controlled POST/body paths did not reach canary | no | STOP |
| EventSource | yes | controlled denied path did not reach canary | no | STOP |
| Beacon | yes | controlled denied path did not reach canary | no | STOP |
| WebSocket | yes | controlled upgrade did not reach canary | no | STOP |
| WebTransport/QUIC | CDP creation event only | block-before-transmission not proven | no | STOP |
| WebRTC/STUN/TURN/data channel | no safe controlled UDP/TURN canary available | unobservable | no | STOP |
| Dedicated/shared workers | worker-originated controlled fetch was not reliably route-observable | no canary hit, but block-before-transmission not proven | no | STOP |
| Service worker | registration/script suppression observed in fresh context | controlled `/sw.js` received no hit | browser-process destination enforcement absent | STOP |
| Speculation/prefetch | partially observable | at least one controlled speculative/prefetch path was not proven blocked | no | STOP |
| Popup/new window | not reliably route-observable in the probe | no canary hit in final run, but denial provenance unproven | no | STOP |
| Download | not route-observable in the probe | controlled download endpoint was reached | no | STOP |
| External protocol | safely not activated | unobservable without an enforced boundary | no | STOP |
| Browser-process DNS/update/telemetry/certificate/captive-portal traffic | no | unobservable | no | STOP |

Because at least one required context was unobservable, the V2 stop rule applies. In fact, no allowed HTTP context exposed the actual destination before connection.

## What did not count

The following measured facts were explicitly rejected as TG-002R proof:

- canonical URL/origin validation;
- Playwright `context.route()` or CDP Fetch interception;
- a canary receiving no request after a URL-based abort;
- `Response.serverAddr()` after connection;
- CDP `Network.responseReceived` remote IP data;
- ordinary DNS preflight;
- Cloudflare tunnel reachability;
- Solari's managed country/tier proxy feature.

## Required provider/account action

TG-002R can be resumed only after Solari supplies and enables both:

1. **Enforced outbound boundary:** either a provider-side policy API or a supported forced custom-proxy configuration covering the entire browser process, with a pre-connect allow/deny decision over actual IP:port and protocol for every §5.2 context, including UDP/WebRTC/WebTransport and browser-process traffic. The boundary must prevent direct/proxy bypass and provide bounded non-sensitive denial evidence.
2. **Ambiguous-create reconciliation:** provider inventory or safe attempt-correlation semantics that can determine whether a timed-out/disconnected create produced a session and, if it did, identify and positively release it without retrying create.

Positive release confirmation already works for acknowledged valid sessions and must remain HTTP 2xx/204. HTTP 404 must continue to be treated as failure.

Until both capabilities are measured on the real account, the exact terminal status is:

```text
TG-002R = BLOCKED
TG-006R = BLOCKED
TG-008 = NOT AUTHORIZED
```
