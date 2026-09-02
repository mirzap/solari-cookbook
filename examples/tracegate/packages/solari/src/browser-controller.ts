import {
  FailureRecordSchema,
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
  type ElementHandle,
  type JSHandle,
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
const MAX_OBSERVATION_CAPTURE_ATTEMPTS = 2
const MAX_SEMANTIC_CANDIDATES = 48
const PROGRESSIVE_SEMANTIC_ANCHOR_COUNT = 12
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
  readonly normalizedHref: string | null
  readonly hrefPresent: boolean
  readonly identityTruncated: boolean
  readonly truncated: boolean
}

type ElementActionKind = "click" | "type" | "select" | "press_key"
type BrowserTerminalPhase =
  | "browser_connect"
  | "navigation"
  | "observation"
  | "discovery"
  | "assertion_capture"

type BrowserFailureOperation = "connect" | "guard" | "navigation" | "semantic_capture" | "document_change"
type BrowserFailureSubphase = BrowserFailureOperation | "timeout"
type BrowserEffectDisposition = "navigation_committed" | "interaction_dispatched_effect_uncertain"

interface BrowserFailureDiagnostic {
  readonly subphase: BrowserFailureSubphase
  readonly operation: BrowserFailureOperation
}

export interface BrowserRecoveryCounters {
  readonly directHandle: number
  readonly rebind: number
  readonly ambiguous: number
  readonly exhausted: number
  readonly observationRecoveryAttempted: number
  readonly observationRecoverySucceeded: number
  readonly observationRecoveryExhausted: number
}

interface SafeSemanticIdentity {
  readonly tag: string
  readonly role: string
  readonly name: string
  readonly type: string
  readonly controlName: string
  readonly autocomplete: string
  readonly hrefPresent: boolean
  readonly normalizedHref: string | null
  readonly target: string
  readonly download: boolean
  readonly formmethod: string
  readonly disabled: boolean | null
  readonly recoverable: boolean
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
  readonly handle: ElementHandle<Node>
  readonly identity: SafeSemanticIdentity
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

interface InPageSemanticCapture extends InPageSemanticSnapshot {
  readonly nodes: readonly Element[]
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
  readonly policyActivity: {
    readonly passiveWarningCount: number
    readonly codes: readonly PolicyDenyCode[]
  }
  readonly recoveryCounters: BrowserRecoveryCounters
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

function ambiguousElement(message = "Element semantic identity changed"): TraceGateError {
  return new TraceGateError(
    RunWarningSchema.parse({
      schemaVersion: 1,
      category: "ambiguity",
      code: "ambiguous_element",
      phase: "browser_action",
      retryable: true,
      message,
      fieldIssues: [],
      causeChain: [],
    }),
  )
}

function abortedBrowserOperation(phase = "browser_action"): TraceGateError {
  return new TraceGateError(
    createControlError("operation_aborted", "Browser operation aborted", {
      category: "cancellation",
      phase,
    }),
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortedBrowserOperation()
}

const BROWSER_TERMINAL_FAILURE = {
  browser_connect: {
    code: "solari_unavailable",
    message: "The browser controller could not establish a usable session.",
  },
  navigation: {
    code: "target_unavailable",
    message: "The admitted target could not be navigated to safely.",
  },
  observation: {
    code: "target_evidence_lost",
    message: "A trustworthy browser observation could not be captured.",
  },
  discovery: {
    code: "target_evidence_lost",
    message: "Browser discovery evidence could not be captured.",
  },
  assertion_capture: {
    code: "target_evidence_lost",
    message: "Fresh browser assertion evidence could not be captured.",
  },
} as const satisfies Record<
  BrowserTerminalPhase,
  { readonly code: "solari_unavailable" | "target_unavailable" | "target_evidence_lost"; readonly message: string }
>

function browserOperationForPhase(phase: string): BrowserFailureOperation {
  if (phase === "browser_connect" || phase === "CDP connection" || phase === "context creation" || phase === "page creation") {
    return "connect"
  }
  if (phase.includes("guard") || phase.includes("policy") || phase.includes("service-worker")) {
    return "guard"
  }
  if (phase.includes("document change")) return "document_change"
  if (phase.includes("navigation") || phase.includes("DOMContentLoaded") || phase.includes("document stabilization")) {
    return "navigation"
  }
  return "semantic_capture"
}

class BrowserPhaseError extends Error {
  constructor(
    readonly diagnostic: BrowserFailureDiagnostic,
    cause?: unknown,
  ) {
    super("Browser phase failed", { cause })
    this.name = "BrowserPhaseError"
  }
}

function browserDiagnosticFieldIssues(diagnostic: BrowserFailureDiagnostic) {
  return [
    {
      path: "browser.subphase",
      code: "closed_browser_diagnostic",
      message: diagnostic.subphase,
    },
    {
      path: "browser.operation",
      code: "closed_browser_diagnostic",
      message: diagnostic.operation,
    },
  ]
}

function normalizeBrowserTerminalFailure(
  phase: BrowserTerminalPhase,
  error: unknown,
  signal?: AbortSignal,
): TraceGateError {
  if (error instanceof TraceGateError && FailureRecordSchema.safeParse(error.safe).success) return error
  if (signal?.aborted) return abortedBrowserOperation(phase)
  const failure = BROWSER_TERMINAL_FAILURE[phase]
  const diagnostic = error instanceof BrowserPhaseError
    ? error.diagnostic
    : { subphase: browserOperationForPhase(phase), operation: browserOperationForPhase(phase) }
  return new TraceGateError(
    FailureRecordSchema.parse({
      schemaVersion: 1,
      category: "infrastructure",
      code: failure.code,
      outcome: "inconclusive",
      policyCode: null,
      phase,
      retryable: false,
      message: failure.message,
      fieldIssues: browserDiagnosticFieldIssues(diagnostic),
      causeChain: [],
    }),
    error,
  )
}

function browserPhaseFailure(
  phase: string,
  cause?: unknown,
  timedOut = false,
): BrowserPhaseError {
  const operation = browserOperationForPhase(phase)
  return new BrowserPhaseError({
    subphase: timedOut ? "timeout" : operation,
    operation,
  }, cause)
}

function documentChangeFailure(operation: BrowserFailureOperation): BrowserPhaseError {
  return new BrowserPhaseError({ subphase: "document_change", operation })
}

function observationFailureAfterEffect(
  disposition: BrowserEffectDisposition,
  error: unknown,
): TraceGateError {
  if (error instanceof TraceGateError) {
    const parsed = FailureRecordSchema.safeParse(error.safe)
    if (parsed.success && (parsed.data.category === "policy" || parsed.data.category === "cancellation")) {
      return error
    }
  }
  const parsed = error instanceof TraceGateError ? FailureRecordSchema.safeParse(error.safe) : null
  const inheritedIssues = parsed?.success ? parsed.data.fieldIssues.slice(0, 8) : []
  return new TraceGateError(
    FailureRecordSchema.parse({
      schemaVersion: 1,
      category: "infrastructure",
      code: "target_evidence_lost",
      outcome: "inconclusive",
      policyCode: null,
      phase: "observation",
      retryable: false,
      message: disposition === "navigation_committed"
        ? "Navigation committed, but a trustworthy post-navigation observation could not be recovered."
        : "Browser interaction dispatch completed, but its effect remains uncertain because post-action observation could not be recovered.",
      fieldIssues: [
        ...inheritedIssues,
        {
          path: "browser.effectDisposition",
          code: "closed_browser_diagnostic",
          message: disposition,
        },
      ],
      causeChain: [],
    }),
    error,
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
  if (remaining <= 0) throw browserPhaseFailure(phase, undefined, true)
  return remaining
}

async function runBrowserPhase<T>(
  phase: string,
  timeoutMs: number,
  signal: AbortSignal,
  operation: (phaseSignal: AbortSignal) => Promise<T>,
  cleanupAbandonedResult?: (value: T) => void,
): Promise<T> {
  throwIfAborted(signal)
  const deadlineController = new AbortController()
  const phaseSignal = AbortSignal.any([signal, deadlineController.signal])
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    deadlineController.abort()
  }, timeoutMs)
  try {
    const pending = operation(phaseSignal)
    return await (cleanupAbandonedResult
      ? raceWithAbortAndCleanup(pending, phaseSignal, cleanupAbandonedResult)
      : raceWithAbort(pending, phaseSignal))
  } catch (error) {
    if (signal.aborted) throw abortedBrowserOperation()
    if (timedOut) throw browserPhaseFailure(phase, error, true)
    if (error instanceof TraceGateError || error instanceof BrowserPhaseError) throw error
    throw browserPhaseFailure(phase, error)
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
      throw browserPhaseFailure(phase, error)
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

async function raceWithAbortAndCleanup<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  cleanup: (value: T) => void,
): Promise<T> {
  let abandoned = false
  let resolvedValue: T | undefined
  let hasResolvedValue = false
  const tracked = operation.then((value) => {
    if (abandoned || signal.aborted) {
      cleanup(value)
      throw abortedBrowserOperation()
    }
    resolvedValue = value
    hasResolvedValue = true
    return value
  })
  try {
    return await raceWithAbort(tracked, signal)
  } catch (error) {
    abandoned = true
    if (hasResolvedValue) {
      cleanup(resolvedValue as T)
      hasResolvedValue = false
    }
    throw error
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

function normalizeIdentityWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

function safeSemanticIdentity(snapshot: ElementSnapshot): SafeSemanticIdentity {
  // Value/selection/expansion/placeholder state is intentionally omitted: it is volatile and
  // is not an input to obviousUnsafeControl. Every policy/effect-bearing input stays exact.
  return {
    tag: snapshot.tag.toLowerCase(),
    role: snapshot.role.toLowerCase(),
    name: snapshot.name,
    type: (snapshot.attributes.type ?? "").toLowerCase(),
    controlName: normalizeIdentityWhitespace(snapshot.attributes.name),
    autocomplete: normalizeIdentityWhitespace(snapshot.attributes.autocomplete).toLowerCase(),
    hrefPresent: snapshot.hrefPresent,
    normalizedHref: snapshot.normalizedHref,
    target: normalizeIdentityWhitespace(snapshot.attributes.target).toLowerCase(),
    download: snapshot.attributes.download === "true",
    formmethod: normalizeIdentityWhitespace(snapshot.attributes.formmethod).toLowerCase(),
    disabled: snapshot.disabled,
    recoverable: !snapshot.identityTruncated && (!snapshot.hrefPresent || snapshot.normalizedHref !== null),
  }
}

function sameSafeSemanticIdentity(
  left: SafeSemanticIdentity,
  right: SafeSemanticIdentity,
): boolean {
  return left.recoverable === right.recoverable &&
    left.tag === right.tag &&
    left.role === right.role &&
    left.name === right.name &&
    left.type === right.type &&
    left.controlName === right.controlName &&
    left.autocomplete === right.autocomplete &&
    left.hrefPresent === right.hrefPresent &&
    left.normalizedHref === right.normalizedHref &&
    left.target === right.target &&
    left.download === right.download &&
    left.formmethod === right.formmethod &&
    left.disabled === right.disabled
}

async function readElement(handle: ElementHandle<Node>): Promise<ElementSnapshot> {
  return handle.evaluate((node, limits) => {
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
    let identityTruncated = truncated
    const attributes: Record<string, string> = {}
    for (const attribute of ["name", "placeholder", "autocomplete", "href", "target"] as const) {
      const value = element.getAttribute(attribute)
      if (value !== null) {
        if (value.length > limits.maximumElementFieldCharacters) {
          truncated = true
          if (attribute !== "placeholder") identityTruncated = true
        }
        attributes[attribute] = value.slice(0, limits.maximumElementFieldCharacters)
      }
    }
    const rawHref = element.getAttribute("href")
    let normalizedHref: string | null = null
    if (rawHref !== null) {
      try {
        const resolved = new URL(rawHref, element.ownerDocument.baseURI).href
        if (resolved.length > limits.maximumElementFieldCharacters) identityTruncated = true
        normalizedHref = resolved.slice(0, limits.maximumElementFieldCharacters)
      } catch {
        normalizedHref = null
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
      normalizedHref,
      hrefPresent: rawHref !== null,
      identityTruncated,
      truncated,
    }
  }, {
    maximumElementRoleCharacters: MAX_ELEMENT_ROLE_CHARACTERS,
    maximumElementFieldCharacters: MAX_ELEMENT_FIELD_CHARACTERS,
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
  #retiredHandles: Array<ElementHandle<Node>> = []
  #initialNavigationCompleted = false
  #activePolicyAction: ActivePolicyAction | null = null
  #nextPolicyActionToken = 0
  #documentSequence = 0
  #observedDocumentSequence: number | null = null
  #semanticObservationPass = 0
  readonly #recoveryCounters = {
    directHandle: 0,
    rebind: 0,
    ambiguous: 0,
    exhausted: 0,
    observationRecoveryAttempted: 0,
    observationRecoverySucceeded: 0,
    observationRecoveryExhausted: 0,
  }
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

  browserDiagnosticsSnapshot(): BrowserRecoveryCounters {
    return { ...this.#recoveryCounters }
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
          this.#semanticObservationPass = 0
          this.#clearRegistry()
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
      this.#clearRegistry()
      if (context) await settleWithin(context.close(), 5_000)
      if (browser) await settleWithin(browser.close(), 5_000)
      throw normalizeBrowserTerminalFailure("browser_connect", error, signal)
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
      this.#clearRegistry()
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
    try {
      return await this.#navigate(url, signal)
    } catch (error) {
      throw normalizeBrowserTerminalFailure("navigation", error, signal)
    }
  }

  async #navigate(url: string, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    const target = assertAllowedNavigation(url, this.#allowedOrigins)
    const page = this.#requirePage()
    const performNavigation = async (): Promise<void> => {
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

        // A committed document is usable even when generic sites never finish loading.
        // Stabilization is only a bounded hint; observation owns the single recovery.
        const stabilizationBudget = Math.min(
          MAX_DOM_CONTENT_LOADED_GRACE_MS,
          Math.max(100, Math.floor(this.#internalOperationTimeoutMs * 0.15)),
          remainingPhaseMs(deadline, "navigation stabilization"),
        )
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
        await runBrowserPhase(
          "document stabilization",
          remainingPhaseMs(deadline, "document stabilization"),
          signal,
          (phaseSignal) => raceWithAbort(page.waitForTimeout(quietIntervalMs), phaseSignal),
        )
        this.#assertCurrentOrigin()
      } catch (error) {
        if (!committed || signal.aborted) {
          void page.close({ runBeforeUnload: false }).catch(() => {})
        }
        throw error
      }
    }

    if (this.#initialNavigationCompleted) {
      await this.#runWithPolicyAction("navigation", performNavigation)
    } else {
      await performNavigation()
    }
    try {
      return await this.observe(signal)
    } catch (error) {
      throw observationFailureAfterEffect("navigation_committed", error)
    }
  }

  async observe(signal: AbortSignal): Promise<UntrustedAgentObservation> {
    const deadline = Date.now() + this.#internalOperationTimeoutMs
    let recoveryAttempted = false
    let recoveryExhaustedRecorded = false
    try {
      for (let attempt = 1; attempt <= MAX_OBSERVATION_CAPTURE_ATTEMPTS; attempt += 1) {
        const remaining = remainingPhaseMs(deadline, "semantic observation capture")
        const attemptBudget = attempt === 1
          ? Math.min(remaining, Math.max(500, Math.floor(remaining * 0.6)))
          : remaining
        try {
          const observation = await this.#observe(signal, attemptBudget)
          if (!recoveryAttempted) return observation
          this.#incrementRecoveryCounter("observationRecoverySucceeded")
          return UntrustedAgentObservationSchema.parse({
            ...observation,
            discoverySummary: `${observation.discoverySummary}; one bounded fresh-observation recovery succeeded`,
          })
        } catch (error) {
          this.#observedDocumentSequence = null
          this.#clearRegistry()
          if (
            attempt === MAX_OBSERVATION_CAPTURE_ATTEMPTS ||
            !this.#canRecoverObservation(error, signal)
          ) {
            if (recoveryAttempted) {
              this.#incrementRecoveryCounter("observationRecoveryExhausted")
              recoveryExhaustedRecorded = true
            }
            throw error
          }
          recoveryAttempted = true
          this.#incrementRecoveryCounter("observationRecoveryAttempted")
          const quietIntervalMs = Math.min(
            MAX_DOCUMENT_QUIET_INTERVAL_MS,
            remainingPhaseMs(deadline, "document change recovery"),
          )
          await runBrowserPhase(
            "document change recovery",
            remainingPhaseMs(deadline, "document change recovery"),
            signal,
            (phaseSignal) => raceWithAbort(
              this.#requirePage().waitForTimeout(quietIntervalMs),
              phaseSignal,
            ),
          )
        }
      }
      throw new Error("Observation recovery exhausted unexpectedly")
    } catch (error) {
      if (recoveryAttempted && !recoveryExhaustedRecorded) {
        this.#incrementRecoveryCounter("observationRecoveryExhausted")
      }
      this.#observedDocumentSequence = null
      this.#clearRegistry()
      throw normalizeBrowserTerminalFailure("observation", error, signal)
    }
  }

  async #observe(signal: AbortSignal, timeoutMs: number): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    this.#throwIfFatalPolicyViolation()
    const page = this.#requirePage()
    this.#assertCurrentOrigin()
    const documentSequence = this.#documentSequence
    this.#revision += 1
    const revision = ObservationRevisionSchema.parse(this.#revision)
    this.#clearRegistry()

    const semanticPass = this.#semanticObservationPass
    this.#semanticObservationPass = (this.#semanticObservationPass + 1) % 1_000
    const { collected, candidateHandles } = await runBrowserPhase(
      "semantic observation capture",
      timeoutMs,
      signal,
      async (phaseSignal) => {
        let captureHandle: JSHandle<InPageSemanticCapture> | null = null
        let nodesHandle: JSHandle<readonly Element[]> | null = null
        let nodePropertyHandles: Map<string, JSHandle<unknown>> | null = null
        const transferredHandles = new Set<JSHandle<unknown>>()
        let candidateHandlesTransferred = false
        const disposeHandle = (handle: JSHandle<unknown>): void => {
          void handle.dispose().catch(() => {})
        }
        const disposePropertyHandles = (handles: Map<string, JSHandle<unknown>>): void => {
          for (const handle of handles.values()) disposeHandle(handle)
        }
        try {
          // The page retains only the bounded prefix as remote nodes. Snapshotting happens against
          // those exact nodes in the same evaluation, while totalCount preserves truncation honesty.
          captureHandle = await raceWithAbortAndCleanup(
            page.evaluateHandle(
              ({ selector, limits, semanticPass }): InPageSemanticCapture => {
                const semanticMatches = document.querySelectorAll(selector)
                const allNodes = Array.from(semanticMatches)
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
        const rankedNodes = allNodes
          .map((node, sourceIndex) => {
            try {
              const element = node as HTMLElement
              const rect = element.getBoundingClientRect()
              const inViewport =
                rect.bottom >= 0 &&
                rect.right >= 0 &&
                rect.top <= window.innerHeight &&
                rect.left <= window.innerWidth
              const tag = element.tagName.toLowerCase()
              const role = element.getAttribute("role")?.toLowerCase() ?? ""
              const actionable =
                tag === "a" ||
                tag === "button" ||
                tag === "input" ||
                tag === "select" ||
                tag === "textarea" ||
                element.isContentEditable ||
                ["button", "link", "checkbox", "radio", "combobox", "textbox", "tab"].includes(role)
              const verticalDistance = inViewport
                ? 0
                : rect.bottom < 0
                  ? Math.abs(rect.bottom)
                  : Math.max(0, rect.top - window.innerHeight)
              return {
                node,
                sourceIndex,
                visible: isVisible(element),
                priority: inViewport && actionable ? 0 : inViewport ? 1 : actionable ? 2 : 3,
                verticalDistance,
              }
            } catch {
              return {
                node,
                sourceIndex,
                visible: false,
                priority: 4,
                verticalDistance: Number.MAX_SAFE_INTEGER,
              }
            }
          })
          .filter((candidate) => candidate.visible)
          .sort((left, right) =>
            left.priority - right.priority ||
            left.verticalDistance - right.verticalDistance ||
            left.sourceIndex - right.sourceIndex,
          )
          .map((candidate) => candidate.node)
        const totalCount = rankedNodes.length
        const maximumCandidates = Math.min(limits.maximumCandidates, rankedNodes.length)
        const anchorCount = Math.min(limits.progressiveAnchorCount, maximumCandidates)
        let nodes: Element[]
        if (semanticPass === 0 || rankedNodes.length <= maximumCandidates) {
          nodes = rankedNodes.slice(0, maximumCandidates)
        } else {
          const anchors = rankedNodes.slice(0, anchorCount)
          const remaining = rankedNodes.slice(anchorCount)
          const windowSize = maximumCandidates - anchorCount
          const offset = remaining.length === 0
            ? 0
            : ((semanticPass - 1) * Math.max(1, windowSize)) % remaining.length
          const progressive = [
            ...remaining.slice(offset, offset + windowSize),
            ...remaining.slice(0, Math.max(0, windowSize - (remaining.length - offset))),
          ].slice(0, windowSize)
          nodes = [...anchors, ...progressive]
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
          let identityTruncated = truncated
          const attributes: Record<string, string> = {}
          for (const attribute of ["name", "placeholder", "autocomplete", "href", "target"] as const) {
            const value = element.getAttribute(attribute)
            if (value !== null) {
              if (value.length > limits.maximumElementFieldCharacters) {
                truncated = true
                if (attribute !== "placeholder") identityTruncated = true
              }
              attributes[attribute] = value.slice(0, limits.maximumElementFieldCharacters)
            }
          }
          const rawHref = element.getAttribute("href")
          let normalizedHref: string | null = null
          if (rawHref !== null) {
            try {
              const resolved = new URL(rawHref, element.ownerDocument.baseURI).href
              if (resolved.length > limits.maximumElementFieldCharacters) identityTruncated = true
              normalizedHref = resolved.slice(0, limits.maximumElementFieldCharacters)
            } catch {
              normalizedHref = null
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
            normalizedHref,
            hrefPresent: rawHref !== null,
            identityTruncated,
            truncated,
          }
        }

        const semanticElements: InPageSemanticElement[] = []
        let elementReadFailed = false
        const candidateCount = Math.min(nodes.length, limits.maximumCandidates)
        for (let sourceIndex = 0; sourceIndex < candidateCount; sourceIndex += 1) {
          const node = nodes[sourceIndex]
          if (!node) continue
          const element = node as Element
          try {
            if (!isVisible(element)) continue
            semanticElements.push({ sourceIndex, snapshot: readSnapshot(element) })
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
          totalCount,
          elementReadFailed,
          elements: semanticElements,
          nodes,
        }
      },
      {
        selector: SEMANTIC_SELECTOR,
        limits: {
          maximumCandidates: MAX_SEMANTIC_CANDIDATES,
          progressiveAnchorCount: PROGRESSIVE_SEMANTIC_ANCHOR_COUNT,
          maximumElementRoleCharacters: MAX_ELEMENT_ROLE_CHARACTERS,
          maximumElementFieldCharacters: MAX_ELEMENT_FIELD_CHARACTERS,
          maximumVisibleTextCharacters: MAX_VISIBLE_TEXT_CHARACTERS,
        },
        semanticPass,
      },
            ),
            phaseSignal,
            disposeHandle,
          )
          const capturedSnapshot = await raceWithAbort(
            captureHandle.evaluate((capture): InPageSemanticSnapshot => {
              const { nodes: _nodes, ...snapshot } = capture
              return snapshot
            }),
            phaseSignal,
          )
          nodesHandle = await raceWithAbortAndCleanup(
            captureHandle.getProperty("nodes"),
            phaseSignal,
            disposeHandle,
          )
          nodePropertyHandles = await raceWithAbortAndCleanup(
            nodesHandle.getProperties(),
            phaseSignal,
            disposePropertyHandles,
          )
          const boundedCount = Math.min(capturedSnapshot.totalCount, MAX_SEMANTIC_CANDIDATES)
          const handles: ElementHandle<Node>[] = []
          for (let index = 0; index < boundedCount; index += 1) {
            const propertyHandle = nodePropertyHandles.get(String(index))
            const elementHandle = propertyHandle?.asElement()
            if (!propertyHandle || !elementHandle) {
              throw new Error("Bounded semantic node acquisition returned an incomplete handle set")
            }
            transferredHandles.add(propertyHandle)
            handles.push(elementHandle)
          }
          throwIfAborted(phaseSignal)
          candidateHandlesTransferred = true
          return { collected: capturedSnapshot, candidateHandles: handles }
        } finally {
          if (nodePropertyHandles) {
            for (const handle of nodePropertyHandles.values()) {
              if (!candidateHandlesTransferred || !transferredHandles.has(handle)) disposeHandle(handle)
            }
          }
          if (nodesHandle) disposeHandle(nodesHandle)
          if (captureHandle) disposeHandle(captureHandle)
        }
      },
      ({ candidateHandles: abandonedHandles }) => {
        for (const handle of abandonedHandles) void handle.dispose().catch(() => {})
      },
    )
    const disposeCandidateHandles = (): void => {
      for (const handle of candidateHandles) void handle.dispose().catch(() => {})
    }
    const url = collected.url
    let snapshotUrl: URL
    try {
      snapshotUrl = new URL(url)
    } catch (error) {
      disposeCandidateHandles()
      throw error
    }
    if (snapshotUrl.protocol !== "https:" || !this.#allowedOrigins.has(snapshotUrl.origin)) {
      disposeCandidateHandles()
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
      discoverySummary: `${candidateElements.length} visible semantic elements; progressive semantic window ${semanticPass + 1}`,
      truncated,
    })
    try {
      if (Buffer.byteLength(JSON.stringify(envelope("", [])), "utf8") > this.#maxObservationBytes) {
        throw new Error("Observation envelope exceeds the configured byte budget")
      }
    } catch (error) {
      disposeCandidateHandles()
      throw error
    }

    const retainedHandles = new Set<ElementHandle<Node>>()
    try {
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
        const handle = candidateHandles[sourceIndex]
        if (!handle) {
          truncated = true
          continue
        }
        const identity = safeSemanticIdentity(snapshot)
        this.#registry.set(ref, { ref, revision, handle, identity, snapshot })
        retainedHandles.add(handle)
        elements.push(element)
      }
    } finally {
      for (const handle of candidateHandles) {
        if (!retainedHandles.has(handle)) void handle.dispose().catch(() => {})
      }
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
    if (this.#documentSequence !== documentSequence) throw documentChangeFailure("semantic_capture")
    this.#assertCurrentOrigin()
    this.#throwIfFatalPolicyViolation()
    this.#observedDocumentSequence = documentSequence
    return observation
  }

  async click(input: ElementActionInput, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    const entry = await this.#resolve(input, signal, "click")
    this.#assertElementSafe(entry.snapshot)
    if (entry.identity.hrefPresent) {
      if (entry.identity.normalizedHref === null) {
        throw blockedByPolicy("origin_not_admitted", "Navigation URL is invalid")
      }
      assertAllowedNavigation(entry.identity.normalizedHref, this.#allowedOrigins)
    }
    const documentSequence = this.#documentSequence
    await this.#runWithPolicyAction(entry.identity.hrefPresent ? "navigation" : "direct_interaction", async () => {
      await entry.handle.click({ timeout: this.#internalOperationTimeoutMs })
    })
    const disposition: BrowserEffectDisposition =
      entry.identity.hrefPresent && this.#documentSequence !== documentSequence
        ? "navigation_committed"
        : "interaction_dispatched_effect_uncertain"
    return this.#observeAfterEffect(disposition, signal)
  }

  async type(
    input: ElementActionInput & { readonly text: string; readonly clearFirst: boolean },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    if (Buffer.byteLength(input.text, "utf8") > 4_000) throw new Error("Text is too large")
    const entry = await this.#resolve(input, signal, "type")
    this.#assertElementSafe(entry.snapshot)
    await this.#runWithPolicyAction("direct_interaction", async () => {
      if (input.clearFirst) await entry.handle.fill(input.text)
      else await entry.handle.type(input.text)
    })
    return this.#observeAfterEffect("interaction_dispatched_effect_uncertain", signal)
  }

  async select(
    input: ElementActionInput & { readonly value: string },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    const entry = await this.#resolve(input, signal, "select")
    this.#assertElementSafe(entry.snapshot)
    await this.#runWithPolicyAction("direct_interaction", async () => {
      await entry.handle.selectOption(input.value)
    })
    return this.#observeAfterEffect("interaction_dispatched_effect_uncertain", signal)
  }

  async pressKey(
    input: ElementActionInput & { readonly key: string },
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    if (!ALLOWED_KEYS.has(input.key)) {
      throw blockedByPolicy("press_key_forbidden", "Keyboard key is not allowed")
    }
    const entry = await this.#resolve(input, signal, "press_key")
    this.#assertElementSafe(entry.snapshot)
    await this.#runWithPolicyAction("direct_interaction", async () => {
      await entry.handle.press(input.key)
    })
    return this.#observeAfterEffect("interaction_dispatched_effect_uncertain", signal)
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
    return this.#observeAfterEffect("interaction_dispatched_effect_uncertain", signal)
  }

  async wait(durationMs: number, signal: AbortSignal): Promise<UntrustedAgentObservation> {
    throwIfAborted(signal)
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 15_000) {
      throw new Error("Wait duration is out of bounds")
    }
    await this.#requirePage().waitForTimeout(durationMs)
    throwIfAborted(signal)
    return this.#observeAfterEffect("interaction_dispatched_effect_uncertain", signal)
  }

  async currentPageDiscoverySnapshot(
    signal: AbortSignal,
  ): Promise<CurrentPageDiscoverySnapshot> {
    try {
      return await this.#currentPageDiscoverySnapshot(signal)
    } catch (error) {
      throw normalizeBrowserTerminalFailure("discovery", error, signal)
    }
  }

  async #currentPageDiscoverySnapshot(
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
      policyActivity: {
        passiveWarningCount: this.#passivePolicyCount,
        codes: [...this.#passivePolicyCodes],
      },
      recoveryCounters: this.browserDiagnosticsSnapshot(),
    }
  }

  async currentOriginWebMcpTools(
    signal: AbortSignal,
  ): Promise<readonly RawCurrentOriginWebMcpTool[]> {
    try {
      return await this.#currentOriginWebMcpTools(signal)
    } catch (error) {
      throw normalizeBrowserTerminalFailure("discovery", error, signal)
    }
  }

  async #currentOriginWebMcpTools(
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
    try {
      this.#assertCurrentOrigin()
      this.#assertObservedDocument()
      return new URL(this.#requirePage().url()).origin
    } catch (error) {
      throw normalizeBrowserTerminalFailure("discovery", error)
    }
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
    try {
      return await this.#readCurrentOriginText(path, maxBytes, signal)
    } catch (error) {
      throw normalizeBrowserTerminalFailure("discovery", error, signal)
    }
  }

  async #readCurrentOriginText(
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
    try {
      return await this.#captureAssertionSnapshot(input, signal)
    } catch (error) {
      throw normalizeBrowserTerminalFailure("assertion_capture", error, signal)
    }
  }

  async #captureAssertionSnapshot(
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
      throw documentChangeFailure("semantic_capture")
    }
    this.#assertCurrentOrigin()
    this.#throwIfFatalPolicyViolation()
    if (collected.finalUrl.status === "captured" && collected.finalUrl.value !== page.url()) {
      throw documentChangeFailure("document_change")
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
    action: ElementActionKind,
  ): Promise<RegistryEntry> {
    throwIfAborted(signal)
    this.#throwIfFatalPolicyViolation()
    if (
      input.observationRevision !== this.#revision ||
      this.#observedDocumentSequence === null ||
      this.#observedDocumentSequence !== this.#documentSequence
    ) {
      this.#incrementRecoveryCounter("exhausted")
      throw staleElement()
    }
    const entry = this.#registry.get(input.ref)
    if (!entry || entry.revision !== input.observationRevision) {
      this.#incrementRecoveryCounter("exhausted")
      throw staleElement()
    }

    const documentSequence = this.#documentSequence
    this.#assertCurrentOrigin()
    this.#assertElementSafe(entry.snapshot)

    let identityChanged = false
    if (await this.#isHandleActionable(entry.handle, action)) {
      const current = await readElement(entry.handle).catch(() => null)
      if (current) {
        const currentIdentity = safeSemanticIdentity(current)
        if (sameSafeSemanticIdentity(currentIdentity, entry.identity)) {
          this.#assertElementSafe(current)
          this.#assertRecoveryContext(documentSequence)
          this.#incrementRecoveryCounter("directHandle")
          return { ...entry, identity: currentIdentity, snapshot: current }
        }
        identityChanged = true
      }
    }

    if (!entry.identity.recoverable) {
      if (identityChanged) {
        this.#incrementRecoveryCounter("ambiguous")
        throw ambiguousElement()
      }
      this.#incrementRecoveryCounter("exhausted")
      throw staleElement("Element reference cannot be safely rebound from a truncated identity")
    }

    // A single failed direct binding gets exactly one semantic scan; no action retries rescan.
    const reboundHandle = await this.#freshSemanticLookup(entry.identity, action, signal)
    if (reboundHandle !== null) {
      try {
        this.#assertRecoveryContext(documentSequence)
      } catch (error) {
        await reboundHandle.dispose().catch(() => {})
        throw error
      }
    }
    if (reboundHandle === null) {
      if (identityChanged) {
        this.#incrementRecoveryCounter("ambiguous")
        throw ambiguousElement()
      }
      this.#incrementRecoveryCounter("exhausted")
      throw staleElement("Element reference is stale and no unique semantic replacement exists")
    }

    if (!(await this.#isHandleActionable(reboundHandle, action))) {
      await reboundHandle.dispose().catch(() => {})
      this.#incrementRecoveryCounter("exhausted")
      throw staleElement("Recovered element is no longer actionable")
    }
    const rebound = await readElement(reboundHandle).catch(() => null)
    if (!rebound) {
      await reboundHandle.dispose().catch(() => {})
      this.#incrementRecoveryCounter("exhausted")
      throw staleElement("Recovered element detached before dispatch")
    }
    const reboundIdentity = safeSemanticIdentity(rebound)
    if (!sameSafeSemanticIdentity(reboundIdentity, entry.identity)) {
      await reboundHandle.dispose().catch(() => {})
      this.#incrementRecoveryCounter("ambiguous")
      throw ambiguousElement("Recovered element identity changed before dispatch")
    }
    try {
      this.#assertElementSafe(rebound)
      this.#assertRecoveryContext(documentSequence)
    } catch (error) {
      await reboundHandle.dispose().catch(() => {})
      throw error
    }
    const reboundEntry = { ...entry, handle: reboundHandle, identity: reboundIdentity, snapshot: rebound }
    this.#registry.set(entry.ref, reboundEntry)
    await entry.handle.dispose().catch(() => {})
    this.#incrementRecoveryCounter("rebind")
    return reboundEntry
  }

  async #freshSemanticLookup(
    identity: SafeSemanticIdentity,
    action: ElementActionKind,
    signal: AbortSignal,
  ): Promise<ElementHandle<Node> | null> {
    const controls = this.#requirePage().locator(SEMANTIC_SELECTOR)
    const lookup = controls.evaluateAll((nodes, request) => {
      const normalizeWhitespace = (value: string | null): string =>
        (value ?? "").replace(/\s+/g, " ").trim()
      const visibleTextNode = (node: Text): boolean => {
        const range = document.createRange()
        range.selectNode(node)
        const rect = range.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }
      const visible = (element: Element): boolean => {
        const style = getComputedStyle(element)
        if (style.display === "contents") {
          for (const child of element.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE && visible(child as Element)) return true
            if (child.nodeType === Node.TEXT_NODE && visibleTextNode(child as Text)) return true
          }
          return false
        }
        if (typeof element.checkVisibility === "function" && !element.checkVisibility()) return false
        if (style.visibility !== "visible") return false
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }
      const actionable = (element: HTMLElement): boolean => {
        const disabled = "disabled" in element && Boolean((element as HTMLButtonElement).disabled)
        if (disabled || element.getAttribute("aria-disabled")?.toLowerCase() === "true") return false
        if (request.action === "select") return element instanceof HTMLSelectElement
        if (request.action !== "type") return true
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          return !element.readOnly
        }
        return element.isContentEditable
      }
      const readIdentity = (node: Element): SafeSemanticIdentity => {
        const element = node as HTMLElement
        const tag = element.tagName.toLowerCase()
        const input = element instanceof HTMLInputElement ? element : null
        const select = element instanceof HTMLSelectElement ? element : null
        const rawExplicitRole = element.getAttribute("role")?.trim()
        const explicitRole = rawExplicitRole?.slice(0, request.maximumElementRoleCharacters)
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
        const rawHref = element.getAttribute("href")
        let normalizedHref: string | null = null
        let identityTruncated =
          normalizedName.length > request.maximumElementFieldCharacters ||
          (rawExplicitRole?.length ?? 0) > request.maximumElementRoleCharacters
        if (rawHref !== null) {
          try {
            const resolved = new URL(rawHref, element.ownerDocument.baseURI).href
            if (resolved.length > request.maximumElementFieldCharacters) identityTruncated = true
            normalizedHref = resolved.slice(0, request.maximumElementFieldCharacters)
          } catch {
            normalizedHref = null
          }
        }
        const controlName = element.getAttribute("name")
        const autocomplete = element.getAttribute("autocomplete")
        const target = element.getAttribute("target")
        if (
          (controlName?.length ?? 0) > request.maximumElementFieldCharacters ||
          (autocomplete?.length ?? 0) > request.maximumElementFieldCharacters ||
          (target?.length ?? 0) > request.maximumElementFieldCharacters
        ) identityTruncated = true
        let formmethod = ""
        if (input?.form) formmethod = (input.formMethod || input.form.method).toLowerCase()
        if (element instanceof HTMLButtonElement && element.form) {
          formmethod = (element.formMethod || element.form.method).toLowerCase()
        }
        return {
          tag,
          role: (explicitRole || inferredRole).toLowerCase(),
          name: normalizedName.slice(0, request.maximumElementFieldCharacters),
          type: input
            ? input.type.toLowerCase()
            : element instanceof HTMLButtonElement
              ? element.type.toLowerCase()
              : "",
          controlName: normalizeWhitespace(controlName),
          autocomplete: normalizeWhitespace(autocomplete).toLowerCase(),
          hrefPresent: rawHref !== null,
          normalizedHref,
          target: normalizeWhitespace(target).toLowerCase(),
          download: element instanceof HTMLAnchorElement && element.hasAttribute("download"),
          formmethod,
          disabled: "disabled" in element ? Boolean((element as HTMLButtonElement).disabled) : null,
          recoverable: !identityTruncated && (rawHref === null || normalizedHref !== null),
        }
      }
      const equal = (candidate: SafeSemanticIdentity): boolean =>
        candidate.recoverable &&
        candidate.tag === request.identity.tag &&
        candidate.role === request.identity.role &&
        candidate.name === request.identity.name &&
        candidate.type === request.identity.type &&
        candidate.controlName === request.identity.controlName &&
        candidate.autocomplete === request.identity.autocomplete &&
        candidate.hrefPresent === request.identity.hrefPresent &&
        candidate.normalizedHref === request.identity.normalizedHref &&
        candidate.target === request.identity.target &&
        candidate.download === request.identity.download &&
        candidate.formmethod === request.identity.formmethod &&
        candidate.disabled === request.identity.disabled

      let firstIndex: number | null = null
      let matchingCount = 0
      let indeterminate = false
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]
        if (!node) continue
        try {
          if (!visible(node)) continue
          const element = node as HTMLElement
          if (!actionable(element) || !equal(readIdentity(node))) continue
          matchingCount += 1
          if (firstIndex === null) firstIndex = index
          if (matchingCount > 1) break
        } catch {
          indeterminate = true
        }
      }
      return { firstIndex, matchingCount, indeterminate }
    }, {
      identity,
      action,
      maximumElementRoleCharacters: MAX_ELEMENT_ROLE_CHARACTERS,
      maximumElementFieldCharacters: MAX_ELEMENT_FIELD_CHARACTERS,
    })
    const result = await raceWithAbort(lookup, signal)
    if (result.matchingCount > 1) {
      this.#incrementRecoveryCounter("ambiguous")
      throw ambiguousElement("Multiple visible actionable elements share the original semantic identity")
    }
    if (result.indeterminate) {
      this.#incrementRecoveryCounter("exhausted")
      throw staleElement("Semantic recovery could not safely inspect every candidate")
    }
    if (result.matchingCount !== 1 || result.firstIndex === null) return null
    return raceWithAbort(controls.nth(result.firstIndex).elementHandle(), signal)
  }

  async #isHandleActionable(
    handle: ElementHandle<Node>,
    action: ElementActionKind,
  ): Promise<boolean> {
    if (!(await handle.isVisible().catch(() => false))) return false
    if (action === "type") return handle.isEditable().catch(() => false)
    if (action === "select") {
      const isSelect = await handle.evaluate((node) => node instanceof HTMLSelectElement).catch(() => false)
      if (!isSelect) return false
    }
    return handle.isEnabled().catch(() => false)
  }

  #assertRecoveryContext(documentSequence: number): void {
    if (
      this.#documentSequence !== documentSequence ||
      this.#observedDocumentSequence !== documentSequence
    ) {
      throw staleElement("Document changed during element recovery")
    }
    this.#assertCurrentOrigin()
    this.#throwIfFatalPolicyViolation()
  }

  #clearRegistry(): void {
    for (const entry of this.#registry.values()) this.#retiredHandles.push(entry.handle)
    this.#registry.clear()
    if (!this.#activePolicyAction) this.#disposeRetiredHandles()
  }

  #disposeRetiredHandles(): void {
    const handles = this.#retiredHandles.splice(0)
    for (const handle of handles) void handle.dispose().catch(() => {})
  }

  #incrementRecoveryCounter(key: keyof BrowserRecoveryCounters): void {
    this.#recoveryCounters[key] = Math.min(1_000, this.#recoveryCounters[key] + 1)
  }

  #canRecoverObservation(error: unknown, signal: AbortSignal): boolean {
    if (signal.aborted || this.#firstFatalPolicyViolation) return false
    if (error instanceof BrowserPhaseError) return true
    if (!(error instanceof TraceGateError)) return false
    const parsed = FailureRecordSchema.safeParse(error.safe)
    return parsed.success && ["infrastructure", "timeout", "tool_error"].includes(parsed.data.category)
  }

  async #observeAfterEffect(
    disposition: BrowserEffectDisposition,
    signal: AbortSignal,
  ): Promise<UntrustedAgentObservation> {
    try {
      return await this.observe(signal)
    } catch (error) {
      throw observationFailureAfterEffect(disposition, error)
    }
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
      try {
        const result = await operation()
        this.#throwIfFatalPolicyViolation()
        return result
      } catch (error) {
        this.#throwIfFatalPolicyViolation()
        throw error
      }
    } finally {
      if (this.#activePolicyAction === activeAction) this.#activePolicyAction = null
      this.#disposeRetiredHandles()
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

  #eventPolicyDisposition(): BlockedPolicyDisposition {
    return this.#activePolicyAction === null ? "passive" : "fatal"
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
      this.#recordPolicy("unknown_effect", this.#eventPolicyDisposition(), this.#eventPolicyDiagnostic("dialog"))
      void dialog.dismiss().catch(() => {})
    })
    page.on("download", (download) => {
      this.#recordPolicy(
        "upload_or_download_forbidden",
        this.#eventPolicyDisposition(),
        this.#eventPolicyDiagnostic("download"),
      )
      void download.cancel().catch(() => {})
    })
    page.on("filechooser", (chooser) => {
      this.#recordPolicy(
        "upload_or_download_forbidden",
        this.#eventPolicyDisposition(),
        this.#eventPolicyDiagnostic("filechooser"),
      )
      void chooser.setFiles([]).catch(() => {})
    })
    context.on("page", (candidate) => {
      if (candidate !== page) {
        this.#recordPolicy("popup_forbidden", this.#eventPolicyDisposition(), this.#eventPolicyDiagnostic("popup"))
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
