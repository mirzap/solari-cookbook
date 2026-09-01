import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"

import { SolariClient } from "@solarisdk/sdk"

export type ConnectivityProvider = "tunnel" | "sandbox"

export interface ConnectivityTarget {
  provider: ConnectivityProvider
  publicBaseUrl: URL
  adminBaseUrl: URL
  adminSecret: string
  close(): Promise<void>
}

function cleanBaseUrl(raw: string, name: string, httpsRequired: boolean): URL {
  const url = new URL(raw)
  if (httpsRequired && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use HTTP(S)`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`)
  }
  return url
}

function isLoopbackHost(url: URL): boolean {
  return (
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]"
  )
}

export function createTunnelTargetFromEnv(
  env: NodeJS.ProcessEnv,
): ConnectivityTarget {
  const publicUrl = env.DEMO_PUBLIC_URL
  const adminUrl = env.DEMO_ADMIN_URL
  const adminSecret = env.DEMO_ADMIN_SECRET
  if (!publicUrl || !adminUrl || !adminSecret) {
    throw new Error(
      "Tunnel mode requires DEMO_PUBLIC_URL, DEMO_ADMIN_URL, and DEMO_ADMIN_SECRET",
    )
  }
  if (Buffer.byteLength(adminSecret, "utf8") < 16) {
    throw new Error("DEMO_ADMIN_SECRET must be at least 16 bytes")
  }

  const publicBaseUrl = cleanBaseUrl(publicUrl, "DEMO_PUBLIC_URL", true)
  const adminBaseUrl = cleanBaseUrl(adminUrl, "DEMO_ADMIN_URL", false)
  if (!isLoopbackHost(adminBaseUrl)) {
    throw new Error("Tunnel DEMO_ADMIN_URL must use a loopback host")
  }

  return {
    provider: "tunnel",
    publicBaseUrl,
    adminBaseUrl,
    adminSecret,
    async close() {},
  }
}

async function waitForSandboxTarget(url: URL): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(new URL("/__connectivity", url), {
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) return
    } catch {
      // The preview and guest process both become ready asynchronously.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error("Sandbox preview did not become reachable")
}

export async function createSandboxTarget(
  apiKey: string,
): Promise<ConnectivityTarget> {
  const client = new SolariClient({ apiKey })
  const sandbox = await client.sandboxes.create({
    template: "base",
    timeoutMs: 5 * 60_000,
    metadata: { purpose: "tracegate-tg002-connectivity" },
  })
  let closed = false

  try {
    await sandbox.connect()
    const artifactRoot = new URL(
      "../../../apps/demo/dist/",
      import.meta.url,
    )
    const [serverSource, connectivitySource] = await Promise.all([
      readFile(new URL("server.js", artifactRoot), "utf8"),
      readFile(new URL("__connectivity.js", artifactRoot), "utf8"),
    ])

    await sandbox.files.mkdir("/tmp/tracegate-demo")
    await Promise.all([
      sandbox.files.write("/tmp/tracegate-demo/server.js", serverSource),
      sandbox.files.write(
        "/tmp/tracegate-demo/__connectivity.js",
        connectivitySource,
      ),
      sandbox.files.write(
        "/tmp/tracegate-demo/package.json",
        '{"type":"module"}\n',
      ),
    ])

    const adminSecret = randomBytes(32).toString("base64url")
    await sandbox.commands.start("node", {
      args: ["/tmp/tracegate-demo/server.js"],
      cwd: "/tmp/tracegate-demo",
      env: {
        DEMO_ADMIN_SECRET: adminSecret,
        HOST: "0.0.0.0",
        PORT: "4317",
      },
    })

    // The returned preview URL is a bearer capability in some deployments.
    // It stays in memory and is never printed or persisted by this package.
    const preview = await sandbox.previewUrl(4317)
    const previewUrl = new URL(preview.url)
    await waitForSandboxTarget(previewUrl)

    return {
      provider: "sandbox",
      publicBaseUrl: previewUrl,
      adminBaseUrl: previewUrl,
      adminSecret,
      async close() {
        if (closed) return
        closed = true
        await sandbox.kill()
      },
    }
  } catch (error) {
    if (!closed) {
      closed = true
      await sandbox.kill().catch(() => {})
    }
    throw error
  }
}

export async function prepareConnectivityTarget(
  provider: ConnectivityProvider,
  apiKey: string,
  env: NodeJS.ProcessEnv,
): Promise<ConnectivityTarget> {
  return provider === "sandbox"
    ? createSandboxTarget(apiKey)
    : createTunnelTargetFromEnv(env)
}
