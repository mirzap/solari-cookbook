import assert from "node:assert/strict"
import { test } from "node:test"

import type {
  BrowserLease,
  BrowserSessionId,
  SensitiveBrowserEndpoint,
} from "@tracegate/shared"
import type { Browser, BrowserContext, Page } from "playwright-core"

import {
  SolariBrowserControllerFactory,
  SolariCdpBrowserController,
} from "./browser-controller.js"

const LEASE: BrowserLease = {
  providerSessionId: "session-test" as BrowserSessionId,
  connectEndpoint: "wss://provider.invalid/cdp" as SensitiveBrowserEndpoint,
  region: "us-west",
  recordingRequested: false,
  async release() {
    return {
      status: "released",
      confirmation: "confirmed_released",
      releasedAt: "2026-09-01T12:00:00.000Z",
      warning: null,
    }
  },
}

function connectedFixture(options: { failNewContext?: boolean } = {}) {
  const calls: string[] = []
  const page = {
    setDefaultTimeout() { calls.push("page.timeout") },
    on(event: string) { calls.push(`page.on:${event}`) },
    mainFrame() { return {} },
  } as unknown as Page
  const context = {
    async addInitScript() { calls.push("context.init") },
    async newPage() { calls.push("context.newPage"); return page },
    on(event: string) { calls.push(`context.on:${event}`) },
    async routeWebSocket() { calls.push("context.routeWebSocket") },
    async route() { calls.push("context.route") },
    async newCDPSession() {
      calls.push("context.cdp")
      return {
        async send() { calls.push("cdp.send") },
        async detach() { calls.push("cdp.detach") },
      }
    },
    async close() { calls.push("context.close") },
  } as unknown as BrowserContext
  const browser = {
    contexts() { throw new Error("default context must never be read") },
    async newContext(input: unknown) {
      calls.push(`browser.newContext:${JSON.stringify(input)}`)
      if (options.failNewContext) throw new Error("new context unavailable")
      return context
    },
    async close() { calls.push("browser.close") },
  } as unknown as Browser
  const connectOverCdp = async () => {
    calls.push("connect")
    return browser
  }
  return { calls, connectOverCdp }
}

test("controller requires a newly created service-worker-blocked context", async () => {
  const fixture = connectedFixture()
  const controller = new SolariCdpBrowserController(
    { allowedOrigins: ["https://public.example"] },
    { connectOverCdp: fixture.connectOverCdp },
  )
  await controller.connect(LEASE, new AbortController().signal)

  const contextCall = fixture.calls.find((call) => call.startsWith("browser.newContext:"))
  assert.equal(
    contextCall,
    'browser.newContext:{"serviceWorkers":"block","acceptDownloads":false}',
  )
  assert.ok(fixture.calls.indexOf("context.init") < fixture.calls.indexOf("context.newPage"))
  assert.ok(fixture.calls.includes("context.route"))
  assert.ok(fixture.calls.includes("context.routeWebSocket"))
  assert.ok(fixture.calls.includes("context.cdp"))

  await controller.close(AbortSignal.abort())
  await controller.close(new AbortController().signal)
  assert.equal(fixture.calls.filter((call) => call === "context.close").length, 1)
  assert.equal(fixture.calls.filter((call) => call === "browser.close").length, 1)
})

test("new-context failure has no default-context fallback and closes CDP", async () => {
  const fixture = connectedFixture({ failNewContext: true })
  const controller = new SolariCdpBrowserController(
    { allowedOrigins: ["https://public.example"] },
    { connectOverCdp: fixture.connectOverCdp },
  )
  await assert.rejects(
    controller.connect(LEASE, new AbortController().signal),
    /new context unavailable/,
  )
  assert.equal(fixture.calls.filter((call) => call.startsWith("browser.newContext:")).length, 1)
  assert.equal(fixture.calls.filter((call) => call === "browser.close").length, 1)
})

function semanticFixture() {
  const calls = { clicks: 0 }
  const mainFrame = {}
  let frameHandler: ((frame: unknown) => void) | null = null
  let name = "Show details"
  const elementLocator = {
    async isVisible() { return true },
    async evaluate() {
      return {
        tag: "button",
        role: "button",
        name,
        disabled: false,
        checked: null,
        selected: null,
        expanded: false,
        attributes: { type: "button" },
      }
    },
    async click() { calls.clicks += 1 },
  }
  const controls = {
    async count() { return 1 },
    nth() { return elementLocator },
  }
  const body = {
    async evaluate() { return "Visible details ".repeat(1_000).slice(0, 20_001) },
  }
  const page = {
    setDefaultTimeout() {},
    on(event: string, handler: (value: unknown) => void) {
      if (event === "framenavigated") frameHandler = handler
    },
    mainFrame() { return mainFrame },
    async goto() {},
    url() { return "https://public.example/" },
    async title() { return "Public fixture" },
    locator(selector: string) { return selector === "body" ? body : controls },
  } as unknown as Page
  const context = {
    async addInitScript() {},
    async newPage() { return page },
    on() {},
    async routeWebSocket() {},
    async route() {},
    async newCDPSession() { return { async send() {}, async detach() {} } },
    async close() {},
  } as unknown as BrowserContext
  const browser = {
    async newContext() { return context },
    async close() {},
  } as unknown as Browser
  return {
    calls,
    connectOverCdp: async () => browser,
    replaceDocument() { frameHandler?.(mainFrame) },
    changeName(value: string) { name = value },
  }
}

test("observations use bounded revision refs and reject stale or changed identity", async () => {
  const fixture = semanticFixture()
  const controller = new SolariCdpBrowserController(
    { allowedOrigins: ["https://public.example"], maxObservationBytes: 2_048 },
    { connectOverCdp: fixture.connectOverCdp },
  )
  await controller.connect(LEASE, new AbortController().signal)
  const first = await controller.navigate("https://public.example/", new AbortController().signal)
  assert.equal(first.elements[0]?.ref, "e:1:0")
  assert.equal(first.truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(first), "utf8") <= 2_048)

  fixture.replaceDocument()
  await assert.rejects(
    controller.click(
      { ref: first.elements[0]!.ref, observationRevision: first.revision },
      new AbortController().signal,
    ),
    (error) => error instanceof Error && "safe" in error &&
      (error as { safe: { code: string } }).safe.code === "stale_element",
  )
  assert.equal(fixture.calls.clicks, 0)

  const second = await controller.observe(new AbortController().signal)
  await assert.rejects(
    controller.click(
      { ref: first.elements[0]!.ref, observationRevision: first.revision },
      new AbortController().signal,
    ),
    (error) => error instanceof Error && "safe" in error &&
      (error as { safe: { code: string } }).safe.code === "stale_element",
  )
  assert.equal(fixture.calls.clicks, 0)

  fixture.changeName("Changed identity")
  await assert.rejects(
    controller.click(
      { ref: second.elements[0]!.ref, observationRevision: second.revision },
      new AbortController().signal,
    ),
    (error) => error instanceof Error && "safe" in error &&
      (error as { safe: { code: string } }).safe.code === "ambiguous_element",
  )
  assert.equal(fixture.calls.clicks, 0)
  await controller.close(new AbortController().signal)
})

test("controller factory returns a fresh controller per run", async () => {
  const factory = new SolariBrowserControllerFactory({
    allowedOrigins: ["https://public.example"],
  })
  const first = await factory.create(LEASE, new AbortController().signal)
  const second = await factory.create(LEASE, new AbortController().signal)
  assert.notEqual(first, second)
})
