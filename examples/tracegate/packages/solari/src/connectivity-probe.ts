import { performance } from "node:perf_hooks"

import {
  Solari,
  SolariError,
  type Session,
} from "@solarisdk/browser"
import { chromium, type Browser } from "playwright-core"

import {
  prepareConnectivityTarget,
  type ConnectivityProvider,
  type ConnectivityTarget,
} from "./connectivity-target.js"
import {
  isBrowserLimitError,
  isRecordingUnsupported,
  isReleasedOrMissing,
  toSafeError,
  type SafeError,
} from "./safe-error.js"

interface AdminSnapshot {
  schemaVersion: 1
  revision: number
  mutationCount: number
  mutatedAt: string | null
}

interface ReleaseAccounting {
  acknowledged: number
  releaseAttempted: number
  releaseConfirmed: number
  unaccounted: number
}

interface ProbeResult {
  schemaVersion: 1
  status: "passed" | "blocked"
  provider: ConnectivityProvider
  target: {
    publicHttps: boolean
    adminSameOrigin: boolean
  }
  lifecycle: {
    createMs: number | null
    cdpConnectMs: number | null
    mutateAndAdminReadMs: number | null
    releaseMs: number | null
    idempotentRelease: "confirmed" | "not_found_is_success" | "failed" | "not_run"
  }
  mutation: {
    semanticFormLoaded: boolean
    revisionDelta: number | null
    serverStateConfirmed: boolean
  }
  concurrency: {
    attemptedCeiling: number
    acknowledgedHeld: number
    limitObserved: boolean
    entitlement: "exact" | "lower_bound" | "unknown"
  }
  recording: {
    requested: true
    accepted: boolean
    replay: "ready" | "pending" | "unsupported" | "failed" | "not_run"
    replayPollAttempts: number
    replayReadyMs: number | null
  }
  cleanup: ReleaseAccounting
  failure?: SafeError
}

class SessionLedger {
  readonly #sessions = new Map<string, { session: Session; released: boolean }>()
  releaseAttempted = 0
  releaseConfirmed = 0

  acknowledge(session: Session): void {
    this.#sessions.set(session.id, { session, released: false })
  }

  markReleaseAttempt(): void {
    this.releaseAttempted += 1
  }

  markReleased(id: string): void {
    const entry = this.#sessions.get(id)
    if (!entry || entry.released) return
    entry.released = true
    this.releaseConfirmed += 1
  }

  unreleased(): Session[] {
    return [...this.#sessions.values()]
      .filter((entry) => !entry.released)
      .map((entry) => entry.session)
  }

  accounting(): ReleaseAccounting {
    return {
      acknowledged: this.#sessions.size,
      releaseAttempted: this.releaseAttempted,
      releaseConfirmed: this.releaseConfirmed,
      unaccounted: this.#sessions.size - this.releaseConfirmed,
    }
  }
}

function elapsedMs(start: number): number {
  return Math.round(performance.now() - start)
}

function requiredProvider(raw: string | undefined): ConnectivityProvider {
  if (raw === "tunnel" || raw === "sandbox") return raw
  throw new Error("DEMO_CONNECTIVITY_PROVIDER must be tunnel or sandbox")
}

function concurrencyCeiling(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "5", 10)
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("SOLARI_PROBE_MAX_CONCURRENCY must be an integer from 1 to 5")
  }
  return value
}

async function adminRead(target: ConnectivityTarget): Promise<AdminSnapshot> {
  const response = await fetch(
    new URL("/__connectivity/admin", target.adminBaseUrl),
    {
      headers: { authorization: `Bearer ${target.adminSecret}` },
      signal: AbortSignal.timeout(5_000),
    },
  )
  if (!response.ok) throw new Error("Demo admin read failed")
  const value: unknown = await response.json()
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<AdminSnapshot>).schemaVersion !== 1 ||
    typeof (value as Partial<AdminSnapshot>).revision !== "number" ||
    typeof (value as Partial<AdminSnapshot>).mutationCount !== "number"
  ) {
    throw new Error("Demo admin response was invalid")
  }
  return value as AdminSnapshot
}

async function releaseSession(
  solari: Solari,
  ledger: SessionLedger,
  session: Session,
): Promise<void> {
  ledger.markReleaseAttempt()
  try {
    await solari.sessions.releaseAndWait(session.id)
    ledger.markReleased(session.id)
  } catch (error) {
    if (isReleasedOrMissing(error)) {
      ledger.markReleased(session.id)
      return
    }
    throw error
  }
}

async function pollReplay(
  solari: Solari,
  sessionId: string,
): Promise<{
  state: "ready" | "pending" | "unsupported" | "failed"
  attempts: number
  readyMs: number | null
}> {
  const start = performance.now()
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    try {
      const replay = await solari.sessions.getReplayUrl(sessionId)
      const url = new URL(replay.url)
      if (url.protocol !== "https:" || replay.expiresInSeconds <= 0) {
        return { state: "failed", attempts: attempt, readyMs: null }
      }
      // Never return, print, or persist replay.url. It is discarded here.
      return { state: "ready", attempts: attempt, readyMs: elapsedMs(start) }
    } catch (error) {
      if (error instanceof SolariError && error.status === 404) continue
      if (isRecordingUnsupported(error)) {
        return { state: "unsupported", attempts: attempt, readyMs: null }
      }
      return { state: "failed", attempts: attempt, readyMs: null }
    }
  }
  return { state: "pending", attempts: 10, readyMs: null }
}

async function verifyMutation(
  session: Session,
  target: ConnectivityTarget,
): Promise<{
  browser: Browser
  cdpConnectMs: number
  mutateAndAdminReadMs: number
  revisionDelta: number
}> {
  const connectStart = performance.now()
  const browser = await chromium.connectOverCDP(session.cdpEndpoint, {
    timeout: 15_000,
  })
  const cdpConnectMs = elapsedMs(connectStart)

  try {
    const context = browser.contexts()[0]
    if (!context) throw new Error("Solari CDP returned no default context")
    const page = context.pages()[0] ?? (await context.newPage())
    const mutationStart = performance.now()
    const before = await adminRead(target)

    await page.goto(new URL("/__connectivity", target.publicBaseUrl).href, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    })
    if ((await page.title()) !== "TraceGate connectivity fixture") {
      throw new Error("Connectivity fixture title mismatch")
    }
    await page
      .getByRole("button", { name: "Confirm remote connectivity" })
      .click({ timeout: 10_000 })
    await page
      .getByRole("status")
      .filter({ hasText: "Connectivity mutation accepted." })
      .waitFor({ timeout: 10_000 })

    const after = await adminRead(target)
    if (after.revision !== before.revision + 1) {
      throw new Error("Admin revision did not confirm exactly one mutation")
    }
    return {
      browser,
      cdpConnectMs,
      mutateAndAdminReadMs: elapsedMs(mutationStart),
      revisionDelta: after.revision - before.revision,
    }
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
}

async function acquirePrimary(
  solari: Solari,
  ledger: SessionLedger,
): Promise<{ session: Session; recordingAccepted: boolean; createMs: number }> {
  const start = performance.now()
  try {
    const session = await solari.sessions.create({ recording: true })
    ledger.acknowledge(session)
    return { session, recordingAccepted: true, createMs: elapsedMs(start) }
  } catch (error) {
    if (!isRecordingUnsupported(error)) throw error
    const session = await solari.sessions.create({ recording: false })
    ledger.acknowledge(session)
    return { session, recordingAccepted: false, createMs: elapsedMs(start) }
  }
}

async function measureConcurrency(
  solari: Solari,
  ledger: SessionLedger,
  ceiling: number,
): Promise<{
  acknowledgedHeld: number
  limitObserved: boolean
  entitlement: "exact" | "lower_bound" | "unknown"
}> {
  const held: Session[] = []
  let limitObserved = false
  try {
    for (let attempt = 0; attempt < ceiling; attempt += 1) {
      try {
        const session = await solari.sessions.create({ recording: false })
        ledger.acknowledge(session)
        held.push(session)
      } catch (error) {
        if (!isBrowserLimitError(error)) throw error
        limitObserved = true
        break
      }
    }
    return {
      acknowledgedHeld: held.length,
      limitObserved,
      entitlement: limitObserved ? "exact" : "lower_bound",
    }
  } finally {
    await Promise.allSettled(
      held.map((session) => releaseSession(solari, ledger, session)),
    )
  }
}

function blankResult(
  provider: ConnectivityProvider,
  ceiling: number,
): ProbeResult {
  return {
    schemaVersion: 1,
    status: "blocked",
    provider,
    target: { publicHttps: false, adminSameOrigin: false },
    lifecycle: {
      createMs: null,
      cdpConnectMs: null,
      mutateAndAdminReadMs: null,
      releaseMs: null,
      idempotentRelease: "not_run",
    },
    mutation: {
      semanticFormLoaded: false,
      revisionDelta: null,
      serverStateConfirmed: false,
    },
    concurrency: {
      attemptedCeiling: ceiling,
      acknowledgedHeld: 0,
      limitObserved: false,
      entitlement: "unknown",
    },
    recording: {
      requested: true,
      accepted: false,
      replay: "not_run",
      replayPollAttempts: 0,
      replayReadyMs: null,
    },
    cleanup: {
      acknowledged: 0,
      releaseAttempted: 0,
      releaseConfirmed: 0,
      unaccounted: 0,
    },
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.SOLARI_API_KEY
  const provider = requiredProvider(process.env.DEMO_CONNECTIVITY_PROVIDER)
  const ceiling = concurrencyCeiling(process.env.SOLARI_PROBE_MAX_CONCURRENCY)
  const result = blankResult(provider, ceiling)
  if (!apiKey) {
    result.failure = { kind: "ConfigurationError", code: "SOLARI_API_KEY_UNSET" }
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = 2
    return
  }

  const ledger = new SessionLedger()
  const solari = new Solari({ apiKey, timeoutMs: 20_000 })
  let target: ConnectivityTarget | undefined
  let primary: Session | undefined

  try {
    target = await prepareConnectivityTarget(provider, apiKey, process.env)
    result.target = {
      publicHttps: target.publicBaseUrl.protocol === "https:",
      adminSameOrigin: target.publicBaseUrl.origin === target.adminBaseUrl.origin,
    }

    const acquired = await acquirePrimary(solari, ledger)
    primary = acquired.session
    result.lifecycle.createMs = acquired.createMs
    result.recording.accepted = acquired.recordingAccepted

    const verified = await verifyMutation(primary, target)
    result.lifecycle.cdpConnectMs = verified.cdpConnectMs
    result.lifecycle.mutateAndAdminReadMs = verified.mutateAndAdminReadMs
    result.mutation = {
      semanticFormLoaded: true,
      revisionDelta: verified.revisionDelta,
      serverStateConfirmed: true,
    }
    await verified.browser.close()

    const releaseStart = performance.now()
    await releaseSession(solari, ledger, primary)
    result.lifecycle.releaseMs = elapsedMs(releaseStart)
    try {
      await solari.sessions.releaseAndWait(primary.id)
      result.lifecycle.idempotentRelease = "confirmed"
    } catch (error) {
      result.lifecycle.idempotentRelease = isReleasedOrMissing(error)
        ? "not_found_is_success"
        : "failed"
    }

    if (acquired.recordingAccepted) {
      const replay = await pollReplay(solari, primary.id)
      result.recording.replay = replay.state
      result.recording.replayPollAttempts = replay.attempts
      result.recording.replayReadyMs = replay.readyMs
    } else {
      result.recording.replay = "unsupported"
    }

    const concurrency = await measureConcurrency(solari, ledger, ceiling)
    result.concurrency = { attemptedCeiling: ceiling, ...concurrency }
    if (result.lifecycle.idempotentRelease === "failed") {
      result.failure = {
        kind: "CapabilityError",
        code: "IDEMPOTENT_RELEASE_FAILED",
      }
    } else {
      result.status = "passed"
    }
  } catch (error) {
    result.failure = toSafeError(error)
  } finally {
    for (const session of ledger.unreleased()) {
      await releaseSession(solari, ledger, session).catch(() => {})
    }
    result.cleanup = ledger.accounting()
    if (result.cleanup.unaccounted > 0) result.status = "blocked"
    await target?.close().catch(() => {})
    await solari.close().catch(() => {})
  }

  console.log(JSON.stringify(result, null, 2))
  if (result.status !== "passed") process.exitCode = 1
}

await main()
