import assert from "node:assert/strict"
import { test } from "node:test"

import { SolariError } from "@solarisdk/browser"
import {
  BrowserAcquireRequestSchema,
  TraceGateError,
  isBrowserProviderConcurrencyLimitError,
} from "@tracegate/shared"

import { SolariBrowserProvider } from "./browser-provider.js"

const REQUEST = BrowserAcquireRequestSchema.parse({
  evaluationId: "00000000-0000-7000-8000-000000000001",
  runId: "00000000-0000-7000-8000-000000000002",
  modelId: "deepseek/deepseek-v4-flash-0731",
  attemptCorrelationId: "attempt-correlation-0001",
  recordingRequested: true,
  region: "us-west",
})

function fakeClient(options: {
  create?: () => Promise<{ id: string; cdpEndpoint: string }>
  release?: (sessionId: string) => Promise<void>
} = {}) {
  const calls = { create: 0, release: 0, close: 0, recordings: [] as boolean[] }
  const client = {
    sessions: {
      async create(input: { recording: boolean }) {
        calls.create += 1
        calls.recordings.push(input.recording)
        if (options.create) return options.create()
        return { id: "session-test", cdpEndpoint: "wss://provider.invalid/cdp" }
      },
      async releaseAndWait(sessionId: string) {
        calls.release += 1
        if (options.release) await options.release(sessionId)
      },
    },
    async close() { calls.close += 1 },
  }
  return { client, calls }
}

function provider(fake = fakeClient()) {
  return {
    provider: new SolariBrowserProvider(
      { apiKey: "test-only-key" },
      { client: fake.client, now: () => new Date("2026-09-01T12:00:00.000Z") },
    ),
    calls: fake.calls,
  }
}

test("rejects abort and unsupported region before provider create", async () => {
  const first = provider()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(first.provider.acquire(REQUEST, controller.signal), (error) => {
    return error instanceof TraceGateError && error.safe.code === "operation_aborted"
  })
  assert.equal(first.calls.create, 0)

  const second = provider()
  await assert.rejects(
    second.provider.acquire({ ...REQUEST, region: "eu-central" }, new AbortController().signal),
    (error) => error instanceof TraceGateError && error.safe.code === "validation_failed",
  )
  assert.equal(second.calls.create, 0)
})

test("creates exactly once and forwards recording", async () => {
  const fixture = provider()
  const lease = await fixture.provider.acquire(REQUEST, new AbortController().signal)
  assert.equal(fixture.calls.create, 1)
  assert.deepEqual(fixture.calls.recordings, [true])
  assert.equal(lease.recordingRequested, true)
  assert.equal(lease.region, "us-west")
  assert.equal(String(lease.connectEndpoint), "wss://provider.invalid/cdp")
})

test("maps definitive concurrency and unknown transport outcomes without retry", async () => {
  const limited = provider(fakeClient({
    create: async () => { throw new SolariError("limited", 429, undefined, "ConcurrencyLimitExceeded") },
  }))
  await assert.rejects(
    limited.provider.acquire(REQUEST, new AbortController().signal),
    (error) => isBrowserProviderConcurrencyLimitError(error),
  )
  assert.equal(limited.calls.create, 1)

  const ambiguous = provider(fakeClient({
    create: async () => { throw new TypeError("transport failed") },
  }))
  await assert.rejects(
    ambiguous.provider.acquire(REQUEST, new AbortController().signal),
    (error) => {
      if (!(error instanceof TraceGateError)) return false
      const safe = error.safe
      return safe.code === "session_create_ambiguous" &&
        "attemptCorrelationId" in safe &&
        safe.attemptCorrelationId === REQUEST.attemptCorrelationId
    },
  )
  assert.equal(ambiguous.calls.create, 1)
})

test("does not retry a definitive provider create failure", async () => {
  const fixture = provider(fakeClient({
    create: async () => { throw new SolariError("forbidden", 403) },
  }))
  await assert.rejects(
    fixture.provider.acquire(REQUEST, new AbortController().signal),
    (error) => error instanceof TraceGateError && error.safe.code === "service_unavailable",
  )
  assert.equal(fixture.calls.create, 1)
})

test("releases an acknowledged malformed session before returning a safe error", async () => {
  const fixture = provider(fakeClient({
    create: async () => ({ id: "session-malformed", cdpEndpoint: "ftp://provider.invalid/cdp" }),
  }))
  await assert.rejects(
    fixture.provider.acquire(REQUEST, new AbortController().signal),
    (error) => {
      if (!(error instanceof TraceGateError)) return false
      const serialized = JSON.stringify(error.toJSON())
      return error.safe.code === "service_unavailable" &&
        !serialized.includes("session-malformed") &&
        !serialized.includes("provider.invalid")
    },
  )
  assert.equal(fixture.calls.create, 1)
  assert.equal(fixture.calls.release, 1)
})

test("release is idempotent and only provider success confirms cleanup", async () => {
  const confirmed = provider()
  const lease = await confirmed.provider.acquire(REQUEST, new AbortController().signal)
  const [first, second] = await Promise.all([
    lease.release("complete", AbortSignal.abort()),
    lease.release("duplicate", new AbortController().signal),
  ])
  assert.deepEqual(first, second)
  assert.equal(first.status, "released")
  assert.equal(first.confirmation, "confirmed_released")
  assert.equal(first.releasedAt, "2026-09-01T12:00:00.000Z")
  assert.equal(confirmed.calls.release, 1)

  const missing = provider(fakeClient({
    release: async () => { throw new SolariError("not found", 404, undefined, "InvalidSessionId") },
  }))
  const missingLease = await missing.provider.acquire(REQUEST, new AbortController().signal)
  const failed = await missingLease.release("complete", new AbortController().signal)
  assert.equal(failed.status, "failed")
  assert.equal(failed.confirmation, "unconfirmed")
  assert.equal(failed.releasedAt, null)
  assert.equal(missing.calls.release, 1)
})

test("provider close is idempotent", async () => {
  const fixture = provider()
  await Promise.all([fixture.provider.close(), fixture.provider.close()])
  assert.equal(fixture.calls.close, 1)
})
