import { spawn } from "node:child_process"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { isIP } from "node:net"
import { lookup } from "node:dns/promises"

import {
  AssertionSetV1Schema,
  BrowserAcquireRequestSchema,
  PublicHttpsOriginSchema,
  isTraceGateError,
} from "@tracegate/shared"
import {
  FreshBrowserAssertionEvidenceCapture,
  SolariBrowserControllerFactory,
  SolariBrowserProvider,
} from "../dist/index.js"

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))
const LIMITATIONS = [
  "no_provider_preconnect_ip_enforcement",
  "dns_rebinding_not_fully_prevented",
  "browser_process_traffic_not_fully_observable",
]

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

function createCanary() {
  const hits = []
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://canary.invalid")
    hits.push({ method: request.method ?? "UNKNOWN", path: url.pathname })
    request.resume()

    if (url.pathname === "/") {
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TraceGate public safety smoke</title></head><body>
      <main><h1>Public safety smoke</h1>
      <button id="details" type="button" aria-expanded="false">Show details</button>
      <p id="detail-text" hidden>Safety smoke details are visible</p>
      <button id="blocked" type="button">Attempt blocked update</button>
      </main><script>
      document.querySelector('#details').addEventListener('click', () => {
        document.querySelector('#details').setAttribute('aria-expanded', 'true');
        document.querySelector('#detail-text').hidden = false;
      });
      document.querySelector('#blocked').addEventListener('click', () => {
        fetch('/action-post', { method: 'POST', body: 'controlled=1' }).catch(() => {});
      });
      fetch('/passive-post', { method: 'POST', body: 'controlled=1' }).catch(() => {});
      navigator.serviceWorker?.register('/sw.js').catch(() => {});
      </script></body></html>`
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(html),
        "cache-control": "no-store",
      })
      response.end(html)
      return
    }
    if (url.pathname === "/sw.js") {
      const body = "self.addEventListener('fetch', () => {})"
      response.writeHead(200, {
        "content-type": "application/javascript",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
      })
      response.end(body)
      return
    }
    response.writeHead(204, { "cache-control": "no-store" })
    response.end()
  })
  return { server, hits }
}

async function listen(server) {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("canary listen failed")
  return address.port
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([once(child, "exit"), sleep(5_000)]).catch(() => {})
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
}

async function startTunnel(port) {
  const child = spawn(process.env.CLOUDFLARED_PATH ?? "cloudflared", [
    "tunnel",
    "--url",
    `http://127.0.0.1:${port}`,
    "--no-autoupdate",
    "--loglevel",
    "info",
  ], { stdio: ["ignore", "pipe", "pipe"] })
  let buffer = ""
  let settled = false
  const ready = new Promise((resolve, reject) => {
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
    child.once("error", () => {
      if (!settled) { settled = true; reject(new Error("cloudflared spawn failed")) }
    })
    child.once("exit", () => {
      if (!settled) { settled = true; reject(new Error("cloudflared exited before readiness")) }
    })
  })
  try {
    return await Promise.race([
      ready,
      sleep(30_000).then(() => { throw new Error("cloudflared readiness timeout") }),
    ])
  } catch {
    await stopChild(child)
    throw new Error("cloudflared unavailable")
  }
}

async function waitForCanary(baseUrl) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(new URL("/", baseUrl), {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      })
      await response.arrayBuffer()
      if (response.status === 200) return true
    } catch {}
    await sleep(500)
  }
  return false
}

function parseIpv6Words(address) {
  let value = address.toLowerCase().split("%")[0]
  if (isIP(value) !== 6) return null
  const ipv4Separator = value.lastIndexOf(":")
  const ipv4Tail = value.slice(ipv4Separator + 1)
  if (ipv4Tail.includes(".")) {
    if (isIP(ipv4Tail) !== 4) return null
    const octets = ipv4Tail.split(".").map(Number)
    value = `${value.slice(0, ipv4Separator)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const halves = value.split("::")
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const explicit = [...left, ...right]
  if (explicit.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const omitted = 8 - explicit.length
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null
  return [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: omitted }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ]
}

function isObviouslyPublic(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false
    return true
  }
  const words = parseIpv6Words(address)
  if (!words) return false
  const [first, second, third] = words
  if (first < 0x2000 || first > 0x3fff) return false
  if (first === 0x2002 || first === 0x3ffe) return false
  if (first === 0x2001 && second === 0x0000) return false
  if (first === 0x2001 && second === 0x0db8) return false
  if (first === 0x2001 && second === 0x0002 && third === 0x0000) return false
  if (first === 0x2001 && (second & 0xfff0) === 0x0010) return false
  if (first === 0x2001 && (second & 0xfff0) === 0x0020) return false
  if (first === 0x3fff && second <= 0x0fff) return false
  return true
}

function countHits(hits, path, method) {
  return hits.filter((hit) => hit.path === path && (!method || hit.method === method)).length
}

async function main() {
  const result = {
    schemaVersion: 1,
    configured: false,
    terminal: "BLOCKED",
    stage: "initialize",
    dnsPublicAnswersOnly: false,
    tunnelAttempts: 0,
    sdkCreateAttemptsConfigured: 1,
    sdkCreateHttpCallsObserved: 0,
    acknowledgedSessions: 0,
    controllerFreshContextConnected: false,
    exactOriginNavigationBlocked: false,
    semanticObservationCaptured: false,
    opaqueRevisionRefs: false,
    passiveUnsafeRequestBlocked: false,
    safeDisclosureActionObserved: false,
    freshRepeatedEvidenceAccepted: false,
    prohibitedActionRequestBlocked: false,
    serviceWorkerScriptBlocked: false,
    controllerCloseAttempted: false,
    controllerCloseConfirmed: false,
    controlledSafetyChecksPassed: false,
    releaseAttempted: false,
    releaseConfirmed: false,
    potentialSessionLeak: false,
    limitations: LIMITATIONS,
    failureClass: null,
    safeFailureCode: null,
    safePolicyCode: null,
    blockerCodes: [],
  }

  let canary = null
  let tunnel = null
  let provider = null
  let lease = null
  let controller = null
  let createCalls = 0
  const originalFetch = globalThis.fetch

  try {
    result.stage = "credentials"
    const fileEnv = parseEnv(await readFile(new URL("../../../.env", import.meta.url), "utf8").catch(() => ""))
    const apiKey = process.env.SOLARI_API_KEY ?? fileEnv.SOLARI_API_KEY
    if (!apiKey) throw new Error("credentials unavailable")
    result.configured = true

    result.stage = "canary"
    canary = createCanary()
    const port = await listen(canary.server)
    result.stage = "tunnel"
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      result.tunnelAttempts = attempt
      let candidate = null
      try {
        candidate = await startTunnel(port)
      } catch {
        continue
      }
      if (await waitForCanary(candidate.baseUrl)) {
        tunnel = candidate
        break
      }
      await stopChild(candidate.child)
    }
    if (!tunnel) throw new Error("tunnel canary unavailable")

    result.stage = "dns_preflight"
    const answers = await Promise.race([
      lookup(tunnel.baseUrl.hostname, { all: true, verbatim: true }),
      sleep(5_000).then(() => { throw new Error("dns preflight timeout") }),
    ])
    result.dnsPublicAnswersOnly = answers.length > 0 && answers.every((answer) => isObviouslyPublic(answer.address))
    if (!result.dnsPublicAnswersOnly) throw new Error("dns preflight rejected")

    globalThis.fetch = async (input, init) => {
      const requestInput = input instanceof Request ? input : null
      const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url)
      const method = String(init?.method ?? requestInput?.method ?? "GET").toUpperCase()
      if (url.origin === "https://api.getsolari.com" && url.pathname === "/sessions" && method === "POST") {
        createCalls += 1
      }
      return originalFetch(input, init)
    }

    result.stage = "provider_acquire"
    provider = new SolariBrowserProvider({ apiKey, timeoutMs: 30_000 })
    lease = await provider.acquire(BrowserAcquireRequestSchema.parse({
      evaluationId: "00000000-0000-7000-8000-000000000101",
      runId: "00000000-0000-7000-8000-000000000102",
      modelId: "deepseek/deepseek-v4-flash-0731",
      attemptCorrelationId: "public-smoke-attempt-0001",
      recordingRequested: false,
      region: "us-west",
    }), AbortSignal.timeout(35_000))
    result.acknowledgedSessions = 1

    result.stage = "controller_connect"
    const origin = PublicHttpsOriginSchema.parse(tunnel.baseUrl.origin)
    const factory = new SolariBrowserControllerFactory({ allowedOrigins: [origin] })
    controller = await factory.create(lease, AbortSignal.timeout(5_000))
    await controller.connect(lease, AbortSignal.timeout(25_000))
    result.controllerFreshContextConnected = true

    result.stage = "navigate_observe"
    let observation = await controller.navigate(tunnel.baseUrl.href, AbortSignal.timeout(25_000))
    result.semanticObservationCaptured = observation.elements.length > 0
    result.opaqueRevisionRefs = observation.elements.every((element) => /^e:[1-9][0-9]*:[0-9]+$/.test(element.ref))
    await sleep(500)
    result.passiveUnsafeRequestBlocked = countHits(canary.hits, "/passive-post", "POST") === 0

    result.stage = "safe_action"
    const disclosure = observation.elements.find((element) => element.role === "button" && element.name === "Show details")
    if (!disclosure) throw new Error("semantic disclosure control unavailable")
    observation = await controller.click({ ref: disclosure.ref, observationRevision: observation.revision }, AbortSignal.timeout(15_000))
    result.safeDisclosureActionObserved = observation.visibleText.includes("Safety smoke details are visible") &&
      observation.elements.some((element) => element.name === "Show details" && element.expanded === true)

    result.stage = "fresh_evidence"
    const capture = new FreshBrowserAssertionEvidenceCapture()
    const assertions = AssertionSetV1Schema.parse([
      {
        schemaVersion: 1,
        id: "url",
        kind: "url",
        operator: "equals",
        expectedUrl: tunnel.baseUrl.href,
      },
      {
        schemaVersion: 1,
        id: "text",
        kind: "text",
        scope: "document_visible_text",
        operator: "contains",
        expected: "Safety smoke details are visible",
        caseSensitive: true,
      },
      {
        schemaVersion: 1,
        id: "expanded",
        kind: "state",
        locator: {
          role: "button",
          accessibleName: { operator: "equals", value: "Show details", caseSensitive: true },
        },
        property: "expanded",
        expected: true,
      },
    ])
    const captured = await capture.capture(controller, { assertions }, AbortSignal.timeout(10_000))
    result.freshRepeatedEvidenceAccepted = captured.evidence.captureAttempts === 2 &&
      captured.evidence.assertions.every((assertion) => assertion.status === "observed" && assertion.observedResult === true)

    result.stage = "origin_guard"
    try {
      await controller.navigate("https://blocked.invalid/", AbortSignal.timeout(5_000))
    } catch (error) {
      result.exactOriginNavigationBlocked = isTraceGateError(error) &&
        error.safe.code === "unsafe_action_blocked" &&
        "policyCode" in error.safe &&
        error.safe.policyCode === "origin_not_admitted"
    }

    result.stage = "prohibited_action"
    observation = await controller.observe(AbortSignal.timeout(10_000))
    const blocked = observation.elements.find((element) => element.role === "button" && element.name === "Attempt blocked update")
    if (!blocked) throw new Error("controlled prohibited request trigger unavailable")
    try {
      await controller.click({ ref: blocked.ref, observationRevision: observation.revision }, AbortSignal.timeout(15_000))
      await controller.wait(250, AbortSignal.timeout(5_000))
    } catch (error) {
      result.prohibitedActionRequestBlocked = isTraceGateError(error) && error.safe.code === "unsafe_action_blocked"
    }
    result.prohibitedActionRequestBlocked = result.prohibitedActionRequestBlocked &&
      countHits(canary.hits, "/action-post", "POST") === 0
    result.serviceWorkerScriptBlocked = countHits(canary.hits, "/sw.js", "GET") === 0

    const required = [
      result.dnsPublicAnswersOnly,
      result.controllerFreshContextConnected,
      result.exactOriginNavigationBlocked,
      result.semanticObservationCaptured,
      result.opaqueRevisionRefs,
      result.passiveUnsafeRequestBlocked,
      result.safeDisclosureActionObserved,
      result.freshRepeatedEvidenceAccepted,
      result.prohibitedActionRequestBlocked,
      result.serviceWorkerScriptBlocked,
    ]
    result.controlledSafetyChecksPassed = required.every(Boolean)
    if (!result.controlledSafetyChecksPassed) result.blockerCodes.push("controlled_safety_check_failed")
  } catch (error) {
    result.failureClass = typeof error?.name === "string" ? error.name.slice(0, 100) : "Error"
    if (isTraceGateError(error)) {
      result.safeFailureCode = error.safe.code
      if ("policyCode" in error.safe) result.safePolicyCode = error.safe.policyCode
    }
    if (isTraceGateError(error) && error.safe.code === "session_create_ambiguous") {
      result.potentialSessionLeak = true
      result.blockerCodes.push("ambiguous_unacknowledged_create")
    } else {
      result.blockerCodes.push(`smoke_internal:${result.stage}`)
    }
  } finally {
    if (controller) {
      result.controllerCloseAttempted = true
      result.controllerCloseConfirmed = await controller.close(AbortSignal.timeout(10_000)).then(
        () => true,
        () => false,
      )
      if (!result.controllerCloseConfirmed) result.blockerCodes.push("controller_close_unconfirmed")
    }
    if (lease) {
      result.releaseAttempted = true
      const release = await lease.release("public_site_safety_smoke_complete", AbortSignal.timeout(30_000)).catch(() => null)
      result.releaseConfirmed = release?.status === "released" && release.confirmation === "confirmed_released"
      result.potentialSessionLeak = !result.releaseConfirmed
      if (!result.releaseConfirmed) result.blockerCodes.push("acknowledged_session_release_unconfirmed")
    }
    if (provider) await provider.close().catch(() => {})
    globalThis.fetch = originalFetch
    result.sdkCreateHttpCallsObserved = createCalls
    if (result.acknowledgedSessions > 0 && result.sdkCreateHttpCallsObserved !== 1) {
      result.blockerCodes.push("browser_create_not_exactly_once")
    }
    await stopChild(tunnel?.child)
    if (canary) {
      await Promise.race([
        new Promise((resolve) => canary.server.close(resolve)),
        sleep(5_000),
      ]).catch(() => {})
    }
    result.blockerCodes = [...new Set(result.blockerCodes)].sort()
    result.terminal = result.configured &&
      result.controlledSafetyChecksPassed &&
      result.acknowledgedSessions === 1 &&
      result.sdkCreateHttpCallsObserved === 1 &&
      result.controllerCloseConfirmed &&
      result.releaseConfirmed &&
      result.blockerCodes.length === 0
      ? "PASS"
      : "BLOCKED"
    process.exitCode = result.terminal === "PASS" ? 0 : 1
    result.stage = "complete"
    console.log(JSON.stringify(result, null, 2))
  }
}

await main()
