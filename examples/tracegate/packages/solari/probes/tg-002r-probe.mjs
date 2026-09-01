import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { once } from "node:events"
import { Solari } from "@solarisdk/browser"
import { chromium } from "playwright-core"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function parseEnv(text) {
  const values = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function json(response, status, value, headers = {}) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...headers,
  })
  response.end(body)
}

function createCanary() {
  const hits = []
  let websocketUpgrades = 0
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://canary.invalid")
    hits.push({ method: request.method ?? "UNKNOWN", path: url.pathname })
    request.resume()

    if (url.pathname === "/matrix") {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>TG-002R controlled canary</title></head><body>
      <main><h1>TG-002R controlled canary</h1><button id="local-toggle" type="button">Toggle</button><div id="state" hidden>open</div></main>
      <script>
      document.querySelector('#local-toggle').addEventListener('click', () => {
        document.querySelector('#state').toggleAttribute('hidden')
      })
      fetch('/blocked/passive-post', { method: 'POST', body: 'passive=1' }).catch(() => {})
      </script></body></html>`
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(html),
        "cache-control": "no-store",
      })
      response.end(html)
      return
    }
    if (url.pathname === "/redirect") {
      response.writeHead(302, { location: "/ok", "cache-control": "no-store" })
      response.end()
      return
    }
    if (url.pathname === "/eventsource") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "close",
      })
      response.end("data: controlled\n\n")
      return
    }
    if (url.pathname === "/download") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=controlled.txt",
      })
      response.end("controlled")
      return
    }
    if (url.pathname === "/sw.js") {
      const script = "self.addEventListener('fetch', () => {})"
      response.writeHead(200, {
        "content-type": "application/javascript",
        "content-length": Buffer.byteLength(script),
        "cache-control": "no-store",
      })
      response.end(script)
      return
    }
    json(response, 200, { ok: true, path: url.pathname })
  })
  server.on("upgrade", (request, socket) => {
    websocketUpgrades += 1
    hits.push({ method: "UPGRADE", path: new URL(request.url ?? "/", "http://canary.invalid").pathname })
    socket.destroy()
  })
  return {
    server,
    hits,
    get websocketUpgrades() {
      return websocketUpgrades
    },
  }
}

async function listen(server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("canary listen address unavailable")
  return address.port
}

async function startTunnel(port) {
  const child = spawn("cloudflared", [
    "tunnel",
    "--url",
    `http://127.0.0.1:${port}`,
    "--no-autoupdate",
    "--loglevel",
    "info",
  ], { stdio: ["ignore", "pipe", "pipe"] })

  let buffer = ""
  let settled = false
  const result = new Promise((resolve, reject) => {
    const inspect = (chunk) => {
      buffer = (buffer + chunk.toString("utf8")).slice(-64_000)
      const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
      if (match && !settled) {
        settled = true
        resolve({ child, baseUrl: new URL(match[0]) })
      }
    }
    child.stdout.on("data", inspect)
    child.stderr.on("data", inspect)
    child.once("error", (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.once("exit", (code) => {
      if (!settled) {
        settled = true
        reject(new Error(`cloudflared exited before readiness (${code ?? "signal"})`))
      }
    })
  })

  const timeout = sleep(30_000).then(() => {
    throw new Error("cloudflared readiness timeout")
  })
  try {
    return await Promise.race([result, timeout])
  } catch {
    await stopChild(child)
    throw new Error("cloudflared unavailable")
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([once(child, "exit"), sleep(5_000)]).catch(() => {})
  if (child.exitCode === null) child.kill("SIGKILL")
}

async function waitForTunnelCanary(baseUrl) {
  const diagnostics = { attempts: 0, statusCounts: {}, errorNameCounts: {} }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    diagnostics.attempts += 1
    try {
      const response = await fetch(new URL("/ok", baseUrl), {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      })
      diagnostics.statusCounts[response.status] = (diagnostics.statusCounts[response.status] ?? 0) + 1
      await response.arrayBuffer()
      if (response.status === 200) return diagnostics
    } catch (error) {
      const name = typeof error?.name === "string" ? error.name : "Error"
      diagnostics.errorNameCounts[name] = (diagnostics.errorNameCounts[name] ?? 0) + 1
    }
    await sleep(500)
  }
  const error = new Error("controlled tunnel canary unavailable")
  error.diagnostics = diagnostics
  throw error
}

function countHits(hits, path, method) {
  return hits.filter((hit) => hit.path === path && (!method || hit.method === method)).length
}

async function main() {
  const env = { ...process.env, ...parseEnv(await readFile(new URL("../../../.env", import.meta.url), "utf8")) }
  if (!env.SOLARI_API_KEY) throw new Error("SOLARI_API_KEY is not configured")

  const canary = createCanary()
  let tunnel = null
  let client = null
  let session = null
  let browser = null
  let context = null
  let createCalls = 0
  let releasePhase = "none"
  const releaseStatuses = { valid: null, invalid: null }
  const originalFetch = globalThis.fetch
  const routeEvents = []
  const websocketEvents = []
  const cdpEvents = { webTransportCreated: 0, webSocketCreated: 0 }
  let causalWindow = false
  let stage = "initialize"

  const result = {
    schemaVersion: 1,
    configured: true,
    tunnelCanaryReady: false,
    tunnelReadinessDiagnostics: null,
    providerCreatePhaseEntered: false,
    sdkCreateAttemptsConfigured: 1,
    sdkCreateHttpCallsObserved: 0,
    acknowledgedSessions: 0,
    positivelyReleasedSessions: 0,
    validReleaseHttpStatus: null,
    invalidReleaseHttpStatus: null,
    invalid404Rejected: false,
    freshContextCreated: false,
    serviceWorkersBlocked: false,
    serviceWorkerRegistrationResult: "not_attempted",
    serviceWorkerRegistrationsVisible: null,
    serviceWorkerScriptCanaryHits: null,
    postResponseRemoteIpObserved: false,
    preconnectActualIpPortObserved: false,
    passiveBlockedRequests: 0,
    causalBlockedRequests: 0,
    matrix: {},
    terminal: "BLOCKED",
    blockerCodes: [],
  }

  try {
    stage = "canary_listen"
    const port = await listen(canary.server)
    stage = "tunnel_start"
    tunnel = await startTunnel(port)
    stage = "tunnel_canary_ready"
    result.tunnelReadinessDiagnostics = await waitForTunnelCanary(tunnel.baseUrl)
    result.tunnelCanaryReady = true

    globalThis.fetch = async (input, init) => {
      const requestInput = input instanceof Request ? input : null
      const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url)
      const method = String(init?.method ?? requestInput?.method ?? "GET").toUpperCase()
      if (url.origin === "https://api.getsolari.com" && url.pathname === "/sessions" && method === "POST") {
        createCalls += 1
      }
      const response = await originalFetch(input, init)
      if (url.origin === "https://api.getsolari.com" && url.pathname.startsWith("/sessions/") && method === "DELETE") {
        if (releasePhase === "valid") releaseStatuses.valid = response.status
        if (releasePhase === "invalid") releaseStatuses.invalid = response.status
      }
      return response
    }

    stage = "provider_create"
    result.providerCreatePhaseEntered = true
    client = new Solari({
      apiKey: env.SOLARI_API_KEY,
      region: "us-west",
      maxAttempts: 1,
      timeoutMs: 30_000,
    })
    session = await client.sessions.create({ recording: false })
    result.acknowledgedSessions = 1
    stage = "cdp_connect"
    browser = await chromium.connectOverCDP(session.cdpEndpoint, { timeout: 20_000 })

    stage = "fresh_context"
    try {
      context = await browser.newContext({ serviceWorkers: "block" })
      result.freshContextCreated = true
    } catch {
      result.freshContextCreated = false
      result.blockerCodes.push("fresh_service_worker_blocked_context_unavailable")
      return
    }

    stage = "policy_install"
    await context.routeWebSocket(/.*/, async (route) => {
      websocketEvents.push({ blocked: true, causal: causalWindow })
      await route.close({ code: 1008, reason: "policy" }).catch(() => {})
    })
    await context.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const method = request.method().toUpperCase()
      const resourceType = request.resourceType()
      const bodyPresent = request.postDataBuffer() !== null
      const blockedPath = url.pathname.startsWith("/blocked/") || url.pathname === "/download" || url.pathname === "/eventsource"
      const blockedMethod = !["GET", "HEAD", "OPTIONS"].includes(method) || bodyPresent
      const blocked = blockedPath || blockedMethod || resourceType === "eventsource" || resourceType === "websocket"
      routeEvents.push({ path: url.pathname, method, resourceType, blocked, causal: causalWindow })
      if (blocked) await route.abort("blockedbyclient")
      else await route.continue()
    })

    stage = "page_create"
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send("Network.enable")
    cdp.on("Network.webTransportCreated", () => { cdpEvents.webTransportCreated += 1 })
    cdp.on("Network.webSocketCreated", () => { cdpEvents.webSocketCreated += 1 })

    stage = "main_navigation"
    const mainResponse = await page.goto(new URL("/matrix", tunnel.baseUrl).href, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    })
    const serverAddress = await mainResponse?.serverAddr().catch(() => null)
    result.postResponseRemoteIpObserved = Boolean(serverAddress?.ipAddress && serverAddress?.port)
    await sleep(750)

    stage = "service_worker_probe"
    result.serviceWorkersBlocked = context.serviceWorkers().length === 0
    const swRegistration = await page.evaluate(async () => {
      try {
        await navigator.serviceWorker.register("/sw.js")
        return "resolved"
      } catch {
        return "rejected"
      }
    })
    await sleep(300)
    const visibleRegistrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length).catch(() => -1)
    result.serviceWorkerRegistrationResult = swRegistration
    result.serviceWorkerRegistrationsVisible = visibleRegistrations
    result.serviceWorkerScriptCanaryHits = countHits(canary.hits, "/sw.js")
    result.serviceWorkersBlocked =
      context.serviceWorkers().length === 0 &&
      visibleRegistrations === 0 &&
      result.serviceWorkerScriptCanaryHits === 0

    stage = "coverage_navigation"
    await page.goto(new URL("/redirect", tunnel.baseUrl).href, { waitUntil: "domcontentloaded", timeout: 20_000 })
    await page.goto(new URL("/matrix", tunnel.baseUrl).href, { waitUntil: "domcontentloaded", timeout: 20_000 })
    await sleep(300)

    stage = "passive_coverage"
    await page.evaluate(() => {
      const frame = document.createElement("iframe")
      frame.src = "/blocked/subframe"
      document.body.append(frame)
      fetch("/ok?kind=fetch-get").catch(() => {})
      const xhr = new XMLHttpRequest()
      xhr.open("GET", "/ok?kind=xhr-get")
      xhr.send()
      const source = new EventSource("/eventsource")
      source.onerror = () => source.close()
      const link = document.createElement("link")
      link.rel = "prefetch"
      link.href = "/blocked/prefetch"
      document.head.append(link)
      const speculation = document.createElement("script")
      speculation.type = "speculationrules"
      speculation.textContent = JSON.stringify({ prefetch: [{ source: "list", urls: ["/blocked/speculation"] }] })
      document.head.append(speculation)
      const worker = new Worker(URL.createObjectURL(new Blob(["fetch('/blocked/worker-fetch').catch(()=>{})"], { type: "application/javascript" })))
      setTimeout(() => worker.terminate(), 500)
      if (typeof SharedWorker === "function") {
        const shared = new SharedWorker(URL.createObjectURL(new Blob(["fetch('/blocked/shared-worker-fetch').catch(()=>{})"], { type: "application/javascript" })))
        setTimeout(() => shared.port.close(), 500)
      }
    })
    await sleep(800)

    stage = "causal_coverage"
    causalWindow = true
    await page.evaluate(async () => {
      await fetch("/blocked/causal-post", { method: "POST", body: "controlled=1" }).catch(() => {})
      const xhr = new XMLHttpRequest()
      xhr.open("POST", "/blocked/causal-xhr")
      xhr.send("controlled=1")
      navigator.sendBeacon("/blocked/causal-beacon", "controlled=1")
      const socket = new WebSocket(location.origin.replace(/^http/, "ws") + "/ws")
      socket.onerror = () => {}
      const popup = window.open("/blocked/popup", "_blank")
      if (popup) setTimeout(() => popup.close(), 250)
      const anchor = document.createElement("a")
      anchor.href = "/download"
      anchor.download = "controlled.txt"
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      if (typeof WebTransport === "function") {
        try {
          const transport = new WebTransport(location.origin + "/webtransport")
          transport.closed.catch(() => {})
          setTimeout(() => transport.close(), 250)
        } catch {}
      }
    })
    await sleep(1_000)
    causalWindow = false

    stage = "result_aggregation"
    result.passiveBlockedRequests = routeEvents.filter((event) => event.blocked && !event.causal).length
    result.causalBlockedRequests = routeEvents.filter((event) => event.blocked && event.causal).length + websocketEvents.filter((event) => event.causal).length

    const nonIdempotentPaths = [
      "/blocked/passive-post",
      "/blocked/causal-post",
      "/blocked/causal-xhr",
      "/blocked/causal-beacon",
    ]
    const noNonIdempotentHttpReachedCanary = nonIdempotentPaths.every((path) => countHits(canary.hits, path) === 0)

    const routedAttempt = (path) => routeEvents.find((event) => event.path === path)
    const routedTypeAttempt = (types) => routeEvents.find((event) => types.includes(event.resourceType))
    const matrixEntry = (attempt, canaryHits, extra = {}) => ({
      attemptObserved: Boolean(attempt),
      routeObservable: Boolean(attempt),
      routeAbortObserved: Boolean(attempt?.blocked),
      canaryHits,
      preconnectActualDestination: false,
      ...extra,
    })

    result.matrix = {
      main_frame: matrixEntry(routedAttempt("/matrix"), countHits(canary.hits, "/matrix", "GET")),
      subframe: matrixEntry(routedAttempt("/blocked/subframe"), countHits(canary.hits, "/blocked/subframe")),
      redirect: matrixEntry(routedAttempt("/redirect"), countHits(canary.hits, "/redirect"), { redirectFinalAttemptObserved: Boolean(routedAttempt("/ok")) }),
      fetch_xhr: matrixEntry(routedTypeAttempt(["fetch", "xhr"]), nonIdempotentPaths.reduce((total, path) => total + countHits(canary.hits, path), 0), { nonIdempotentRouteAbortProvenForControlledCanary: noNonIdempotentHttpReachedCanary }),
      eventsource: matrixEntry(routedTypeAttempt(["eventsource"]), countHits(canary.hits, "/eventsource")),
      beacon: matrixEntry(routedAttempt("/blocked/causal-beacon"), countHits(canary.hits, "/blocked/causal-beacon")),
      websocket: { attemptObserved: websocketEvents.length > 0 || cdpEvents.webSocketCreated > 0, routeObservable: websocketEvents.length > 0 || cdpEvents.webSocketCreated > 0, routeAbortObserved: websocketEvents.length > 0, canaryHits: canary.websocketUpgrades, preconnectActualDestination: false },
      webtransport_quic: { attemptObserved: cdpEvents.webTransportCreated > 0, routeObservable: cdpEvents.webTransportCreated > 0, routeAbortObserved: false, canaryHits: null, preconnectActualDestination: false },
      webrtc_stun_turn: { attemptObserved: false, routeObservable: false, routeAbortObserved: false, canaryHits: null, preconnectActualDestination: false, controlledUdpCanaryUnavailable: true },
      workers: matrixEntry(routedTypeAttempt(["worker"]), countHits(canary.hits, "/blocked/worker-fetch") + countHits(canary.hits, "/blocked/shared-worker-fetch")),
      service_workers: { attemptObserved: true, routeObservable: false, routeAbortObserved: false, canaryHits: result.serviceWorkerScriptCanaryHits, preconnectActualDestination: false, freshContextRegistrationBlocked: result.serviceWorkersBlocked, registrationResult: result.serviceWorkerRegistrationResult, visibleRegistrations: result.serviceWorkerRegistrationsVisible },
      speculation_prefetch: matrixEntry(routedAttempt("/blocked/prefetch") ?? routedAttempt("/blocked/speculation"), countHits(canary.hits, "/blocked/prefetch") + countHits(canary.hits, "/blocked/speculation")),
      popups: matrixEntry(routedAttempt("/blocked/popup"), countHits(canary.hits, "/blocked/popup")),
      downloads: matrixEntry(routedAttempt("/download"), countHits(canary.hits, "/download")),
      external_protocols: { attemptObserved: false, routeObservable: false, routeAbortObserved: false, canaryHits: null, preconnectActualDestination: false, safelyUntested: true },
      browser_process_traffic: { attemptObserved: false, routeObservable: false, routeAbortObserved: false, canaryHits: null, preconnectActualDestination: false },
    }

    if (!result.freshContextCreated || !result.serviceWorkersBlocked) result.blockerCodes.push("fresh_service_worker_blocked_context_unproven")
    if (!result.preconnectActualIpPortObserved) result.blockerCodes.push("provider_preconnect_destination_enforcement_not_demonstrated")
    for (const [name, entry] of Object.entries(result.matrix)) {
      if (!entry.routeObservable) result.blockerCodes.push(`unobservable_context:${name}`)
      else if (!entry.preconnectActualDestination) result.blockerCodes.push(`no_preconnect_destination_enforcement:${name}`)
    }
  } catch (error) {
    if (stage === "tunnel_canary_ready" && error?.diagnostics) {
      result.tunnelReadinessDiagnostics = error.diagnostics
    }
    result.blockerCodes.push(`probe_internal_error:${stage}`)
    process.exitCode = 1
  } finally {
    causalWindow = false
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    if (session && client) {
      try {
        releasePhase = "valid"
        await client.sessions.releaseAndWait(session.id)
        result.positivelyReleasedSessions = 1
      } catch {
        result.blockerCodes.push("acknowledged_session_release_unconfirmed")
      }
      try {
        releasePhase = "invalid"
        await client.sessions.releaseAndWait("tg002r-invalid-release-sentinel")
      } catch (error) {
        result.invalid404Rejected = error?.status === 404
      } finally {
        releasePhase = "none"
      }
    }
    if (client) await client.close().catch(() => {})
    globalThis.fetch = originalFetch
    result.sdkCreateHttpCallsObserved = createCalls
    result.validReleaseHttpStatus = releaseStatuses.valid
    result.invalidReleaseHttpStatus = releaseStatuses.invalid
    await stopChild(tunnel?.child)
    await new Promise((resolve) => canary.server.close(resolve)).catch(() => {})
    if (result.providerCreatePhaseEntered && result.sdkCreateHttpCallsObserved !== 1) result.blockerCodes.push("browser_create_not_exactly_once")
    if (result.positivelyReleasedSessions !== result.acknowledgedSessions) result.blockerCodes.push("cleanup_reconciliation_failed")
    if (result.acknowledgedSessions > 0 && !result.invalid404Rejected) result.blockerCodes.push("release_404_not_proven_failure")
    result.blockerCodes = [...new Set(result.blockerCodes)].sort()
    console.log(JSON.stringify(result, null, 2))
  }
}

await main()
