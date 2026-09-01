# TG-001 — Runtime/workspace preflight evidence

- **Recorded:** 2026-09-01
- **Branch:** `tracegate-poc-submission`
- **Scope:** TG-001 only
- **Status:** **PASS**
- **Corepack:** not required or used

No feature package implementation or TG-002+ work was created. The production-shaped smoke sources and build outputs were temporary and moved to `/tmp/tracegate-tg001-build-20260901101356` after verification.

## Selected exact runtime

```text
Node.js:    26.1.0
pnpm:       12.0.0
TypeScript: 7.0.2
Turbo:      2.10.12
```

`pnpm` is the globally installed binary:

```bash
command -v pnpm
pnpm --version
```

```text
/Users/mirzap/Library/pnpm/bin/pnpm
12.0.0
```

Registry checks confirmed `pnpm@12.0.0` is a published non-prerelease version, has no deprecation marker, and supports Node `>=18.*`. The workspace pins the exact installed version:

```json
"packageManager": "pnpm@12.0.0"
```

The initially considered integrity-suffixed form was rejected by Turbo's `packageManager` parser because the base64 integrity contains unsupported characters. Removing the optional integrity suffix while retaining exact version `12.0.0` fixed the measured failure.

## Exact package pins

All 22 direct dependency values are exact semantic versions. No caret, tilde, wildcard, npm tag, or floating range is present.

| Area | Package | Version |
|---|---|---:|
| TypeScript | `typescript` | `7.0.2` |
| Turbo | `turbo` | `2.10.12` |
| TanStack Start | `@tanstack/react-start` | `1.168.49` |
| TanStack Router | `@tanstack/react-router` | `1.170.32` |
| TanStack Query | `@tanstack/react-query` | `5.102.8` |
| TanStack AI | `@tanstack/ai` | `0.52.0` |
| TanStack AI React | `@tanstack/ai-react` | `0.22.4` |
| TanStack AI OpenRouter | `@tanstack/ai-openrouter` | `0.19.5` |
| React | `react` | `19.2.8` |
| React DOM | `react-dom` | `19.2.8` |
| Zod | `zod` | `4.5.4` |
| Drizzle ORM | `drizzle-orm` | `0.45.2` |
| Drizzle Kit | `drizzle-kit` | `0.31.10` |
| libSQL client | `@libsql/client` | `0.17.4` |
| Solari Browser | `@solarisdk/browser` | `0.1.2` |
| Solari SDK/Sandbox | `@solarisdk/sdk` | `0.1.2` |
| Playwright CDP | `playwright-core` | `1.62.1` |
| Vite | `vite` | `8.2.2` |
| Vite React plugin | `@vitejs/plugin-react` | `6.1.1` |
| Node types | `@types/node` | `26.4.0` |
| React types | `@types/react` | `19.2.18` |
| React DOM types | `@types/react-dom` | `19.2.5` |

## pnpm 12 workspace policy

pnpm 12 keeps build/store policy in `pnpm-workspace.yaml`.

```yaml
storeDir: .pnpm-store

allowBuilds:
  '@openrouter/sdk': false
  esbuild: true

minimumReleaseAgeExclude:
  - '@solarisdk/browser@0.1.2'
```

- `esbuild` postinstall is explicitly allowed because the selected Vite/Drizzle toolchain requires its platform binary.
- `@openrouter/sdk`'s nonessential postinstall is explicitly denied; its shipped runtime imports successfully.
- The exact Solari Browser version is explicitly allowed through pnpm 12's release-age gate.
- The store resolves to `examples/tracegate/.pnpm-store/v11`; no store or workspace configuration was added at cookbook root.

## Install and lockfile

Commands:

```bash
cd examples/tracegate
pnpm install
pnpm install --frozen-lockfile
pnpm list --depth 0
```

Measured results:

```text
Packages: +167
22 exact direct devDependencies installed
esbuild@0.18.20 postinstall: Done
esbuild@0.25.12 postinstall: Done
esbuild@0.28.2 postinstall: Done
Done using pnpm v12.0.0
Lockfile passes supply-chain policies (294 entries)
Lockfile is up to date, resolution step is skipped
```

Lockfile:

```text
lockfileVersion: '9.0'
SHA-256: 373ebaddbbd8a2823aeaa165539c0a0ebc3822378b617fcba4ab86bdaeac7385
```

## Runtime probe

Command:

```bash
pnpm probe:runtime
```

Result:

```text
v26.1.0
12.0.0
Version 7.0.2
2.10.12
drizzle-kit: v0.31.10
drizzle-orm: v0.45.2
vite/8.2.2 darwin-arm64 node-v26.1.0
```

## Real workspace typecheck and build smoke

A temporary project inside `examples/tracegate/.tg001-smoke/` extended `tsconfig.base.json` and imported the intended application surfaces:

```text
Client: React, React DOM, TanStack Start/Router/Query/AI React, Zod
Server: libSQL, Drizzle/libSQL, Solari Browser/SDK, TanStack AI/OpenRouter,
        TanStack Start Vite plugin, Playwright Core
```

Commands:

```bash
pnpm exec tsc --project .tg001-smoke/tsconfig.json --noEmit
pnpm exec vite build .tg001-smoke --outDir /tmp/tracegate-tg001-build-20260901101356/client-final --emptyOutDir
pnpm exec vite build --ssr .tg001-smoke/server.ts --outDir /tmp/tracegate-tg001-build-20260901101356/server-final --emptyOutDir
pnpm exec turbo run build --dry=json
pnpm build
```

Results:

```text
TypeScript workspace smoke: exit 0
Browser Vite build: 352 modules transformed; exit 0
SSR Vite build: 2 modules transformed; exit 0
Turbo configuration parsed with pnpm@12.0.0; exit 0
Root build command: exit 0 (0 feature packages exist at TG-001)
```

The temporary `.tg001-smoke` directory was moved out of the workspace after the pass. No smoke source or build output is part of the judged tree.

## Practical compiler boundary

`tsconfig.base.json` uses TypeScript `7.0.2`, strict project checking, and `skipLibCheck: true`. This accepts the package ecosystem at its normal declaration boundary while still strictly checking TraceGate-owned source. The real workspace smoke above passed; no TypeScript fallback or dependency patch was needed.

## Actual measured corrections

1. `pnpm install --strict-peer-dependencies` is not a pnpm 12 CLI option; workspace policy was used instead.
2. pnpm 12 build scripts require explicit allow/deny policy; `esbuild` was allowed and the nonessential OpenRouter SDK postinstall was denied.
3. The integrity-suffixed `packageManager` string failed Turbo parsing; exact `pnpm@12.0.0` passed.
4. pnpm's default store location initially resolved at cookbook root; pnpm 12-native `storeDir` in `pnpm-workspace.yaml` moved it under `examples/tracegate/`.

No unresolved runtime, install, typecheck, build, or lockfile blocker remains for TG-001.

## Redaction review

No API key, GitHub token, authorization header, Solari capability, CDP endpoint, replay URL, challenge token, or private registry credential is present.
