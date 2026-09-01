# TG-002 — Solari/connectivity/entitlement spike evidence

- **Recorded:** 2026-09-01
- **Scope:** TG-002 only
- **Status:** **PASS**
- **Selected connectivity provider:** HTTPS Cloudflare Quick Tunnel
- **Remote runtime:** real Solari Browser over CDP; no local Playwright substitution
- **Redaction:** no API key, session ID, CDP endpoint, admin secret, tunnel capability URL, or replay URL is stored in source or this evidence

## Acceptance result

A real Solari Browser loaded the temporary semantic `__connectivity` form through an HTTPS Cloudflare tunnel, submitted it, and caused exactly one server-state mutation. A separate server-to-server admin read over loopback verified the revision change. Recording was accepted, replay finalized after release, five Browser sessions were held simultaneously without a limit response, and every acknowledged Browser session received a confirmed release.

```text
TG-002 result:                         PASS
provider:                              tunnel
public transport:                      HTTPS
public/admin origins:                  separate
semantic form loaded:                  yes
server mutation revision delta:        1
server-to-server admin confirmation:   yes
acknowledged Browser sessions:         6
release attempts:                      6
release confirmations:                 6
unaccounted Browser sessions:          0
```

Full Classic Tee/cart behavior, semantic refs, broad discovery, and WebMCP remain TG-008+ and were not implemented here.

## Runtime and prerequisites

Presence was checked without printing values:

```bash
node --env-file=.env -e '<print set/unset status only>'
command -v cloudflared
cloudflared --version
```

Measured result:

```text
SOLARI_API_KEY: set
DEMO_ADMIN_SECRET: unset (generated fresh in process memory for each attempt)
cloudflared path: /opt/homebrew/bin/cloudflared
cloudflared: 2026.8.3 (2026-08-31 build)
Node.js: 26.1.0
@solarisdk/browser: 0.1.2
@solarisdk/sdk: 0.1.2
playwright-core: 1.62.1
observed working-tree lock SHA-256: c4b24304eca44c87145d82c2b57595f0d5fed7460c5d8337ee4e214e90ff356e
```

The ignored `.env` file was read with Node's `--env-file` support. Its contents were never printed, copied, or persisted.

## Redacted exact command shape

The final proof used the following command sequence. Angle-bracketed values were ephemeral in-memory values and are intentionally omitted:

```bash
# Build directly with the pinned compiler; do not invoke install or regenerate the lockfile.
node ./node_modules/typescript/bin/tsc --project apps/demo/tsconfig.build.json
node ./node_modules/typescript/bin/tsc --project packages/solari/tsconfig.build.json

ADMIN_SECRET="$(openssl rand -hex 32)"

DEMO_ADMIN_SECRET="$ADMIN_SECRET" HOST=127.0.0.1 PORT=4317 \
  node apps/demo/dist/server.js

cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4317

DEMO_CONNECTIVITY_PROVIDER=tunnel \
DEMO_PUBLIC_URL='<ephemeral HTTPS Quick Tunnel origin>' \
DEMO_ADMIN_URL='http://127.0.0.1:4317' \
DEMO_ADMIN_SECRET="$ADMIN_SECRET" \
SOLARI_PROBE_MAX_CONCURRENCY=5 \
  node --env-file=.env packages/solari/dist/connectivity-probe.js
```

The demo, tunnel, and probe ran under one guarded shell. An `EXIT`/`INT`/`TERM` trap terminated both processes, waited for them, and cleared the shell secret after the probe.

## Connectivity and lifecycle measurements

```text
local demo ready:                      yes
tunnel registered:                    yes
tunnel origin shape:                  HTTPS *.trycloudflare.com, no query
host fetch through tunnel:             HTTP 200
Solari create:                         932 ms
CDP connectOverCDP:                    1,208 ms
navigate + form submit + admin verify: 5,265 ms
releaseAndWait:                        469 ms
second release:                        confirmed idempotent
probe exit:                            0
```

The CDP capability was read only from the in-memory Solari create response and passed directly to `chromium.connectOverCDP`. The probe output contains no session identifier or endpoint.

## Concurrency measurement

The probe acquired Browser sessions sequentially and held them concurrently until the bounded ceiling or a real `429 ConcurrencyLimitExceeded` response. It then released all held sessions in `finally`.

```text
attempted ceiling:       5
simultaneously held:     5
limit response observed: no
measured entitlement:    at least 5 (lower bound, not an exact account maximum)
selected safe app cap:   5 (the EvaluationConfig maximum)
```

No claim is made that the account maximum is exactly five. The product-level scheduler must still degrade on a future real `429`.

## Recording and replay

```text
recording requested:         yes
recording accepted:          yes
replay state:                ready
poll attempts after release: 1
replay ready latency:        3,214 ms
```

The presigned replay URL was parsed only to confirm HTTPS and positive expiry, then immediately discarded. It was never printed, returned in probe JSON, written to SQLite, committed, or added to evidence.

## Cleanup accounting

```text
primary connectivity/recording Browser: 1 acknowledged, 1 released
concurrency Browser sessions:            5 acknowledged, 5 released
total acknowledged:                      6
release attempts:                        6
release confirmations:                   6
unaccounted:                             0
```

The primary session was released before replay polling and capacity measurement. Concurrency sessions were released in the measurement `finally`; the outer ledger retried any remaining unconfirmed release before exit. The quick tunnel and local demo were also terminated by the guarded shell.

## Admin-route and fixture verification

Local automated tests verify:

- semantic form, submit button, and live status shape;
- bounded form POST and exactly one revision increment;
- authenticated server-to-server admin read;
- indistinguishable `404` for missing authorization and browser-shaped `Origin` or navigation requests;
- HTTPS-only public tunnel origin;
- loopback-only tunnel admin origin;
- rejection of credential/query/fragment-shaped public URLs.

Final local verification, run without pnpm lock synchronization:

```text
demo tests:   3 passed, 0 failed
Solari tests: 4 passed, 0 failed
typecheck:    passed for both owned packages
```

## Attempt history and external behavior

1. The first quick-tunnel host fetch encountered sandbox DNS restrictions. No Solari session was created; the trap terminated the demo/tunnel.
2. The first escalated attempt registered a healthy QUIC tunnel but the local hostname had not propagated before the bounded host precheck ended. No Solari session was created; teardown completed.
3. The final escalated attempt registered the tunnel, returned host HTTP 200, and completed the real Solari proof above.

During the first sandboxed host precheck, curl emitted the ephemeral quick-tunnel hostname in tool stderr before teardown despite the intended redaction. That tunnel was immediately terminated, the hostname carried no query token, and it was not written to repository files or evidence. Subsequent attempts suppressed URL-bearing curl stderr.

## Capability selection

`DemoConnectivityProvider` is frozen to **tunnel** for the current PoC environment:

- real DNS/TLS/browser render/mutation proof passed;
- admin reads remain on loopback and are not tunneled;
- measured end-to-end mutation/admin confirmation completed in 5,265 ms;
- one-Sandbox fallback was not needed and was not provisioned.

## Lane and lockfile accounting

All source changes are within Agent B-owned `apps/demo`, `packages/solari`, and this evidence file. No `packages/discovery` change was necessary for TG-002. No shared/root/C/D-owned source was edited.

An earlier pnpm 12 filtered verification auto-synchronized workspace importers in the Agent A-owned `pnpm-lock.yaml`, including concurrent lane manifests. Agent B did not manually edit or revert it. The successful real proof used direct Node/TypeScript commands and made no further lockfile change; Agent A remains the final lockfile owner.
