import { timingSafeEqual } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

const MAX_BODY_BYTES = 4_096
const EXPECTED_MARKER = "solari-connectivity"

export interface ConnectivitySnapshot {
  revision: number
  mutationCount: number
  mutatedAt: string | null
}

export class ConnectivityState {
  #revision = 0
  #mutationCount = 0
  #mutatedAt: string | null = null

  mutate(): ConnectivitySnapshot {
    this.#revision += 1
    this.#mutationCount += 1
    this.#mutatedAt = new Date().toISOString()
    return this.snapshot()
  }

  snapshot(): ConnectivitySnapshot {
    return {
      revision: this.#revision,
      mutationCount: this.#mutationCount,
      mutatedAt: this.#mutatedAt,
    }
  }
}

function send(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType: string,
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  })
  response.end(body)
}

function notFound(response: ServerResponse): void {
  send(response, 404, "Not found\n", "text/plain; charset=utf-8")
}

function hasBrowserNavigationHeaders(request: IncomingMessage): boolean {
  return Boolean(
    request.headers.origin ||
      request.headers.referer ||
      request.headers["sec-fetch-mode"] === "navigate",
  )
}

function bearerMatches(request: IncomingMessage, expectedSecret: string): boolean {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith("Bearer ")) return false

  const actual = Buffer.from(authorization.slice("Bearer ".length), "utf8")
  const expected = Buffer.from(expectedSecret, "utf8")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large")
    chunks.push(bytes)
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"))
}

function renderPage(snapshot: ConnectivitySnapshot, didMutate: boolean): string {
  const status = didMutate
    ? "Connectivity mutation accepted."
    : "Ready for a connectivity mutation."

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TraceGate connectivity fixture</title>
  </head>
  <body>
    <main>
      <h1>TraceGate connectivity fixture</h1>
      <p>This semantic form verifies a real remote browser can mutate server state.</p>
      <form method="post" action="/__connectivity/mutate">
        <button type="submit" name="marker" value="${EXPECTED_MARKER}">
          Confirm remote connectivity
        </button>
      </form>
      <p role="status" aria-live="polite">${status}</p>
      <p>Public mutation revision: <output>${snapshot.revision}</output></p>
    </main>
  </body>
</html>`
}

export async function handleConnectivityRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: ConnectivityState,
  adminSecret: string,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://tracegate.invalid")

  if (request.method === "GET" && url.pathname === "/__connectivity") {
    send(
      response,
      200,
      renderPage(state.snapshot(), url.searchParams.get("mutated") === "1"),
      "text/html; charset=utf-8",
    )
    return true
  }

  if (request.method === "POST" && url.pathname === "/__connectivity/mutate") {
    if (
      !request.headers["content-type"]?.startsWith(
        "application/x-www-form-urlencoded",
      )
    ) {
      send(response, 415, "Unsupported media type\n", "text/plain; charset=utf-8")
      return true
    }

    try {
      const form = await readForm(request)
      if (form.get("marker") !== EXPECTED_MARKER) {
        send(response, 400, "Invalid mutation\n", "text/plain; charset=utf-8")
        return true
      }
      state.mutate()
      response.writeHead(303, {
        "cache-control": "no-store",
        location: "/__connectivity?mutated=1",
      })
      response.end()
    } catch {
      send(response, 413, "Request rejected\n", "text/plain; charset=utf-8")
    }
    return true
  }

  if (url.pathname === "/__connectivity/admin") {
    if (
      request.method !== "GET" ||
      hasBrowserNavigationHeaders(request) ||
      !bearerMatches(request, adminSecret)
    ) {
      notFound(response)
      return true
    }

    send(
      response,
      200,
      JSON.stringify({ schemaVersion: 1, ...state.snapshot() }),
      "application/json; charset=utf-8",
    )
    return true
  }

  return false
}
