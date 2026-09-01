import {
  ObservationRevisionSchema,
  RunWarningSchema,
  TraceGateError,
  TransientAssertionSnapshotV1Schema,
  UntrustedAgentObservationSchema,
  createControlError,
  type AssertionCaptureInput,
  type AssertionSnapshotBrowserController,
  type BrowserController,
  type BrowserControllerFactory,
  type BrowserLease,
  type CompactElement,
  type ElementActionInput,
  type ObservationRevision,
  type PolicyDenyCode,
  type TransientAssertionSnapshotV1,
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
  classifyBlockedRequest,
  classifyBlockedWebSocket,
  obviousUnsafeControl,
  type BlockedPolicyDisposition,
  type BrowserPolicyActionScope,
  type FirstFatalPolicyDiagnostic,
  type PolicyDiagnosticMethodClass,
  type PolicyDiagnosticResourceType,
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
const MAX_SEMANTIC_CANDIDATES = 100
const MAX_ELEMENT_ROLE_CHARACTERS = 100
const MAX_ELEMENT_FIELD_CHARACTERS = 500
const MAX_VISIBLE_TEXT_CHARACTERS = 20_000
const MAX_ASSERTION_TITLE_CHARACTERS = 16_384
const MAX_ASSERTION_DOCUMENT_TEXT_CHARACTERS = 262_144
const MAX_ASSERTION_SEMANTIC_MATCHES = 21
const MAX_ASSERTION_STATE_MATCHES = 2
const MAX_ASSERTION_STATE_VALUE_CHARACTERS = 500

const DIAGNOSTIC_REQUEST_RESOURCE_TYPES = new Set<PolicyDiagnosticResourceType>([
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "texttrack",
  "xhr",
  "fetch",
  "eventsource",
  "websocket",
  "manifest",
  "other",
  "ping",
  "beacon",
  "cspviolationreport",
  "prefetch",
])

function policyDiagnosticMethodClass(method: string): PolicyDiagnosticMethodClass {
  const normalized = method.toUpperCase()
  if (normalized === "GET") return "get"
  if (normalized === "HEAD") return "head"
  return "other"
}

function policyDiagnosticResourceType(resourceType: string): PolicyDiagnosticResourceType {
  const normalized = resourceType.toLowerCase() as PolicyDiagnosticResourceType
  return DIAGNOSTIC_REQUEST_RESOURCE_TYPES.has(normalized) ? normalized : "unknown"
}

function policyDiagnosticSameOrigin(rawUrl: string, activeOrigin: string | null): boolean | null {
  if (activeOrigin === null) return null
  try {
    const url = new URL(rawUrl)
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin === activeOrigin
    }
    if (url.protocol === "ws:" || url.protocol === "wss:") {
      const comparableProtocol = url.protocol === "wss:" ? "https:" : "http:"
      return new URL(`${comparableProtocol}//${url.host}`).origin === activeOrigin
    }
  } catch {
    // Only the bounded tri-state result is retained; raw destinations are discarded.
  }
  return null
}

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

interface ActivePolicyAction {
  readonly scope: BrowserPolicyActionScope
  readonly token: number
}

interface FirstFatalPolicyViolation {
  readonly code: PolicyDenyCode
  readonly diagnostic: FirstFatalPolicyDiagnostic
}

interface RegistryEntry {
  readonly ref: string
  readonly revision: ObservationRevision
  readonly locator: Locator
  readonly identity: Pick<ElementSnapshot, "tag" | "role" | "name">
  readonly snapshot: ElementSnapshot
}

interface InPageSemanticElement {
  readonly sourceIndex: number
  readonly snapshot: ElementSnapshot
}

interface InPageSemanticSnapshot {
  readonly url: string
  readonly title: string
  readonly titleTruncated: boolean
  readonly bodyText: string
  readonly bodyTextTruncated: boolean
  readonly bodyTextReadFailed: boolean
  readonly totalCount: number
  readonly elementReadFailed: boolean
  readonly elements: readonly InPageSemanticElement[]
}

interface InPageAssertionProjectionRequest {
  readonly assertionId: string
  readonly kind: "semantic" | "state"
  readonly role: string
  readonly nameOperator: "equals" | "contains"
  readonly nameValue: string
  readonly nameCaseSensitive: boolean
  readonly property: "checked" | "selected" | "expanded" | "disabled" | "value" | null
}

type InPageAssertionValue =
  | {
      readonly assertionId: string
      readonly kind: "semantic"
      readonly status: "captured"
      readonly matchedCount: number
      readonly truncated: boolean
    }
  | {
      readonly assertionId: string
      readonly kind: "state"
      readonly status: "captured"
      readonly property: "checked" | "selected" | "expanded" | "disabled" | "value"
      readonly matchedCount: number
      readonly matchesTruncated: boolean
      readonly actualValue: boolean | string | null
      readonly valueTruncated: boolean
    }
  | {
      readonly assertionId: string
      readonly kind: "semantic" | "state"
      readonly status: "unavailable"
      readonly reasonCode: "semantic_data_unavailable" | "sensitive_control"
    }

interface InPageAssertionCapture {
  readonly finalUrl:
    | { readonly status: "captured"; readonly value: string }
    | { readonly status: "unavailable"; readonly reasonCode: "evidence_invalid" }
  readonly title:
    | { readonly status: "captured"; readonly value: string; readonly truncated: boolean }
    | { readonly status: "unavailable"; readonly reasonCode: "text_data_unavailable" }
    | null
  readonly documentVisibleText:
    | { readonly status: "captured"; readonly value: string; readonly truncated: boolean }
    | { readonly status: "unavailable"; readonly reasonCode: "text_data_unavailable" }
    | null
  readonly semanticStateValues: readonly InPageAssertionValue[]
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
    const rawExplicitRole = element.getAttribute("role")?.trim()
    const explicitRole = rawExplicitRole?.slice(0, MAX_ELEMENT_ROLE_CHARACTERS)
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
    let truncated =
      normalizedName.length > MAX_ELEMENT_FIELD_CHARACTERS ||
      (rawExplicitRole?.length ?? 0) > MAX_ELEMENT_ROLE_CHARACTERS
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

export class SolariCdpBrowserController implements BrowserController, AssertionSnapshotBrowserController {
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
  #activePolicyAction: ActivePolicyAction | null = null
  #nextPolicyActionToken = 0
  #documentSequence = 0
  #observedDocumentSequence: number | null = null
  #passivePolicyCount = 0
  #fatalPolicyCount = 0
  #passivePolicyCodes: PolicyDenyCode[] = []
  #fatalPolicyCodes: PolicyDenyCode[] = []
  #firstFatalPolicyViolation: FirstFatalPolicyViolation | null = null
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
      this.#activePolicyAction = null
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
    const page = this.#requirePage()
    const performNavigation = async (): Promise<UntrustedAgentObservation> => {
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

    return this.#initialNavigationCompleted
      ? this.#runWithPolicyAction("navigation", performNavigation)
      : performNavigation()
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

    const controls = page.locator(SEMANTIC_SELECTOR)
    const collection = controls.evaluateAll(
      (nodes, limits): InPageSemanticSnapshot => {
        const isVisibleTextNode = (node: Text): boolean => {
          const range = document.createRange()
          range.selectNode(node)
          const rect = range.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }
        const isVisible = (element: Element): boolean => {
          const style = getComputedStyle(element)
          if (style.display === "contents") {
            for (const child of element.childNodes) {
              if (child.nodeType === Node.ELEMENT_NODE && isVisible(child as Element)) return true
              if (child.nodeType === Node.TEXT_NODE && isVisibleTextNode(child as Text)) return true
            }
            return false
          }
          if (typeof element.checkVisibility === "function" && !element.checkVisibility()) return false
          if (style.visibility !== "visible") return false
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }
        const readSnapshot = (node: Element): ElementSnapshot => {
          const element = node as HTMLElement
          const tag = element.tagName.toLowerCase()
          const input = element instanceof HTMLInputElement ? element : null
          const select = element instanceof HTMLSelectElement ? element : null
          const option = element instanceof HTMLOptionElement ? element : null
          const rawExplicitRole = element.getAttribute("role")?.trim()
          const explicitRole = rawExplicitRole?.slice(0, limits.maximumElementRoleCharacters)
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
          let truncated =
            normalizedName.length > limits.maximumElementFieldCharacters ||
            (rawExplicitRole?.length ?? 0) > limits.maximumElementRoleCharacters
          const attributes: Record<string, string> = {}
          for (const attribute of ["name", "placeholder", "autocomplete", "href", "target"] as const) {
            const value = element.getAttribute(attribute)
            if (value) {
              if (value.length > limits.maximumElementFieldCharacters) truncated = true
              attributes[attribute] = value.slice(0, limits.maximumElementFieldCharacters)
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
            if (input.value.length > limits.maximumElementFieldCharacters) truncated = true
            attributes.value = input.value.slice(0, limits.maximumElementFieldCharacters)
          } else if (select) {
            if (select.value.length > limits.maximumElementFieldCharacters) truncated = true
            attributes.value = select.value.slice(0, limits.maximumElementFieldCharacters)
          } else if (element instanceof HTMLTextAreaElement) {
            if (element.value.length > limits.maximumElementFieldCharacters) truncated = true
            attributes.value = element.value.slice(0, limits.maximumElementFieldCharacters)
          }
          return {
            tag,
            role: explicitRole || inferredRole,
            name: normalizedName.slice(0, limits.maximumElementFieldCharacters),
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
        }

        const semanticElements: InPageSemanticElement[] = []
        let elementReadFailed = false
        const candidateCount = Math.min(nodes.length, limits.maximumCandidates)
        for (let sourceIndex = 0; sourceIndex < candidateCount; sourceIndex += 1) {
          const node = nodes[sourceIndex]
          if (!node) continue
          try {
            if (!isVisible(node)) continue
            semanticElements.push({ sourceIndex, snapshot: readSnapshot(node) })
          } catch {
            elementReadFailed = true
          }
        }
        const title = document.title
        let bodyText = ""
        let bodyTextReadFailed = false
        try {
          bodyText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim()
        } catch {
          bodyTextReadFailed = true
        }
        return {
          url: location.href,
          title: title.slice(0, limits.maximumElementFieldCharacters),
          titleTruncated: title.length > limits.maximumElementFieldCharacters,
          bodyText: bodyText.slice(0, limits.maximumVisibleTextCharacters + 1),
          bodyTextTruncated: bodyText.length > limits.maximumVisibleTextCharacters,
          bodyTextReadFailed,
          totalCount: nodes.length,
          elementReadFailed,
          elements: semanticElements,
        }
      },
      {
        maximumCandidates: MAX_SEMANTIC_CANDIDATES,
        maximumElementRoleCharacters: MAX_ELEMENT_ROLE_CHARACTERS,
        maximumElementFieldCharacters: MAX_ELEMENT_FIELD_CHARACTERS,
        maximumVisibleTextCharacters: MAX_VISIBLE_TEXT_CHARACTERS,
      },
    )
    const collected = await raceWithAbort(collection, signal)
    const url = collected.url
    const snapshotUrl = new URL(url)
    if (snapshotUrl.protocol !== "https:" || !this.#allowedOrigins.has(snapshotUrl.origin)) {
      throw blockedByPolicy("origin_not_admitted", "Page left the declared navigation origins")
    }
    const title = collected.title
    const elements: CompactElement[] = []
    let truncated =
      collected.titleTruncated ||
      collected.bodyTextTruncated ||
      collected.bodyTextReadFailed ||
      collected.totalCount > MAX_SEMANTIC_CANDIDATES ||
      collected.elementReadFailed
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

    for (const { sourceIndex, snapshot } of collected.elements) {
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
        locator: controls.nth(sourceIndex),
        identity: { tag: snapshot.tag, role: snapshot.role, name: snapshot.name },
        snapshot,
      })
    }

    const boundedBodyText = collected.bodyText
    const bodyText = boundedBodyText.slice(0, MAX_VISIBLE_TEXT_CHARACTERS)
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
    this.#assertCurrentOrigin()
    this.#throwIfFatalPolicyViolation()
    this.#observedDocumentSequence = documentSequence
    return observation
  }

  async click(input: ElementActionInput, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    const href = entry.snapshot.attributes.href
    if (href) assertAllowedNavigation(new URL(href, this.#requirePage().url()).href, this.#allowedOrigins)
    return this.#runWithPolicyAction(href ? "navigation" : "direct_interaction", async () => {
      await entry.locator.click({ timeout: this.#internalOperationTimeoutMs })
      return this.observe(signal)
    })
  }

  async type(
    input: ElementActionInput & { readonly text: string; readonly clearFirst: boolean },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    if (Buffer.byteLength(input.text, "utf8") > 4_000) throw new Error("Text is too large")
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    return this.#runWithPolicyAction("direct_interaction", async () => {
      if (input.clearFirst) await entry.locator.fill(input.text)
      else await entry.locator.pressSequentially(input.text)
      return this.observe(signal)
    })
  }

  async select(
    input: ElementActionInput & { readonly value: string },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    const entry = await this.#resolve(input, signal)
    this.#assertElementSafe(entry.snapshot)
    return this.#runWithPolicyAction("direct_interaction", async () => {
      await entry.locator.selectOption(input.value)
      return this.observe(signal)
    })
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
    return this.#runWithPolicyAction("direct_interaction", async () => {
      await entry.locator.press(input.key)
      return this.observe(signal)
    })
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
    await this.#requirePage().mouse.wheel(0, direction === "down" ? amount : -amount)
    return this.observe(signal)
  }

  async wait(durationMs: number, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
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
    return this.#runWithPolicyAction("webmcp", async () => {
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
    })
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

  async captureAssertionSnapshot(
    input: AssertionCaptureInput,
    signal: AbortSignal,
  ): Promise<TransientAssertionSnapshotV1> {
    throwIfAborted(signal)
    this.#throwIfFatalPolicyViolation()
    const page = this.#requirePage()
    this.#assertCurrentOrigin()
    const documentSequence = this.#documentSequence
    const captureTitle = input.assertions.some(
      (assertion) => assertion.kind === "text" && assertion.scope === "title",
    )
    const captureDocumentVisibleText = input.assertions.some(
      (assertion) => assertion.kind === "text" && assertion.scope === "document_visible_text",
    )
    const projections: InPageAssertionProjectionRequest[] = input.assertions.flatMap(
      (assertion): InPageAssertionProjectionRequest[] => {
        if (assertion.kind !== "semantic" && assertion.kind !== "state") return []
        return [{
          assertionId: assertion.id,
          kind: assertion.kind,
          role: assertion.locator.role,
          nameOperator: assertion.locator.accessibleName.operator,
          nameValue: assertion.locator.accessibleName.value,
          nameCaseSensitive: assertion.locator.accessibleName.caseSensitive,
          property: assertion.kind === "state" ? assertion.property : null,
        }]
      },
    )

    const collected = await runBrowserPhase(
      "assertion snapshot capture",
      this.#internalOperationTimeoutMs,
      signal,
      (phaseSignal) => raceWithAbort(
        page.evaluate(
          (request): InPageAssertionCapture => {
            type StateProperty = "checked" | "selected" | "expanded" | "disabled" | "value"
            interface SemanticAccumulator {
              readonly projection: InPageAssertionProjectionRequest
              matchedCount: number
              truncated: boolean
            }
            interface StateAccumulator {
              readonly projection: InPageAssertionProjectionRequest & { readonly property: StateProperty }
              matchedCount: number
              matchesTruncated: boolean
              actualValue: boolean | string | null
              valueTruncated: boolean
              sensitive: boolean
            }

            const finalUrl: InPageAssertionCapture["finalUrl"] = (() => {
              try {
                return { status: "captured", value: window.location.href }
              } catch {
                return { status: "unavailable", reasonCode: "evidence_invalid" }
              }
            })()
            const title: InPageAssertionCapture["title"] = request.captureTitle
              ? (() => {
                  try {
                    const value = document.title
                    return {
                      status: "captured",
                      value: value.slice(0, request.maximumTitleCharacters),
                      truncated: value.length > request.maximumTitleCharacters,
                    }
                  } catch {
                    return { status: "unavailable", reasonCode: "text_data_unavailable" }
                  }
                })()
              : null
            const documentVisibleText: InPageAssertionCapture["documentVisibleText"] =
              request.captureDocumentVisibleText
                ? (() => {
                    try {
                      const value = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim()
                      return {
                        status: "captured",
                        value: value.slice(0, request.maximumDocumentTextCharacters),
                        truncated: value.length > request.maximumDocumentTextCharacters,
                      }
                    } catch {
                      return { status: "unavailable", reasonCode: "text_data_unavailable" }
                    }
                  })()
                : null

            if (request.projections.length === 0) {
              return { finalUrl, title, documentVisibleText, semanticStateValues: [] }
            }

            const semanticAccumulators = new Map<string, SemanticAccumulator>()
            const stateAccumulators = new Map<string, StateAccumulator>()
            for (const projection of request.projections) {
              if (projection.kind === "semantic") {
                semanticAccumulators.set(projection.assertionId, {
                  projection,
                  matchedCount: 0,
                  truncated: false,
                })
              } else if (projection.property !== null) {
                stateAccumulators.set(projection.assertionId, {
                  projection: projection as InPageAssertionProjectionRequest & { readonly property: StateProperty },
                  matchedCount: 0,
                  matchesTruncated: false,
                  actualValue: null,
                  valueTruncated: false,
                  sensitive: false,
                })
              }
            }

            const isVisibleTextNode = (node: Text): boolean => {
              const range = document.createRange()
              range.selectNode(node)
              const rect = range.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0
            }
            const isVisible = (element: Element): boolean => {
              const style = getComputedStyle(element)
              if (style.display === "contents") {
                for (const child of element.childNodes) {
                  if (child.nodeType === Node.ELEMENT_NODE && isVisible(child as Element)) return true
                  if (child.nodeType === Node.TEXT_NODE && isVisibleTextNode(child as Text)) return true
                }
                return false
              }
              if (typeof element.checkVisibility === "function" && !element.checkVisibility()) return false
              if (style.visibility !== "visible") return false
              const rect = element.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0
            }
            const accessibleName = (element: HTMLElement): string => {
              const input = element instanceof HTMLInputElement ? element : null
              const select = element instanceof HTMLSelectElement ? element : null
              const textarea = element instanceof HTMLTextAreaElement ? element : null
              const labelledBy = element.getAttribute("aria-labelledby")
                ?.split(/\s+/)
                .filter(Boolean)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" ")
              const labelText = input?.labels
                ? [...input.labels].map((label) => label.textContent ?? "").join(" ")
                : select?.labels
                  ? [...select.labels].map((label) => label.textContent ?? "").join(" ")
                  : textarea?.labels
                    ? [...textarea.labels].map((label) => label.textContent ?? "").join(" ")
                    : null
              const name =
                element.getAttribute("aria-label") ??
                labelledBy ??
                labelText ??
                element.getAttribute("alt") ??
                element.getAttribute("title") ??
                (input?.type === "submit" ? input.value : null) ??
                element.innerText ??
                element.textContent ??
                ""
              return name.replace(/\s+/g, " ").trim()
            }
            const semanticRole = (element: HTMLElement): string => {
              const tag = element.tagName.toLowerCase()
              const input = element instanceof HTMLInputElement ? element : null
              const explicitRole = element.getAttribute("role")?.trim().split(/\s+/)[0]
              if (explicitRole) return explicitRole
              if (tag === "a" && element.hasAttribute("href")) return "link"
              if (tag === "button") return "button"
              if (tag === "select") return "combobox"
              if (tag === "textarea") return "textbox"
              if (tag === "option") return "option"
              if (/^h[1-6]$/.test(tag)) return "heading"
              if (tag === "main") return "main"
              if (tag === "nav") return "navigation"
              if (tag === "article") return "article"
              if (tag === "li") return "listitem"
              if (tag === "img") return "img"
              if (input?.type === "checkbox") return "checkbox"
              if (input?.type === "radio") return "radio"
              if (input?.type === "submit") return "button"
              if (tag === "input" || element.isContentEditable) return "textbox"
              return "control"
            }
            const matchesProjection = (
              role: string,
              name: string,
              projection: InPageAssertionProjectionRequest,
            ): boolean => {
              const actualRole = role.toLocaleLowerCase("en-US")
              const expectedRole = projection.role.toLocaleLowerCase("en-US")
              if (actualRole !== expectedRole) return false
              const actualName = projection.nameCaseSensitive
                ? name
                : name.toLocaleLowerCase("en-US")
              const expectedName = projection.nameCaseSensitive
                ? projection.nameValue
                : projection.nameValue.toLocaleLowerCase("en-US")
              return projection.nameOperator === "equals"
                ? actualName === expectedName
                : actualName.includes(expectedName)
            }
            const isSensitiveValueControl = (element: HTMLElement, role: string, name: string): boolean => {
              const input = element instanceof HTMLInputElement ? element : null
              const type = input?.type.toLowerCase() ?? ""
              const autocomplete = element.getAttribute("autocomplete")?.toLowerCase() ?? ""
              if (["password", "file", "email", "tel"].includes(type)) return true
              if (/password|passcode|otp|one[- ]?time|email|tel|phone|address|cc-|card|cvv|iban|account|ssn|health|medical/i.test(autocomplete)) return true
              const identity = [role, name, element.getAttribute("name") ?? "", type, autocomplete].join(" ")
              return /\b(?:password|passcode|otp|one[- ]?time|email|phone|address|card|cvv|iban|account|social security|ssn|health|medical|resume|cv)\b/i.test(identity)
            }
            const readState = (
              element: HTMLElement,
              property: StateProperty,
            ): { readonly value: boolean | string | null; readonly truncated: boolean; readonly sensitive: boolean } => {
              const input = element instanceof HTMLInputElement ? element : null
              if (property === "checked") {
                const value = input && ["checkbox", "radio"].includes(input.type)
                  ? input.checked
                  : element.getAttribute("aria-checked")
                return {
                  value: typeof value === "boolean" ? value : value === null ? null : value === "true",
                  truncated: false,
                  sensitive: false,
                }
              }
              if (property === "selected") {
                const value = element instanceof HTMLOptionElement
                  ? element.selected
                  : element.getAttribute("aria-selected")
                return {
                  value: typeof value === "boolean" ? value : value === null ? null : value === "true",
                  truncated: false,
                  sensitive: false,
                }
              }
              if (property === "expanded") {
                const value = element.getAttribute("aria-expanded")
                return { value: value === null ? null : value === "true", truncated: false, sensitive: false }
              }
              if (property === "disabled") {
                const nativeValue = "disabled" in element
                  ? Boolean((element as HTMLButtonElement).disabled)
                  : null
                const ariaValue = element.getAttribute("aria-disabled")
                return {
                  value: nativeValue ?? (ariaValue === null ? null : ariaValue === "true"),
                  truncated: false,
                  sensitive: false,
                }
              }

              const role = semanticRole(element)
              const name = accessibleName(element)
              if (isSensitiveValueControl(element, role, name)) {
                return { value: null, truncated: false, sensitive: true }
              }
              const value = input
                ? input.value
                : element instanceof HTMLSelectElement
                  ? element.value
                  : element instanceof HTMLTextAreaElement
                    ? element.value
                    : null
              return {
                value: value?.slice(0, request.maximumStateValueCharacters) ?? null,
                truncated: value !== null && value.length > request.maximumStateValueCharacters,
                sensitive: false,
              }
            }

            let semanticReadFailed = false
            try {
              const nodes = document.querySelectorAll(request.semanticSelector)
              for (const node of nodes) {
                try {
                  const element = node as HTMLElement
                  if (!isVisible(element)) continue
                  const role = semanticRole(element)
                  const name = accessibleName(element)
                  for (const accumulator of semanticAccumulators.values()) {
                    if (!matchesProjection(role, name, accumulator.projection)) continue
                    if (accumulator.matchedCount < request.maximumSemanticMatches) {
                      accumulator.matchedCount += 1
                    } else {
                      accumulator.truncated = true
                    }
                  }
                  for (const accumulator of stateAccumulators.values()) {
                    if (!matchesProjection(role, name, accumulator.projection)) continue
                    if (accumulator.matchedCount < request.maximumStateMatches) {
                      accumulator.matchedCount += 1
                      if (accumulator.matchedCount === 1) {
                        const state = readState(element, accumulator.projection.property)
                        accumulator.actualValue = state.value
                        accumulator.valueTruncated = state.truncated
                        accumulator.sensitive = state.sensitive
                      } else {
                        accumulator.actualValue = null
                        accumulator.valueTruncated = false
                        accumulator.sensitive = false
                      }
                    } else {
                      accumulator.matchesTruncated = true
                    }
                  }
                } catch {
                  semanticReadFailed = true
                }
              }
            } catch {
              semanticReadFailed = true
            }

            const semanticStateValues: InPageAssertionValue[] = []
            for (const projection of request.projections) {
              if (semanticReadFailed) {
                semanticStateValues.push({
                  assertionId: projection.assertionId,
                  kind: projection.kind,
                  status: "unavailable",
                  reasonCode: "semantic_data_unavailable",
                })
                continue
              }
              if (projection.kind === "semantic") {
                const accumulator = semanticAccumulators.get(projection.assertionId)
                if (!accumulator) {
                  semanticStateValues.push({
                    assertionId: projection.assertionId,
                    kind: "semantic",
                    status: "unavailable",
                    reasonCode: "semantic_data_unavailable",
                  })
                  continue
                }
                semanticStateValues.push({
                  assertionId: projection.assertionId,
                  kind: "semantic",
                  status: "captured",
                  matchedCount: accumulator.matchedCount,
                  truncated: accumulator.truncated,
                })
                continue
              }
              const accumulator = stateAccumulators.get(projection.assertionId)
              if (!accumulator) {
                semanticStateValues.push({
                  assertionId: projection.assertionId,
                  kind: "state",
                  status: "unavailable",
                  reasonCode: "semantic_data_unavailable",
                })
              } else if (accumulator.matchedCount === 1 && accumulator.sensitive) {
                semanticStateValues.push({
                  assertionId: projection.assertionId,
                  kind: "state",
                  status: "unavailable",
                  reasonCode: "sensitive_control",
                })
              } else {
                semanticStateValues.push({
                  assertionId: projection.assertionId,
                  kind: "state",
                  status: "captured",
                  property: accumulator.projection.property,
                  matchedCount: accumulator.matchedCount,
                  matchesTruncated: accumulator.matchesTruncated,
                  actualValue: accumulator.matchedCount === 1 ? accumulator.actualValue : null,
                  valueTruncated: accumulator.matchedCount === 1 && accumulator.valueTruncated,
                })
              }
            }
            return { finalUrl, title, documentVisibleText, semanticStateValues }
          },
          {
            captureTitle,
            captureDocumentVisibleText,
            projections,
            semanticSelector: SEMANTIC_SELECTOR,
            maximumTitleCharacters: MAX_ASSERTION_TITLE_CHARACTERS,
            maximumDocumentTextCharacters: MAX_ASSERTION_DOCUMENT_TEXT_CHARACTERS,
            maximumSemanticMatches: MAX_ASSERTION_SEMANTIC_MATCHES,
            maximumStateMatches: MAX_ASSERTION_STATE_MATCHES,
            maximumStateValueCharacters: MAX_ASSERTION_STATE_VALUE_CHARACTERS,
          },
        ),
        phaseSignal,
      ),
    )

    throwIfAborted(signal)
    if (this.#documentSequence !== documentSequence) {
      throw staleElement("Document changed during assertion capture")
    }
    this.#assertCurrentOrigin()
    this.#throwIfFatalPolicyViolation()
    if (collected.finalUrl.status === "captured" && collected.finalUrl.value !== page.url()) {
      throw staleElement("URL changed during assertion capture")
    }
    const identity = Math.max(1, documentSequence)
    return TransientAssertionSnapshotV1Schema.parse({
      schemaVersion: 1,
      ...collected,
      documentId: `document-${identity}`,
      loaderId: `loader-${identity}`,
      policyActivity: {
        passiveWarningCount: this.#passivePolicyCount,
        agentBlockedCount: this.#fatalPolicyCount,
        codes: [...new Set([...this.#passivePolicyCodes, ...this.#fatalPolicyCodes])],
      },
    })
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

  async #runWithPolicyAction<T>(
    scope: BrowserPolicyActionScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.#activePolicyAction) throw new Error("Browser policy action scopes must not overlap")
    const activeAction: ActivePolicyAction = {
      scope,
      token: this.#nextPolicyActionToken + 1,
    }
    this.#nextPolicyActionToken = activeAction.token
    this.#activePolicyAction = activeAction
    try {
      return await operation()
    } finally {
      if (this.#activePolicyAction === activeAction) this.#activePolicyAction = null
    }
  }

  #activePageOrigin(): string | null {
    const rawUrl = this.#page?.url()
    if (!rawUrl) return null
    try {
      const url = new URL(rawUrl)
      return url.protocol === "https:" && this.#allowedOrigins.has(url.origin)
        ? url.origin
        : null
    } catch {
      return null
    }
  }

  #eventPolicyDiagnostic(resourceType: PolicyDiagnosticResourceType): FirstFatalPolicyDiagnostic {
    return {
      actionScope: this.#activePolicyAction?.scope ?? null,
      methodClass: "not_applicable",
      resourceType,
      mainFrame: null,
      sameOrigin: null,
    }
  }

  #requestPolicyDiagnostic(
    rawUrl: string,
    method: string,
    resourceType: string,
    mainFrame: boolean,
    activePageOrigin = this.#activePageOrigin(),
  ): FirstFatalPolicyDiagnostic {
    return {
      actionScope: this.#activePolicyAction?.scope ?? null,
      methodClass: policyDiagnosticMethodClass(method),
      resourceType: policyDiagnosticResourceType(resourceType),
      mainFrame,
      sameOrigin: policyDiagnosticSameOrigin(rawUrl, activePageOrigin),
    }
  }

  #recordPolicy(
    code: PolicyDenyCode,
    disposition: BlockedPolicyDisposition,
    diagnostic?: FirstFatalPolicyDiagnostic,
  ): void {
    const fatal = disposition === "fatal"
    if (fatal) {
      this.#fatalPolicyCount = Math.min(1_000, this.#fatalPolicyCount + 1)
      this.#firstFatalPolicyViolation ??= {
        code,
        diagnostic: diagnostic ?? this.#eventPolicyDiagnostic("unknown"),
      }
    } else {
      this.#passivePolicyCount = Math.min(1_000, this.#passivePolicyCount + 1)
    }
    const destination = fatal ? this.#fatalPolicyCodes : this.#passivePolicyCodes
    if (!destination.includes(code)) destination.push(code)
  }

  #throwIfFatalPolicyViolation(): void {
    const firstFatal = this.#firstFatalPolicyViolation
    if (firstFatal) {
      throw blockedByPolicy(
        firstFatal.code,
        "An observable prohibited browser action or request was blocked",
        firstFatal.diagnostic,
      )
    }
  }

  async #installPolicyHandlers(context: BrowserContext, page: Page): Promise<void> {
    page.on("dialog", (dialog) => {
      this.#recordPolicy("unknown_effect", "fatal", this.#eventPolicyDiagnostic("dialog"))
      void dialog.dismiss().catch(() => {})
    })
    page.on("download", (download) => {
      this.#recordPolicy(
        "upload_or_download_forbidden",
        "fatal",
        this.#eventPolicyDiagnostic("download"),
      )
      void download.cancel().catch(() => {})
    })
    page.on("filechooser", (chooser) => {
      this.#recordPolicy(
        "upload_or_download_forbidden",
        "fatal",
        this.#eventPolicyDiagnostic("filechooser"),
      )
      void chooser.setFiles([]).catch(() => {})
    })
    context.on("page", (candidate) => {
      if (candidate !== page) {
        this.#recordPolicy("popup_forbidden", "fatal", this.#eventPolicyDiagnostic("popup"))
        void candidate.close().catch(() => {})
      }
    })
    await context.routeWebSocket("**/*", async (route) => {
      const activePageOrigin = this.#activePageOrigin()
      const actionScope = this.#activePolicyAction?.scope ?? null
      const disposition = classifyBlockedWebSocket(route.url(), activePageOrigin, actionScope)
      this.#recordPolicy("alternate_protocol_forbidden", disposition, {
        actionScope,
        methodClass: "not_applicable",
        resourceType: "websocket",
        mainFrame: false,
        sameOrigin: policyDiagnosticSameOrigin(route.url(), activePageOrigin),
      })
      await route.close({ code: 1008, reason: "TraceGate blocks WebSocket" }).catch(() => {})
    })
    await context.route("**/*", async (route) => {
      const request = route.request()
      let mainFrameNavigation = false
      try {
        const requestFrame = request.frame()
        const requestPage = requestFrame.page()
        if (requestPage !== page) {
          this.#recordPolicy(
            "popup_forbidden",
            "fatal",
            this.#requestPolicyDiagnostic(
              request.url(),
              request.method(),
              request.resourceType(),
              false,
            ),
          )
          await route.abort("blockedbyclient").catch(() => {})
          return
        }
        mainFrameNavigation =
          request.isNavigationRequest() && requestFrame === requestPage.mainFrame()
      } catch {
        // Worker-owned requests have no frame. They can still be denied below,
        // but frame absence must not fabricate main-document causality.
      }
      const activePageOrigin = this.#activePageOrigin()
      const decision = classifyBlockedRequest(
        {
          url: request.url(),
          method: request.method(),
          hasBody: request.postData() !== null,
          mainFrameNavigation,
        },
        this.#allowedOrigins,
        {
          resourceType: request.resourceType(),
          activePageOrigin,
          actionScope: this.#activePolicyAction?.scope ?? null,
        },
      )
      if (decision) {
        this.#recordPolicy(
          decision.code,
          decision.disposition,
          this.#requestPolicyDiagnostic(
            request.url(),
            request.method(),
            request.resourceType(),
            mainFrameNavigation,
            activePageOrigin,
          ),
        )
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
