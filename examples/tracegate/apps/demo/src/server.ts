import { createServer, type Server } from "node:http"
import { pathToFileURL } from "node:url"

import {
  ConnectivityState,
  handleConnectivityRequest,
} from "./__connectivity.js"

export interface ConnectivityServerOptions {
  adminSecret: string
  host?: string
  port?: number
}

export function createConnectivityServer(options: ConnectivityServerOptions): Server {
  if (Buffer.byteLength(options.adminSecret, "utf8") < 16) {
    throw new Error("DEMO_ADMIN_SECRET must be at least 16 bytes")
  }

  const state = new ConnectivityState()
  return createServer(async (request, response) => {
    try {
      if (
        await handleConnectivityRequest(
          request,
          response,
          state,
          options.adminSecret,
        )
      ) {
        return
      }
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      })
      response.end("Not found\n")
    } catch {
      response.writeHead(500, {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      })
      response.end("Internal server error\n")
    }
  })
}

async function main(): Promise<void> {
  const adminSecret = process.env.DEMO_ADMIN_SECRET
  if (!adminSecret) throw new Error("DEMO_ADMIN_SECRET is required")

  const host = process.env.HOST ?? "127.0.0.1"
  const port = Number.parseInt(process.env.PORT ?? "4317", 10)
  const server = createConnectivityServer({ adminSecret, host, port })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })

  // Deliberately prints no admin secret, challenge token, or capability URL.
  console.log(`TraceGate connectivity fixture listening on http://${host}:${port}`)

  const shutdown = (): void => {
    server.close(() => process.exit(0))
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main()
}
