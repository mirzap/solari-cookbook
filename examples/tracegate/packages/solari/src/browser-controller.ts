import {
  ObservationRevisionSchema,
  RunWarningSchema,
  TraceGateError,
  UntrustedAgentObservationSchema,
  createControlError,
  type BrowserController,
  type BrowserControllerFactory,
  type BrowserLease,
  type CompactElement,
  type ElementActionInput,
  type ObservationRevision,
  type PolicyActivitySummary,
  type PolicyDenyCode,
  type UntrustedAgentObservation,
} from "@tracegate/shared"
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core"

import {
  assertAllowedNavigation,
  blockedByPolicy,
  canonicalAllowedOrigins,
  classifyObservableRequest,
  obviousUnsafeControl,
  type PolicyElementSnapshot,
} from "./policy.js"

const SEMANTIC_SELECTOR = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "option",
  "textarea",
  "[role]",
  '[contenteditable="true"]',
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "main",
  "nav",
  "article",
  "li",
  "img[alt]",
].join(",")

const ALLOWED_KEYS = new Set([
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
])

interface ElementSnapshot extends PolicyElementSnapshot {
  readonly checked: boolean | null
  readonly selected: boolean | null
  readonly expanded: boolean | null
}

interface RegistryEntry {
  readonly ref: string
  readonly revision: ObservationRevision
  readonly locator: Locator
  readonly identity: Pick<ElementSnapshot, "tag" | "role" | "name">
  readonly snapshot: ElementSnapshot
}

export interface CurrentPageDiscoverySnapshot {
  readonly observationRevision: ObservationRevision
  readonly jsonLdTexts: readonly string[]
  readonly webMcpPresent: boolean
}

export interface CurrentOriginTextResult {
  readonly status: number
  readonly finalUrl: string
  readonly text: string
  readonly truncated: boolean
}

export interface CurrentAssertionSnapshot {
  readonly documentId: string
  readonly loaderId: string
  readonly observation: UntrustedAgentObservation
  readonly policyActivity: PolicyActivitySummary
}

export interface RawCurrentOriginWebMcpTool {
  readonly name: string
  readonly title: string | null
  readonly description: string
  readonly inputSchema: unknown
  readonly annotations: unknown
}

export interface SolariBrowserControllerOptions {
  readonly allowedOrigins: readonly string[]
  readonly maxObservationBytes?: number
  readonly actionTimeoutMs?: number
}

export interface SolariBrowserControllerFactoryOptions
  extends SolariBrowserControllerOptions {}

function staleElement(message = "Element reference is stale"): TraceGateError {
  return new TraceGateError(
    RunWarningSchema.parse({
      schemaVersion: 1,
      category: "tool_error",
      code: "stale_element",
      phase: "browser_action",
      retryable: true,
      message,
      fieldIssues: [],
      causeChain: [],
    }),
  )
}

function ambiguousElement(): TraceGateError {
  return new TraceGateError(
    RunWarningSchema.parse({
      schemaVersion: 1,
      category: "ambiguity",
      code: "ambiguous_element",
      phase: "browser_action",
      retryable: true,
      message: "Element semantic identity changed",
      fieldIssues: [],
      causeChain: [],
    }),
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TraceGateError(
      createControlError("operation_aborted", "Browser operation aborted", {
        category: "cancellation",
        phase: "browser_action",
      }),
    )
  }
}

function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8")
  if (bytes.length <= maxBytes) return { value, truncated: false }
  let end = Math.max(0, maxBytes)
  while (end > 0 && (bytes[end] ?? 0) >= 0x80 && (bytes[end] ?? 0) < 0xc0) end -= 1
  return { value: bytes.subarray(0, end).toString("utf8"), truncated: true }
}

async function readElement(locator: Locator): Promise<ElementSnapshot> {
  return locator.evaluate((node) => {
    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    const input = element instanceof HTMLInputElement ? element : null
    const select = element instanceof HTMLSelectElement ? element : null
    const option = element instanceof HTMLOptionElement ? element : null
    const explicitRole = element.getAttribute("role")?.trim()
    const inferredRole =
      tag === "a"
        ? "link"
        : tag === "button"
          ? "button"
          : tag === "select"
            ? "combobox"
          : tag === "textarea"
              ? "textbox"
              : tag === "option"
                ? "option"
              : /^h[1-6]$/.test(tag)
                ? "heading"
                : tag === "main"
                  ? "main"
                  : tag === "nav"
                    ? "navigation"
                    : tag === "article"
                      ? "article"
                      : tag === "li"
                        ? "listitem"
                        : tag === "img"
                          ? "img"
                          : input?.type === "checkbox"
                            ? "checkbox"
                            : input?.type === "radio"
                              ? "radio"
                              : input?.type === "submit"
                                ? "button"
                                : tag === "input" || element.isContentEditable
                                  ? "textbox"
                                  : "control"
    const labelText =
      input?.labels?.[0]?.textContent ??
      select?.labels?.[0]?.textContent ??
      (element instanceof HTMLTextAreaElement ? element.labels?.[0]?.textContent : null)
    const name =
      element.getAttribute("aria-label") ??
      labelText ??
      element.getAttribute("alt") ??
      element.getAttribute("title") ??
      (input?.type === "submit" ? input.value : null) ??
      element.innerText ??
      element.textContent ??
      ""
    const attributes: Record<string, string> = {}
    for (const attribute of ["type", "name", "placeholder", "autocomplete", "href"] as const) {
      const value = element.getAttribute(attribute)
      if (value) attributes[attribute] = value.slice(0, 500)
    }
    if (input?.form) attributes.formmethod = input.form.method.toLowerCase()
    if (element instanceof HTMLButtonElement && element.form) {
      attributes.formmethod = element.formMethod.toLowerCase() || element.form.method.toLowerCase()
    }
    if (input && !["password", "file", "email", "tel"].includes(input.type)) {
      attributes.value = input.value.slice(0, 500)
    } else if (select) {
      attributes.value = select.value.slice(0, 500)
    } else if (element instanceof HTMLTextAreaElement) {
      attributes.value = element.value.slice(0, 500)
    }
    return {
      tag,
      role: explicitRole || inferredRole,
      name: name.replace(/\s+/g, " ").trim().slice(0, 500),
      disabled: "disabled" in element ? Boolean((element as HTMLButtonElement).disabled) : null,
      checked:
        input && ["checkbox", "radio"].includes(input.type)
          ? input.checked
          : element.getAttribute("aria-checked") === null
            ? null
            : element.getAttribute("aria-checked") === "true",
      selected:
        option
          ? option.selected
          : element.getAttribute("aria-selected") === null
            ? null
            : element.getAttribute("aria-selected") === "true",
      expanded:
        element.getAttribute("aria-expanded") === null
          ? null
          : element.getAttribute("aria-expanded") === "true",
      attributes,
    }
  })
}

export class SolariCdpBrowserController implements BrowserController {
  readonly #allowedOrigins: Set<string>
  readonly #maxObservationBytes: number
  readonly #actionTimeoutMs: number
  #browser: Browser | null = null
  #context: BrowserContext | null = null
  #page: Page | null = null
  #revision = 0
  #registry = new Map<string, RegistryEntry>()
  #initialNavigationCompleted = false
  #hasDispatchedAgentAction = false
  #documentSequence = 0
  #passivePolicyCount = 0
  #fatalPolicyCount = 0
  #passivePolicyCodes: PolicyDenyCode[] = []
  #fatalPolicyCodes: PolicyDenyCode[] = []

  constructor(options: SolariBrowserControllerOptions) {
    this.#allowedOrigins = canonicalAllowedOrigins(options.allowedOrigins)
    this.#maxObservationBytes = options.maxObservationBytes ?? 12_288
    this.#actionTimeoutMs = options.actionTimeoutMs ?? 15_000
  }

  async connect(lease: BrowserLease, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (this.#browser) throw new Error("Browser controller is already connected")
    this.#browser = await chromium.connectOverCDP(lease.connectEndpoint, {
      timeout: this.#actionTimeoutMs,
    })
    throwIfAborted(signal)
    this.#context = this.#browser.contexts()[0] ?? null
    if (!this.#context) {
      await this.close(AbortSignal.timeout(5_000))
      throw new Error("Solari CDP returned no default context")
    }
    await this.#context.clearCookies()
    this.#page = this.#context.pages()[0] ?? (await this.#context.newPage())
    this.#page.setDefaultTimeout(this.#actionTimeoutMs)
    this.#page.on("framenavigated", (frame) => {
      if (frame === this.#page?.mainFrame()) this.#documentSequence += 1
    })
    await this.#installPolicyHandlers(this.#context, this.#page)
    await this.#blockServiceWorkers(this.#context, this.#page)
  }

  async close(_signal: AbortSignal): Promise<void> {
    const browser = this.#browser
    this.#browser = null
    this.#context = null
    this.#page = null
    this.#registry.clear()
    if (browser) await browser.close().catch(() => {})
  }

  async navigate(url: string, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    const target = assertAllowedNavigation(url, this.#allowedOrigins)
    if (this.#initialNavigationCompleted) this.#hasDispatchedAgentAction = true
    const page = this.#requirePage()
    await page.goto(target.href, {
      waitUntil: "domcontentloaded",
      timeout: this.#actionTimeoutMs,
    })
    this.#initialNavigationCompleted = true
    throwIfAborted(signal)
    this.#assertCurrentOrigin()
    return this.observe(signal)
  }

  async observe(signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    this.#throwIfFatalPolicyViolation()
    const page = this.#requirePage()
    this.#assertCurrentOrigin()
    this.#revision += 1
    const revision = ObservationRevisionSchema.parse(this.#revision)
    this.#registry.clear()

    const controls = page.locator(SEMANTIC_SELECTOR)
    const totalCount = await controls.count()
    const count = Math.min(totalCount, 100)
    const elements: CompactElement[] = []
    for (let index = 0; index < count; index += 1) {
      const locator = controls.nth(index)
      if (!(await locator.isVisible().catch(() => false))) continue
      const snapshot = await readElement(locator).catch(() => null)
      if (!snapshot) continue
      const ref = `e:${revision}:${elements.length}`
      elements.push({
        ref,
        role: snapshot.role,
        name: snapshot.name,
        disabled: snapshot.disabled,
        checked: snapshot.checked,
        selected: snapshot.selected,
        expanded: snapshot.expanded,
        attributes: snapshot.attributes,
      })
      this.#registry.set(ref, {
        ref,
        revision,
        locator,
        identity: { tag: snapshot.tag, role: snapshot.role, name: snapshot.name },
        snapshot,
      })
    }

    const bodyText = await page.locator("body").innerText().catch(() => "")
    const textBudget = Math.max(1_024, this.#maxObservationBytes - 4_096)
    const visibleText = truncateUtf8(bodyText.replace(/\s+/g, " ").trim(), textBudget)
    return UntrustedAgentObservationSchema.parse({
      schemaVersion: 2,
      trust: "untrusted_page_content",
      revision,
      url: page.url(),
      title: (await page.title()).slice(0, 500),
      visibleText: visibleText.value.slice(0, 20_000),
      elements,
      discoverySummary: `${elements.length} visible semantic elements`,
      truncated: visibleText.truncated || totalCount > 100,
    })
  }

  async click(input: ElementActionInput, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    this.#hasDispatchedAgentAction = true
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    const href = entry.snapshot.attributes.href
    if (href) assertAllowedNavigation(new URL(href, this.#requirePage().url()).href, this.#allowedOrigins)
    await entry.locator.click({ timeout: this.#actionTimeoutMs })
    return this.observe(signal)
  }

  async type(
    input: ElementActionInput & { readonly text: string; readonly clearFirst: boolean },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    if (Buffer.byteLength(input.text, "utf8") > 4_000) throw new Error("Text is too large")
    this.#hasDispatchedAgentAction = true
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    if (input.clearFirst) await entry.locator.fill(input.text)
    else await entry.locator.pressSequentially(input.text)
    return this.observe(signal)
  }

  async select(
    input: ElementActionInput & { readonly value: string },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    this.#hasDispatchedAgentAction = true
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    await entry.locator.selectOption(input.value)
    return this.observe(signal)
  }

  async pressKey(
    input: ElementActionInput & { readonly key: string },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    this.#hasDispatchedAgentAction = true
    if (!ALLOWED_KEYS.has(input.key)) {
      throw blockedByPolicy("press_key_forbidden", "Keyboard key is not allowed")
    }
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    await entry.locator.press(input.key)
    return this.observe(signal)
  }

  async scroll(
    direction: "up" | "down",
    amount: number,
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    this.#hasDispatchedAgentAction = true
    if (!Number.isInteger(amount) || amount < 1 || amount > 5_000) {
      throw new Error("Scroll amount is out of bounds")
    }
    await this.#requirePage().mouse.wheel(0, direction === "down" ? amount : -amount)
    return this.observe(signal)
  }

  async wait(durationMs: number, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    this.#hasDispatchedAgentAction = true
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 15_000) {
      throw new Error("Wait duration is out of bounds")
    }
    await this.#requirePage().waitForTimeout(durationMs)
    throwIfAborted(signal)
    return this.observe(signal)
  }

  async currentPageDiscoverySnapshot(
    signal: AbortSignal,
  ): Promise<CurrentPageDiscoverySnapshot> {
    throwIfAborted(signal)
    const page = this.#requirePage()
    const texts = await page.locator('script[type="application/ld+json"]').allTextContents()
    let total = 0
    const jsonLdTexts: string[] = []
    for (const text of texts) {
      const bytes = Buffer.byteLength(text, "utf8")
      if (total + bytes > 65_536) break
      jsonLdTexts.push(text)
      total += bytes
    }
    const webMcpPresent = await page.evaluate(() => "modelContext" in document)
    return {
      observationRevision: ObservationRevisionSchema.parse(this.#revision),
      jsonLdTexts,
      webMcpPresent,
    }
  }

  async currentOriginWebMcpTools(
    signal: AbortSignal,
  ): Promise<readonly RawCurrentOriginWebMcpTool[]> {
    throwIfAborted(signal)
    this.#assertCurrentOrigin()
    return this.#requirePage().evaluate(async () => {
      const modelContext = (
        document as Document & {
          modelContext?: {
            getTools?: (options?: { fromOrigins?: string[] }) => Promise<unknown[]>
          }
        }
      ).modelContext
      if (!modelContext?.getTools) return []
      const tools = await modelContext.getTools({ fromOrigins: [] })
      return tools.slice(0, 25).map((candidate) => {
        const tool = candidate as Record<string, unknown>
        return {
          name: typeof tool.name === "string" ? tool.name : "",
          title: typeof tool.title === "string" ? tool.title : null,
          description: typeof tool.description === "string" ? tool.description : "",
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        }
      })
    })
  }

  currentBrowserOrigin(): string {
    this.#assertCurrentOrigin()
    return new URL(this.#requirePage().url()).origin
  }

  async invokeCurrentOriginWebMcpTool(
    name: string,
    input: Readonly<Record<string, string | number | boolean | null>>,
    signal: AbortSignal,
  ): Promise<string> {
    throwIfAborted(signal)
    this.#hasDispatchedAgentAction = true
    this.#assertCurrentOrigin()
    const page = this.#requirePage()
    const execution = page.evaluate(
      async ({ toolName, toolInput }) => {
        const modelContext = (
          document as Document & {
            modelContext?: {
              getTools?: (options?: { fromOrigins?: string[] }) => Promise<unknown[]>
              executeTool?: (tool: unknown, input: object) => Promise<string>
            }
          }
        ).modelContext
        if (!modelContext?.getTools || !modelContext.executeTool) {
          throw new Error("WebMCP is unavailable")
        }
        const tools = await modelContext.getTools({ fromOrigins: [] })
        const tool = tools.find(
          (candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            (candidate as { name?: unknown }).name === toolName,
        )
        if (!tool) throw new Error("WebMCP tool changed before invocation")
        return modelContext.executeTool(tool, toolInput)
      },
      { toolName: name, toolInput: input },
    )
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("WebMCP invocation aborted", "AbortError")),
        { once: true },
      )
    })
    try {
      const result = await Promise.race([execution, aborted])
      this.#throwIfFatalPolicyViolation()
      this.#assertCurrentOrigin()
      return result
    } catch (error) {
      if (signal.aborted) await this.close(AbortSignal.timeout(5_000))
      throw error
    }
  }

  async readCurrentOriginText(
    path: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<CurrentOriginTextResult> {
    throwIfAborted(signal)
    if (!path.startsWith("/") || maxBytes < 1 || maxBytes > 65_536) {
      throw new Error("Current-origin discovery request is invalid")
    }
    const page = this.#requirePage()
    this.#assertCurrentOrigin()
    return page.evaluate(
      async ({ requestedPath, maximumBytes }) => {
        try {
          const requested = new URL(requestedPath, location.origin)
          const response = await fetch(requested, {
            method: "GET",
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
          })
          if (new URL(response.url || requested.href).origin !== location.origin) {
            return { status: 0, finalUrl: requested.href, text: "", truncated: false }
          }
          const reader = response.body?.getReader()
          if (!reader) return { status: response.status, finalUrl: response.url, text: "", truncated: false }
          const chunks: Uint8Array[] = []
          let total = 0
          let truncated = false
          while (true) {
            const next = await reader.read()
            if (next.done) break
            const remaining = maximumBytes - total
            if (next.value.byteLength > remaining) {
              if (remaining > 0) chunks.push(next.value.subarray(0, remaining))
              truncated = true
              await reader.cancel()
              break
            }
            chunks.push(next.value)
            total += next.value.byteLength
          }
          const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
          const bytes = new Uint8Array(size)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
          }
          return {
            status: response.status,
            finalUrl: response.url,
            text: new TextDecoder().decode(bytes),
            truncated,
          }
        } catch {
          return { status: 0, finalUrl: new URL(requestedPath, location.origin).href, text: "", truncated: false }
        }
      },
      { requestedPath: path, maximumBytes: maxBytes },
    )
  }

  async currentAssertionSnapshot(signal: AbortSignal): Promise<CurrentAssertionSnapshot> {
    const observation = await this.observe(signal)
    const identity = Math.max(1, this.#documentSequence)
    return {
      documentId: `document-${identity}`,
      loaderId: `loader-${identity}`,
      observation,
      policyActivity: {
        passiveWarningCount: this.#passivePolicyCount,
        agentBlockedCount: this.#fatalPolicyCount,
        codes: [...new Set([...this.#passivePolicyCodes, ...this.#fatalPolicyCodes])],
      },
    }
  }

  async #resolve(
    input: ElementActionInput,
    signal: AbortSignal,
  ): Promise<RegistryEntry> {
    throwIfAborted(signal)
    this.#throwIfFatalPolicyViolation()
    if (input.observationRevision !== this.#revision) throw staleElement()
    const entry = this.#registry.get(input.ref)
    if (!entry || entry.revision !== input.observationRevision) throw staleElement()
    if (!(await entry.locator.isVisible().catch(() => false))) throw staleElement()
    const current = await readElement(entry.locator).catch(() => null)
    if (!current) throw staleElement()
    if (
      current.tag !== entry.identity.tag ||
      current.role !== entry.identity.role ||
      current.name !== entry.identity.name
    ) {
      throw ambiguousElement()
    }
    return { ...entry, snapshot: current }
  }

  #assertElementSafe(snapshot: ElementSnapshot): void {
    const denyCode = obviousUnsafeControl(snapshot)
    if (denyCode) throw blockedByPolicy(denyCode, "Control is outside TraceGate's safe public-task policy")
  }

  #requirePage(): Page {
    if (!this.#page) throw new Error("Browser controller is not connected")
    return this.#page
  }

  #assertCurrentOrigin(): void {
    const page = this.#requirePage()
    const url = new URL(page.url())
    if (url.protocol !== "https:" || !this.#allowedOrigins.has(url.origin)) {
      throw blockedByPolicy("origin_not_admitted", "Page left the declared navigation origins")
    }
  }

  #recordPolicy(code: PolicyDenyCode): void {
    const fatal = this.#hasDispatchedAgentAction
    if (fatal) this.#fatalPolicyCount = Math.min(1_000, this.#fatalPolicyCount + 1)
    else this.#passivePolicyCount = Math.min(1_000, this.#passivePolicyCount + 1)
    const destination = fatal ? this.#fatalPolicyCodes : this.#passivePolicyCodes
    if (!destination.includes(code)) destination.push(code)
  }

  #throwIfFatalPolicyViolation(): void {
    const code = this.#fatalPolicyCodes[0]
    if (code) throw blockedByPolicy(code, "An observable prohibited browser action or request was blocked")
  }

  async #installPolicyHandlers(context: BrowserContext, page: Page): Promise<void> {
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}))
    page.on("download", (download) => {
      this.#recordPolicy("upload_or_download_forbidden")
      void download.cancel().catch(() => {})
    })
    page.on("filechooser", (chooser) => {
      this.#recordPolicy("upload_or_download_forbidden")
      void chooser.setFiles([]).catch(() => {})
    })
    context.on("page", (candidate) => {
      if (candidate !== page) {
        this.#recordPolicy("popup_forbidden")
        void candidate.close().catch(() => {})
      }
    })
    await context.routeWebSocket("**/*", async (route) => {
      this.#recordPolicy("alternate_protocol_forbidden")
      await route.close({ code: 1008, reason: "TraceGate blocks WebSocket" }).catch(() => {})
    })
    await context.route("**/*", async (route) => {
      const request = route.request()
      const denyCode = classifyObservableRequest(
        {
          url: request.url(),
          method: request.method(),
          hasBody: request.postData() !== null,
          mainFrameNavigation:
            request.isNavigationRequest() && request.frame() === page.mainFrame(),
        },
        this.#allowedOrigins,
      )
      if (denyCode) {
        this.#recordPolicy(denyCode)
        await route.abort("blockedbyclient").catch(() => {})
        return
      }
      await route.continue().catch(() => {})
    })
  }

  async #blockServiceWorkers(context: BrowserContext, page: Page): Promise<void> {
    await context.addInitScript(() => {
      const serviceWorker = navigator.serviceWorker
      if (!serviceWorker) return
      Object.defineProperty(serviceWorker, "register", {
        configurable: false,
        value: () => Promise.reject(new DOMException("Blocked by TraceGate", "NotAllowedError")),
      })
    })
    await page
      .evaluate(async () => {
        if (!navigator.serviceWorker) return
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.unregister()))
      })
      .catch(() => {})
    const cdp = await context.newCDPSession(page).catch(() => null)
    if (cdp) {
      await cdp.send("Network.enable").catch(() => {})
      await cdp.send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {})
      await cdp.detach().catch(() => {})
    }
  }
}

export class SolariBrowserControllerFactory implements BrowserControllerFactory {
  constructor(private readonly options: SolariBrowserControllerFactoryOptions) {}

  async create(
    _lease: BrowserLease,
    signal: AbortSignal,
  ): Promise<BrowserController> {
    throwIfAborted(signal)
    return new SolariCdpBrowserController(this.options)
  }
}
