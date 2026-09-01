# Solari public-site practical-safety smoke

**Date:** 2026-09-01

**Owner:** Agent B

**Probe:** `packages/solari/probes/public-site-safety-smoke.mjs`

**Terminal result:** **BLOCKED**

This is the bounded F1 public-site safety smoke. It is not F3 composition, does not use the Demo fixture, and does not claim whole-browser confinement.

## Secret and target handling

- `.env`: present; `SOLARI_API_KEY`: present (value never printed)
- cloudflared: `/opt/homebrew/bin/cloudflared`, version `2026.8.3`
- The controlled canary listened on loopback and was exposed through an ephemeral public HTTPS Quick Tunnel.
- Tunnel URL, hostname, resolved addresses, Solari session ID, CDP endpoint, API key, raw provider responses, transient canonical URL, and page content were not printed or persisted.
- The smoke emitted only booleans, counts, fixed limitation identifiers, error class, and closed safe/blocker codes.
- No unsafe request was sent to a third-party site. POST and service-worker checks targeted only the controlled canary.

## Command

```bash
PATH="$HOME/.local/share/mise/installs/node/26.1.0/bin:$PATH" \
  pnpm --filter @tracegate/solari smoke
```

The script builds the package, checks ignored credentials in memory, starts the controlled canary and Quick Tunnel, performs public DNS preflight, configures the provider for one create attempt, connects over CDP, requires a fresh service-worker-blocked context, performs controlled semantic/policy/evidence checks, and closes/releases in `finally`.

## Real Solari measurement

The first credentialed execution reached the real provider and controlled public HTTPS canary:

| Measurement | Result |
|---|---:|
| SDK create attempts configured | 1 |
| observed SDK create HTTP calls | 1 |
| acknowledged sessions | 1 |
| mandatory new context connected | yes |
| semantic observation captured | yes |
| all returned refs opaque/revision-scoped | yes |
| controlled passive POST reached canary | no |
| passive unsafe request block observed | yes |
| safe local disclosure action observed | yes |
| fresh repeated evidence accepted | no; stopped during capture |
| controller close attempted | yes |
| provider release attempted | yes |
| provider release confirmation | `confirmed_released` |
| acknowledged sessions potentially leaked | 0 |

The bounded failure was `smoke_internal:fresh_evidence`. Because the original run predated the later closed error-class fields, no additional cause is claimed. Later attempts did not reuse or retry that browser create.

## Subsequent bounded readiness attempts

Later executions stopped before provider creation because new Quick Tunnels did not serve the controlled readiness request. After the final policy/bounds review, the hardened script was run once more. It permits at most three pre-create tunnel attempts, computes `PASS` only after every controlled check plus controller close and confirmed provider release, and returns a nonzero exit for every blocked result. Its measured final result was:

| Measurement | Result |
|---|---:|
| tunnel attempts | 3 |
| tunnel readiness | blocked |
| SDK create HTTP calls | 0 |
| acknowledged sessions | 0 |
| release obligation | none |
| terminal/exit | `BLOCKED` / nonzero |
| blocker | `smoke_internal:tunnel` |

These pre-create failures consumed no Solari session and created no provider cleanup obligation. They do not erase the first run's real capability or cleanup facts. The final redacted output additionally reported `controlledSafetyChecksPassed: false`, `controllerCloseAttempted: false`, `releaseAttempted: false`, and `potentialSessionLeak: false`; no identifier, endpoint, capability URL, address, or secret was emitted.

## Cleanup ledger

Across this F1 smoke work:

- real normal create HTTP calls: **1**;
- acknowledged sessions: **1**;
- controller close attempts for acknowledged sessions: **1/1**;
- explicit provider release attempts: **1/1**;
- confirmed provider releases: **1/1**;
- unconfirmed acknowledged releases: **0**;
- known acknowledged-session leaks: **0**;
- later pre-create tunnel failures, including the final post-review run: zero acknowledged sessions.

A provider 404 is not counted as release success by the implementation. No 404 occurred for the acknowledged smoke session; its release was explicitly confirmed.

## Successfully measured controls

The real run measured only these controlled classes:

- public DNS answers passed the best-effort public-address preflight;
- Solari create was attempted once;
- a new Playwright context was created with service workers blocked and without default-context fallback;
- exact-origin target navigation reached the controlled public HTTPS site;
- bounded untrusted semantic observation and opaque revision refs were produced;
- a controlled passive POST was intercepted before reaching the canary;
- a safe, reversible local disclosure action changed browser-observable semantic state;
- every acknowledged session received controller close and provider release attempts.

Fresh evidence acceptance, later exact-origin rejection, controlled post-action blocking, and service-worker script-hit verification did not complete in the real run and receive no acceptance credit.

## Limitations and stop

The smoke and implementation explicitly retain:

- `no_provider_preconnect_ip_enforcement`;
- `dns_rebinding_not_fully_prevented`;
- `browser_process_traffic_not_fully_observable`.

Observable Playwright routing is practical defense in depth, not proof of complete browser egress confinement. Cross-origin GET/HEAD subresources and browser-process traffic are not fully controlled. A nominal GET can still have a backend effect. Lack of provider inventory means an unidentified ambiguous create can remain a potential leak, although no ambiguous create occurred in this smoke.

The current smoke remains **BLOCKED** pending:

1. a working public HTTPS tunnel (or another approved controlled public canary exposure); and
2. a fresh run that completes repeated canonical capture and the remaining controlled origin/action/service-worker checks.

No local Playwright run, Demo output, or historical TG-002/TG-002R result substitutes for that missing completion.
