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

const MAX_INTERNAL_DEADLINE_HEADROOM_MS = 2_000
const MIN_INTERNAL_DEADLINE_HEADROOM_MS = 250
const MAX_DOM_CONTENT_LOADED_GRACE_MS = 1_000
const MAX_DOCUMENT_QUIET_INTERVAL_MS = 150

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
  readonly truncated: boolean
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
  readonly jsonLdTruncated: boolean
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

export interface ExpectedCurrentOriginWebMcpTool {
  readonly name: string
  readonly description: string
  readonly rawInputSchema: unknown
  readonly declaredReadOnly: true
}

export interface CurrentOriginWebMcpInvocationResult {
  readonly serialized: string
  readonly truncated: boolean
}

export interface SolariBrowserControllerOptions {
  readonly allowedOrigins: readonly string[]
  readonly maxObservationBytes?: number
  /** Outer agent tool deadline; the controller reserves internal completion headroom. */
  readonly actionTimeoutMs?: number
}

export interface SolariBrowserControllerFactoryOptions
  extends SolariBrowserControllerOptions {}

type ConnectOverCdp = (
  endpoint: string,
  options: { timeout: number },
) => Promise<Browser>

/** Package-internal test seam; intentionally not exported from the public barrel. */
export interface SolariBrowserControllerDependencies {
  readonly connectOverCdp?: ConnectOverCdp
}

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

function abortedBrowserOperation(): TraceGateError {
  return new TraceGateError(
    createControlError("operation_aborted", "Browser operation aborted", {
      category: "cancellation",
      phase: "browser_action",
    }),
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortedBrowserOperation()
}

function browserPhaseFailure(
  phase: string,
  message: string,
  cause?: unknown,
): TraceGateError {
  return new TraceGateError(
    createControlError("service_unavailable", `Browser ${phase} ${message}`, {
      category: "infrastructure",
      phase: "browser_action",
      retryable: false,
    }),
    cause,
  )
}

function internalOperationTimeoutMs(outerTimeoutMs: number): number {
  if (!Number.isInteger(outerTimeoutMs) || outerTimeoutMs < 1_000) {
    throw new Error("Browser action timeout must be an integer of at least 1000ms")
  }
  const headroom = Math.min(
    MAX_INTERNAL_DEADLINE_HEADROOM_MS,
    Math.max(MIN_INTERNAL_DEADLINE_HEADROOM_MS, Math.floor(outerTimeoutMs * 0.15)),
  )
  return outerTimeoutMs - headroom
}

function remainingPhaseMs(deadline: number, phase: string): number {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw browserPhaseFailure(phase, "exceeded its internal deadline")
  return remaining
}

async function runBrowserPhase<T>(
  phase: string,
  timeoutMs: number,
  signal: AbortSignal,
  operation: (phaseSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  throwIfAborted(signal)
  const deadlineController = new AbortController()
  const phaseSignal = AbortSignal.any([signal, deadlineController.signal])
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    deadlineController.abort(new Error(`Browser ${phase} deadline exceeded`))
  }, timeoutMs)
  try {
    return await raceWithAbort(operation(phaseSignal), phaseSignal)
  } catch (error) {
    if (signal.aborted) throw abortedBrowserOperation()
    if (timedOut) throw browserPhaseFailure(phase, `timed out after ${timeoutMs}ms`, error)
    if (error instanceof TraceGateError) throw error
    throw browserPhaseFailure(phase, "failed", error)
  } finally {
    clearTimeout(timer)
  }
}

async function waitForOptionalBrowserPhase(
  phase: string,
  timeoutMs: number,
  signal: AbortSignal,
  operation: Promise<unknown>,
): Promise<boolean> {
  throwIfAborted(signal)
  let abortHandler: (() => void) | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    abortHandler = () => reject(abortedBrowserOperation())
    signal.addEventListener("abort", abortHandler, { once: true })
  })
  const settled = operation.then(
    () => true,
    (error: unknown) => {
      throw browserPhaseFailure(phase, "failed", error)
    },
  )
  try {
    return await Promise.race([
      settled,
      aborted,
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (abortHandler) signal.removeEventListener("abort", abortHandler)
  }
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  let abortHandler: (() => void) | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    abortHandler = () => reject(abortedBrowserOperation())
    signal.addEventListener("abort", abortHandler, { once: true })
  })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler)
  }
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    operation.catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs)
    }),
  ])
  if (timeout) clearTimeout(timeout)
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
    const normalizedName = name.replace(/\s+/g, " ").trim()
    let truncated = normalizedName.length > 500
    const attributes: Record<string, string> = {}
    for (const attribute of ["name", "placeholder", "autocomplete", "href", "target"] as const) {
      const value = element.getAttribute(attribute)
      if (value) {
        if (value.length > 500) truncated = true
        attributes[attribute] = value.slice(0, 500)
      }
    }
    if (input) attributes.type = input.type.toLowerCase()
    if (element instanceof HTMLButtonElement) attributes.type = element.type.toLowerCase()
    if (element instanceof HTMLAnchorElement && element.hasAttribute("download")) {
      attributes.download = "true"
    }
    if (input?.form) {
      attributes.formmethod = (input.formMethod || input.form.method).toLowerCase()
    }
    if (element instanceof HTMLButtonElement && element.form) {
      attributes.formmethod = (element.formMethod || element.form.method).toLowerCase()
    }
    if (input && !["password", "file", "email", "tel"].includes(input.type)) {
      if (input.value.length > 500) truncated = true
      attributes.value = input.value.slice(0, 500)
    } else if (select) {
      if (select.value.length > 500) truncated = true
      attributes.value = select.value.slice(0, 500)
    } else if (element instanceof HTMLTextAreaElement) {
      if (element.value.length > 500) truncated = true
      attributes.value = element.value.slice(0, 500)
    }
    return {
      tag,
      role: explicitRole || inferredRole,
      name: normalizedName.slice(0, 500),
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
      truncated,
    }
  })
}

export class SolariCdpBrowserController implements BrowserController {
  readonly #allowedOrigins: Set<string>
  readonly #maxObservationBytes: number
  readonly #internalOperationTimeoutMs: number
  readonly #connectOverCdp: ConnectOverCdp
  #browser: Browser | null = null
  #context: BrowserContext | null = null
  #page: Page | null = null
  #revision = 0
  #registry = new Map<string, RegistryEntry>()
  #initialNavigationCompleted = false
  #hasDispatchedAgentAction = false
  #documentSequence = 0
  #observedDocumentSequence: number | null = null
  #passivePolicyCount = 0
  #fatalPolicyCount = 0
  #passivePolicyCodes: PolicyDenyCode[] = []
  #fatalPolicyCodes: PolicyDenyCode[] = []
  #closePromise: Promise<void> | null = null

  constructor(
    options: SolariBrowserControllerOptions,
    dependencies: SolariBrowserControllerDependencies = {},
  ) {
    this.#allowedOrigins = canonicalAllowedOrigins(options.allowedOrigins)
    this.#maxObservationBytes = options.maxObservationBytes ?? 12_288
    if (this.#maxObservationBytes < 2_048 || this.#maxObservationBytes > 65_536) {
      throw new Error("Observation byte budget is out of bounds")
    }
    this.#internalOperationTimeoutMs = internalOperationTimeoutMs(options.actionTimeoutMs ?? 15_000)
    this.#connectOverCdp = dependencies.connectOverCdp ?? ((endpoint, connectOptions) =>
      chromium.connectOverCDP(endpoint, connectOptions))
  }

  async connect(lease: BrowserLease, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (this.#browser) throw new Error("Browser controller is already connected")
    if (this.#closePromise) throw new Error("Browser controller is already closed")

    let browser: Browser | null = null
    let context: BrowserContext | null = null
    const deadline = Date.now() + this.#internalOperationTimeoutMs
    try {
      browser = await runBrowserPhase(
        "CDP connection",
        remainingPhaseMs(deadline, "CDP connection"),
        signal,
        () => this.#connectOverCdp(String(lease.connectEndpoint), {
          timeout: remainingPhaseMs(deadline, "CDP connection"),
        }),
      )
      context = await runBrowserPhase(
        "context creation",
        remainingPhaseMs(deadline, "context creation"),
        signal,
        () => browser!.newContext({
          serviceWorkers: "block",
          acceptDownloads: false,
        }),
      )
      await runBrowserPhase(
        "service-worker guard setup",
        remainingPhaseMs(deadline, "service-worker guard setup"),
        signal,
        () => this.#installServiceWorkerInitScript(context!),
      )
      const page = await runBrowserPhase(
        "page creation",
        remainingPhaseMs(deadline, "page creation"),
        signal,
        () => context!.newPage(),
      )
      page.setDefaultTimeout(this.#internalOperationTimeoutMs)

      this.#browser = browser
      this.#context = context
      this.#page = page
      page.on("framenavigated", (frame) => {
        if (frame === this.#page?.mainFrame()) {
          this.#documentSequence += 1
          this.#observedDocumentSequence = null
          this.#registry.clear()
        }
      })
      await runBrowserPhase(
        "request-policy setup",
        remainingPhaseMs(deadline, "request-policy setup"),
        signal,
        () => this.#installPolicyHandlers(context!, page),
      )
      await runBrowserPhase(
        "service-worker bypass setup",
        remainingPhaseMs(deadline, "service-worker bypass setup"),
        signal,
        () => this.#enableServiceWorkerBypass(context!, page),
      )
      throwIfAborted(signal)
    } catch (error) {
      this.#browser = null
      this.#context = null
      this.#page = null
      this.#observedDocumentSequence = null
      this.#registry.clear()
      if (context) await settleWithin(context.close(), 5_000)
      if (browser) await settleWithin(browser.close(), 5_000)
      throw error
    }
  }

  async close(signal: AbortSignal): Promise<void> {
    if (!this.#closePromise) {
      const context = this.#context
      const browser = this.#browser
      this.#browser = null
      this.#context = null
      this.#page = null
      this.#observedDocumentSequence = null
      this.#registry.clear()
      this.#closePromise = (async () => {
        try {
          if (context) await settleWithin(context.close(), 5_000)
        } finally {
          if (browser) await settleWithin(browser.close(), 5_000)
        }
      })()
    }
    await raceWithAbort(this.#closePromise, signal)
  }

  async navigate(url: string, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    const target = assertAllowedNavigation(url, this.#allowedOrigins)
    if (this.#initialNavigationCompleted) this.#hasDispatchedAgentAction = true
    const page = this.#requirePage()
    const deadline = Date.now() + this.#internalOperationTimeoutMs
    let committed = false
    try {
      await runBrowserPhase(
        "navigation commit",
        remainingPhaseMs(deadline, "navigation commit"),
        signal,
        () => page.goto(target.href, {
          waitUntil: "commit",
          timeout: remainingPhaseMs(deadline, "navigation commit"),
        }),
      )
      committed = true
      this.#initialNavigationCompleted = true
      throwIfAborted(signal)
      this.#assertCurrentOrigin()

      // Commit establishes the new main document. DOMContentLoaded is only a
      // bounded stabilization hint because a committed page may never emit it.
      const stabilizationBudget = Math.min(
        MAX_DOM_CONTENT_LOADED_GRACE_MS,
        Math.max(100, Math.floor(this.#internalOperationTimeoutMs * 0.15)),
        remainingPhaseMs(deadline, "navigation stabilization"),
      )
      // Proceed after the grace period without forcibly stopping the document;
      // generic sites may still need pending scripts and resources to become usable.
      await waitForOptionalBrowserPhase(
        "DOMContentLoaded stabilization",
        stabilizationBudget,
        signal,
        page.waitForLoadState("domcontentloaded"),
      )

      const quietIntervalMs = Math.min(
        MAX_DOCUMENT_QUIET_INTERVAL_MS,
        Math.max(50, Math.floor(this.#internalOperationTimeoutMs * 0.02)),
        remainingPhaseMs(deadline, "document stabilization"),
      )
      const documentSequence = this.#documentSequence
      await runBrowserPhase(
        "document stabilization",
        remainingPhaseMs(deadline, "document stabilization"),
        signal,
        (phaseSignal) => raceWithAbort(page.waitForTimeout(quietIntervalMs), phaseSignal),
      )
      if (this.#documentSequence !== documentSequence) {
        throw staleElement("Document changed during navigation stabilization")
      }
      this.#assertCurrentOrigin()
      return await runBrowserPhase(
        "fresh navigation observation",
        remainingPhaseMs(deadline, "fresh navigation observation"),
        signal,
        (phaseSignal) => this.observe(phaseSignal),
      )
    } catch (error) {
      if (!committed || signal.aborted) {
        void page.close({ runBeforeUnload: false }).catch(() => {})
      } else {
        void page.evaluate(() => window.stop()).catch(() => {})
      }
      throw error
    }
  }

  async observe(signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    this.#throwIfFatalPolicyViolation()
    const page = this.#requirePage()
    this.#assertCurrentOrigin()
    const documentSequence = this.#documentSequence
    this.#revision += 1
    const revision = ObservationRevisionSchema.parse(this.#revision)
    this.#registry.clear()

    const url = page.url()
    const rawTitle = await page.title()
    const title = rawTitle.slice(0, 500)
    const elements: CompactElement[] = []
    let truncated = rawTitle.length > 500
    const envelope = (visibleText: string, candidateElements: readonly CompactElement[]) => ({
      schemaVersion: 2 as const,
      trust: "untrusted_page_content" as const,
      revision,
      url,
      title,
      visibleText,
      elements: candidateElements,
      discoverySummary: `${candidateElements.length} visible semantic elements`,
      truncated,
    })
    if (Buffer.byteLength(JSON.stringify(envelope("", [])), "utf8") > this.#maxObservationBytes) {
      throw new Error("Observation envelope exceeds the configured byte budget")
    }

    const controls = page.locator(SEMANTIC_SELECTOR)
    const totalCount = await controls.count()
    const count = Math.min(totalCount, 100)
    truncated = totalCount > count
    for (let index = 0; index < count; index += 1) {
      const locator = controls.nth(index)
      if (!(await locator.isVisible().catch(() => false))) continue
      const snapshot = await readElement(locator).catch(() => null)
      if (!snapshot) continue
      if (snapshot.truncated) truncated = true
      const ref = `e:${revision}:${elements.length}`
      const element: CompactElement = {
        ref,
        role: snapshot.role,
        name: snapshot.name,
        disabled: snapshot.disabled,
        checked: snapshot.checked,
        selected: snapshot.selected,
        expanded: snapshot.expanded,
        attributes: snapshot.attributes,
      }
      const next = [...elements, element]
      if (Buffer.byteLength(JSON.stringify(envelope("", next)), "utf8") > this.#maxObservationBytes) {
        truncated = true
        break
      }
      elements.push(element)
      this.#registry.set(ref, {
        ref,
        revision,
        locator,
        identity: { tag: snapshot.tag, role: snapshot.role, name: snapshot.name },
        snapshot,
      })
    }

    const boundedBodyText = await page.locator("body").evaluate(
      (node, maximumCharacters) =>
        ((node as HTMLElement).innerText ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, maximumCharacters),
      20_001,
    ).catch(() => "")
    const bodyText = boundedBodyText.slice(0, 20_000)
    if (bodyText !== boundedBodyText) truncated = true
    const bodyBytes = Buffer.byteLength(bodyText, "utf8")
    let low = 0
    let high = bodyBytes
    let visibleText = ""
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = truncateUtf8(bodyText, middle).value
      if (Buffer.byteLength(JSON.stringify(envelope(candidate, elements)), "utf8") <= this.#maxObservationBytes) {
        visibleText = candidate
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    if (visibleText !== bodyText) truncated = true

    const observation = UntrustedAgentObservationSchema.parse(envelope(visibleText, elements))
    if (Buffer.byteLength(JSON.stringify(observation), "utf8") > this.#maxObservationBytes) {
      throw new Error("Observation serialization exceeded the configured byte budget")
    }
    throwIfAborted(signal)
    if (this.#documentSequence !== documentSequence) throw staleElement("Document changed during observation")
    this.#throwIfFatalPolicyViolation()
    this.#observedDocumentSequence = documentSequence
    return observation
  }

  async click(input: ElementActionInput, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    const href = entry.snapshot.attributes.href
    if (href) assertAllowedNavigation(new URL(href, this.#requirePage().url()).href, this.#allowedOrigins)
    this.#hasDispatchedAgentAction = true
    await entry.locator.click({ timeout: this.#internalOperationTimeoutMs })
    return this.observe(signal)
  }

  async type(
    input: ElementActionInput & { readonly text: string; readonly clearFirst: boolean },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    if (Buffer.byteLength(input.text, "utf8") > 4_000) throw new Error("Text is too large")
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    this.#hasDispatchedAgentAction = true
    if (input.clearFirst) await entry.locator.fill(input.text)
    else await entry.locator.pressSequentially(input.text)
    return this.observe(signal)
  }

  async select(
    input: ElementActionInput & { readonly value: string },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    this.#hasDispatchedAgentAction = true
    await entry.locator.selectOption(input.value)
    return this.observe(signal)
  }

  async pressKey(
    input: ElementActionInput & { readonly key: string },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    if (!ALLOWED_KEYS.has(input.key)) {
      throw blockedByPolicy("press_key_forbidden", "Keyboard key is not allowed")
    }
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    this.#hasDispatchedAgentAction = true
    await entry.locator.press(input.key)
    return this.observe(signal)
  }

  async scroll(
    direction: "up" | "down",
    amount: number,
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    if (!Number.isInteger(amount) || amount < 1 || amount > 5_000) {
      throw new Error("Scroll amount is out of bounds")
    }
    this.#hasDispatchedAgentAction = true
    await this.#requirePage().mouse.wheel(0, direction === "down" ? amount : -amount)
    return this.observe(signal)
  }

  async wait(durationMs: number, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 15_000) {
      throw new Error("Wait duration is out of bounds")
    }
    this.#hasDispatchedAgentAction = true
    await this.#requirePage().waitForTimeout(durationMs)
    throwIfAborted(signal)
    return this.observe(signal)
  }

  async currentPageDiscoverySnapshot(
    signal: AbortSignal,
  ): Promise<CurrentPageDiscoverySnapshot> {
    throwIfAborted(signal)
    const page = this.#requirePage()
    this.#assertCurrentOrigin()
    this.#assertObservedDocument()
    const { jsonLdTexts, jsonLdTruncated } = await page.evaluate((maximumBytes) => {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const output: string[] = []
      let total = 0
      let truncated = false
      const scripts = document.querySelectorAll('script[type="application/ld+json"]')
      for (const script of scripts) {
        const bytes = encoder.encode(script.textContent ?? "")
        const remaining = maximumBytes - total
        if (bytes.byteLength > remaining) {
          if (remaining > 0) output.push(decoder.decode(bytes.subarray(0, remaining)))
          truncated = true
          break
        }
        output.push(decoder.decode(bytes))
        total += bytes.byteLength
      }
      return { jsonLdTexts: output, jsonLdTruncated: truncated }
    }, 65_536)
    const webMcpPresent = await page.evaluate(() => "modelContext" in document)
    this.#assertCurrentOrigin()
    this.#assertObservedDocument()
    return {
      observationRevision: ObservationRevisionSchema.parse(this.#revision),
      jsonLdTexts,
      jsonLdTruncated,
      webMcpPresent,
    }
  }

  async currentOriginWebMcpTools(
    signal: AbortSignal,
  ): Promise<readonly RawCurrentOriginWebMcpTool[]> {
    throwIfAborted(signal)
    this.#assertCurrentOrigin()
    this.#assertObservedDocument()
    const retrieval = this.#requirePage().evaluate(async () => {
      const modelContext = (
        document as Document & {
          modelContext?: {
            getTools?: (options?: { fromOrigins?: string[] }) => Promise<unknown[]>
          }
        }
      ).modelContext
      if (!modelContext?.getTools) return []
      const tools = await modelContext.getTools({ fromOrigins: [] })
      if (!Array.isArray(tools)) return []
      return tools.slice(0, 25).map((candidate) => {
        const tool = candidate as Record<string, unknown>
        let inputSchema: unknown = null
        try {
          const serialized = JSON.stringify(tool.inputSchema)
          if (typeof serialized === "string" && new TextEncoder().encode(serialized).byteLength <= 16_384) {
            inputSchema = JSON.parse(serialized)
          }
        } catch {
          inputSchema = null
        }
        const annotations = typeof tool.annotations === "object" && tool.annotations !== null
          ? { readOnlyHint: (tool.annotations as { readOnlyHint?: unknown }).readOnlyHint === true }
          : null
        return {
          name: typeof tool.name === "string" ? tool.name.slice(0, 200) : "",
          title: typeof tool.title === "string" ? tool.title.slice(0, 200) : null,
          description: typeof tool.description === "string" ? tool.description.slice(0, 2_000) : "",
          inputSchema,
          annotations,
        }
      })
    })
    let tools: readonly RawCurrentOriginWebMcpTool[]
    try {
      tools = await raceWithAbort(retrieval, signal)
    } catch (error) {
      if (signal.aborted) await this.close(AbortSignal.timeout(5_000)).catch(() => {})
      throw error
    }
    this.#assertCurrentOrigin()
    this.#assertObservedDocument()
    throwIfAborted(signal)
    return tools
  }

  currentBrowserOrigin(): string {
    this.#assertCurrentOrigin()
    this.#assertObservedDocument()
    return new URL(this.#requirePage().url()).origin
  }

  async invokeCurrentOriginWebMcpTool(
    expectedTool: ExpectedCurrentOriginWebMcpTool,
    input: Readonly<Record<string, string | number | boolean | null>>,
    signal: AbortSignal,
  ): Promise<CurrentOriginWebMcpInvocationResult> {
    throwIfAborted(signal)
    this.#assertCurrentOrigin()
    this.#assertObservedDocument()
    const page = this.#requirePage()
    this.#hasDispatchedAgentAction = true
    const execution = page.evaluate(
      async ({ expected, toolInput }) => {
        const modelContext = (
          document as Document & {
            modelContext?: {
              getTools?: (options?: { fromOrigins?: string[] }) => Promise<unknown[]>
              executeTool?: (tool: unknown, input: object) => Promise<unknown>
            }
          }
        ).modelContext
        if (!modelContext?.getTools || !modelContext.executeTool) {
          throw new Error("WebMCP is unavailable")
        }
        const tools = await modelContext.getTools({ fromOrigins: [] })
        if (!Array.isArray(tools)) throw new Error("WebMCP catalog changed before invocation")
        const matches = tools.filter(
          (candidate) =>
            typeof candidate === "object" &&
            candidate !== null &&
            (candidate as { name?: unknown }).name === expected.name,
        )
        if (matches.length !== 1) throw new Error("WebMCP tool changed before invocation")
        const tool = matches[0] as Record<string, unknown>
        const annotations = typeof tool.annotations === "object" && tool.annotations !== null
          ? tool.annotations as { readOnlyHint?: unknown }
          : null
        const description = typeof tool.description === "string" ? tool.description : ""
        if (
          description !== expected.description ||
          annotations?.readOnlyHint !== expected.declaredReadOnly ||
          JSON.stringify(tool.inputSchema) !== JSON.stringify(expected.rawInputSchema)
        ) {
          throw new Error("WebMCP tool changed before invocation")
        }
        const raw = await modelContext.executeTool(tool, toolInput)
        if (typeof raw === "string") {
          const encoded = new TextEncoder().encode(raw)
          if (encoded.byteLength <= 12_000) return { serialized: raw, truncated: false }
          return {
            serialized: new TextDecoder().decode(encoded.subarray(0, 12_000)),
            truncated: true,
          }
        }
        let visited = 0
        let truncated = false
        const seen = new WeakSet<object>()
        const normalize = (value: unknown, depth: number): unknown => {
          visited += 1
          if (visited > 500) {
            truncated = true
            return "[TRUNCATED]"
          }
          if (value === null || typeof value === "boolean") return value
          if (typeof value === "number") return Number.isFinite(value) ? value : "[NON_FINITE]"
          if (typeof value === "string") {
            if (value.length > 2_000) truncated = true
            return value.slice(0, 2_000)
          }
          if (typeof value !== "object" || depth >= 5) {
            truncated = true
            return "[TRUNCATED]"
          }
          if (seen.has(value)) return "[CIRCULAR]"
          seen.add(value)
          if (Array.isArray(value)) {
            if (value.length > 50) truncated = true
            return value.slice(0, 50).map((item) => normalize(item, depth + 1))
          }
          const output: Record<string, unknown> = {}
          const entries = Object.entries(value)
          if (entries.length > 50) truncated = true
          for (const [key, nested] of entries.slice(0, 50)) {
            output[key.slice(0, 200)] = normalize(nested, depth + 1)
          }
          return output
        }
        let serialized: string
        try {
          serialized = JSON.stringify(normalize(raw, 0))
        } catch {
          serialized = "[unserializable WebMCP result]"
        }
        const encoded = new TextEncoder().encode(serialized)
        if (encoded.byteLength <= 12_000) return { serialized, truncated }
        return {
          serialized: new TextDecoder().decode(encoded.subarray(0, 12_000)),
          truncated: true,
        }
      },
      { expected: expectedTool, toolInput: input },
    )
    try {
      const result = await raceWithAbort(execution, signal)
      this.#throwIfFatalPolicyViolation()
      this.#assertCurrentOrigin()
      this.#assertObservedDocument()
      throwIfAborted(signal)
      return result
    } catch (error) {
      if (signal.aborted) await this.close(AbortSignal.timeout(5_000)).catch(() => {})
      throw error
    }
  }

  async readCurrentOriginText(
    path: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<CurrentOriginTextResult> {
    throwIfAborted(signal)
    if (!path.startsWith("/") || path.startsWith("//") || maxBytes < 1 || maxBytes > 65_536) {
      throw new Error("Current-origin discovery request is invalid")
    }
    const page = this.#requirePage()
    this.#assertCurrentOrigin()
    this.#assertObservedDocument()
    const currentOrigin = new URL(page.url()).origin
    const requested = new URL(path, `${currentOrigin}/`)
    if (requested.origin !== currentOrigin || requested.username || requested.password) {
      throw new Error("Current-origin discovery path escaped the active origin")
    }
    const result = await page.evaluate(
      async ({ requestedUrl, maximumBytes }) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5_000)
        try {
          const requested = new URL(requestedUrl)
          const response = await fetch(requested, {
            method: "GET",
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            signal: controller.signal,
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
            if (total === maximumBytes) {
              const extra = await reader.read()
              truncated = !extra.done
              if (truncated) await reader.cancel()
              break
            }
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
          return { status: 0, finalUrl: requestedUrl, text: "", truncated: false }
        } finally {
          clearTimeout(timeout)
        }
      },
      { requestedUrl: requested.href, maximumBytes: maxBytes },
    )
    this.#assertCurrentOrigin()
    this.#assertObservedDocument()
    throwIfAborted(signal)
    return result
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
    if (
      input.observationRevision !== this.#revision ||
      this.#observedDocumentSequence === null ||
      this.#observedDocumentSequence !== this.#documentSequence
    ) throw staleElement()
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

  #assertObservedDocument(): void {
    if (
      this.#observedDocumentSequence === null ||
      this.#observedDocumentSequence !== this.#documentSequence
    ) {
      throw staleElement("Document changed since the current observation")
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
    page.on("dialog", (dialog) => {
      this.#recordPolicy("unknown_effect")
      void dialog.dismiss().catch(() => {})
    })
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
      let mainFrameNavigation = false
      if (request.isNavigationRequest()) {
        const requestFrame = request.frame()
        const requestPage = requestFrame.page()
        if (requestPage !== page) {
          this.#recordPolicy("popup_forbidden")
          await route.abort("blockedbyclient").catch(() => {})
          return
        }
        mainFrameNavigation = requestFrame === requestPage.mainFrame()
      }
      const denyCode = classifyObservableRequest(
        {
          url: request.url(),
          method: request.method(),
          hasBody: request.postData() !== null,
          mainFrameNavigation,
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

  async #installServiceWorkerInitScript(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      const serviceWorker = navigator.serviceWorker
      if (!serviceWorker) return
      Object.defineProperty(serviceWorker, "register", {
        configurable: false,
        value: () => Promise.reject(new DOMException("Blocked by TraceGate", "NotAllowedError")),
      })
    })
  }

  async #enableServiceWorkerBypass(context: BrowserContext, page: Page): Promise<void> {
    const cdp = await context.newCDPSession(page).catch(() => null)
    if (cdp) {
      await cdp.send("Network.enable").catch(() => {})
      await cdp.send("Network.setBypassServiceWorker", { bypass: true }).catch(() => {})
      await cdp.detach().catch(() => {})
    }
  }
}

export class SolariBrowserControllerFactory implements BrowserControllerFactory {
  constructor(
    private readonly options: SolariBrowserControllerFactoryOptions,
    private readonly dependencies: SolariBrowserControllerDependencies = {},
  ) {}

  async create(
    _lease: BrowserLease,
    signal: AbortSignal,
  ): Promise<BrowserController> {
    throwIfAborted(signal)
    return new SolariCdpBrowserController(this.options, this.dependencies)
  }
}
