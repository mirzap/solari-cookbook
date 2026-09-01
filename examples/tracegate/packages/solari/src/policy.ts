import {
  FailureRecordSchema,
  TraceGateError,
  type PolicyDenyCode,
} from "@tracegate/shared"

const UNSAFE_CONTROL = /\b(?:sign[ -]?in|log[ -]?in|sign[ -]?up|password|passcode|otp|verification code|checkout|buy|purchase|pay|billing|credit card|bank|donat|book now|confirm booking|apply now|submit application|send|message|publish|post comment|review|delete|remove account|upload|download|choose file|permission|allow access)\b/i
const SENSITIVE_FIELD = /\b(?:password|passcode|otp|one[- ]?time|email|phone|address|card|cvv|iban|account|social security|ssn|health|medical|resume|cv)\b/i
const HIGH_ENTROPY_PATH_SEGMENT = /^[A-Za-z0-9_-]{24,}$/

export interface PolicyElementSnapshot {
  readonly tag: string
  readonly role: string
  readonly name: string
  readonly disabled: boolean | null
  readonly attributes: Readonly<Record<string, string>>
}

export interface ObservableRequestSnapshot {
  readonly url: string
  readonly method: string
  readonly hasBody: boolean
  readonly mainFrameNavigation: boolean
}

export type BrowserPolicyActionScope = "navigation" | "direct_interaction" | "webmcp"
export type BlockedPolicyDisposition = "passive" | "fatal"
export type PolicyDiagnosticMethodClass = "get" | "head" | "other" | "not_applicable"
export type PolicyDiagnosticResourceType =
  | "document"
  | "stylesheet"
  | "image"
  | "media"
  | "font"
  | "script"
  | "texttrack"
  | "xhr"
  | "fetch"
  | "eventsource"
  | "websocket"
  | "manifest"
  | "other"
  | "ping"
  | "beacon"
  | "cspviolationreport"
  | "prefetch"
  | "dialog"
  | "download"
  | "filechooser"
  | "popup"
  | "unknown"
  | "not_applicable"

export interface FirstFatalPolicyDiagnostic {
  readonly actionScope: BrowserPolicyActionScope | null
  readonly methodClass: PolicyDiagnosticMethodClass
  readonly resourceType: PolicyDiagnosticResourceType
  readonly mainFrame: boolean | null
  readonly sameOrigin: boolean | null
}

export interface BlockedRequestContext {
  readonly resourceType: string
  readonly activePageOrigin: string | null
  readonly actionScope: BrowserPolicyActionScope | null
}

export interface BlockedRequestDecision {
  readonly code: PolicyDenyCode
  readonly disposition: BlockedPolicyDisposition
}

const PASSIVE_SUBRESOURCE_TYPES = new Set([
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "texttrack",
  "eventsource",
  "manifest",
  "other",
  "ping",
  "beacon",
])

export function canonicalAllowedOrigins(origins: readonly string[]): Set<string> {
  if (origins.length === 0) throw new Error("At least one allowed origin is required")
  const result = new Set<string>()
  for (const raw of origins) {
    const url = new URL(raw)
    if (
      url.origin !== raw ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.protocol !== "https:"
    ) {
      throw new Error("Allowed origins must be exact HTTPS origins")
    }
    result.add(url.origin)
  }
  return result
}

export function assertAllowedNavigation(
  rawUrl: string,
  allowedOrigins: ReadonlySet<string>,
): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw blockedByPolicy("origin_not_admitted", "Navigation URL is invalid")
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !allowedOrigins.has(url.origin)
  ) {
    throw blockedByPolicy(
      url.protocol === "https:" ? "origin_not_admitted" : "alternate_protocol_forbidden",
      "Navigation blocked by exact-origin policy",
    )
  }
  return url
}

export function blockedByPolicy(
  code: PolicyDenyCode,
  message: string,
  firstFatalDiagnostic?: FirstFatalPolicyDiagnostic,
): TraceGateError {
  const diagnosticCode = "first_fatal_policy_context"
  const fieldIssues = firstFatalDiagnostic
    ? [
        { path: "browserPolicy.firstFatal.policyCode", code: diagnosticCode, message: code },
        {
          path: "browserPolicy.firstFatal.actionScope",
          code: diagnosticCode,
          message: firstFatalDiagnostic.actionScope ?? "none",
        },
        {
          path: "browserPolicy.firstFatal.methodClass",
          code: diagnosticCode,
          message: firstFatalDiagnostic.methodClass,
        },
        {
          path: "browserPolicy.firstFatal.resourceType",
          code: diagnosticCode,
          message: firstFatalDiagnostic.resourceType,
        },
        {
          path: "browserPolicy.firstFatal.mainFrame",
          code: diagnosticCode,
          message: firstFatalDiagnostic.mainFrame === null
            ? "unknown"
            : String(firstFatalDiagnostic.mainFrame),
        },
        {
          path: "browserPolicy.firstFatal.sameOrigin",
          code: diagnosticCode,
          message: firstFatalDiagnostic.sameOrigin === null
            ? "unknown"
            : String(firstFatalDiagnostic.sameOrigin),
        },
      ]
    : []
  return new TraceGateError(
    FailureRecordSchema.parse({
      schemaVersion: 1,
      category: "policy",
      code: "unsafe_action_blocked",
      outcome: "inconclusive",
      policyCode: code,
      phase: "browser_policy",
      retryable: false,
      message,
      fieldIssues,
      causeChain: [],
    }),
  )
}

export function obviousUnsafeControl(
  element: PolicyElementSnapshot,
): PolicyDenyCode | null {
  const type = element.attributes.type?.toLowerCase() ?? ""
  const autocomplete = element.attributes.autocomplete?.toLowerCase() ?? ""
  const identity = [element.role, element.name, element.attributes.name, type, autocomplete]
    .filter(Boolean)
    .join(" ")

  if (element.disabled) return "unobservable_effect"
  if (type === "file" || element.attributes.download === "true") {
    return "upload_or_download_forbidden"
  }
  if (element.attributes.target?.toLowerCase() === "_blank") return "popup_forbidden"
  if (type === "submit" && element.attributes.formmethod !== "get") {
    return "submit_activation_forbidden"
  }
  if (UNSAFE_CONTROL.test(identity)) {
    if (/sign|log|password|passcode|otp|verification/i.test(identity)) return "authentication_forbidden"
    if (/checkout|buy|purchase|pay|billing|card|bank|donat|book/i.test(identity)) return "financial_action_forbidden"
    if (/send|message|publish|post comment|review/i.test(identity)) return "messaging_or_publication_forbidden"
    if (/delete|remove account/i.test(identity)) return "destructive_action_forbidden"
    if (/upload|download|choose file/i.test(identity)) return "upload_or_download_forbidden"
    if (/permission|allow access/i.test(identity)) return "permission_forbidden"
    if (/apply|submit/i.test(identity)) return "submit_activation_forbidden"
    return "unknown_effect"
  }
  if (type === "password" || SENSITIVE_FIELD.test(identity)) return "sensitive_control"
  return null
}

export function classifyObservableRequest(
  request: ObservableRequestSnapshot,
  allowedOrigins: ReadonlySet<string>,
): PolicyDenyCode | null {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return "alternate_protocol_forbidden"
  }
  if (!["http:", "https:"].includes(url.protocol)) return "alternate_protocol_forbidden"
  if (url.username || url.password) return "credential_forbidden"
  const method = request.method.toUpperCase()
  if (method !== "GET" && method !== "HEAD") return "non_idempotent_request"
  if (request.hasBody) return "request_body_forbidden"
  if (
    request.mainFrameNavigation &&
    (url.protocol !== "https:" || !allowedOrigins.has(url.origin))
  ) {
    return "origin_not_admitted"
  }
  return null
}

export function classifyBlockedRequest(
  request: ObservableRequestSnapshot,
  allowedOrigins: ReadonlySet<string>,
  context: BlockedRequestContext,
): BlockedRequestDecision | null {
  const code = classifyObservableRequest(request, allowedOrigins)
  if (!code) return null

  // A blocked controlled-document request is evidence-relevant regardless of
  // temporal action correlation: it attempted to replace the graded document.
  if (request.mainFrameNavigation) return { code, disposition: "fatal" }

  // Playwright does not expose a reliable request initiator that links a fetch
  // to a particular DOM action. Treat temporal scope as supporting metadata,
  // never as a permanent post-action latch. Page-load, wait, scroll, worker,
  // and late traffic therefore remain passive.
  if (context.actionScope === null || context.actionScope === "navigation") {
    return { code, disposition: "passive" }
  }

  let destinationOrigin: string | null = null
  try {
    const destination = new URL(request.url)
    if (destination.protocol === "http:" || destination.protocol === "https:") {
      destinationOrigin = destination.origin
    }
  } catch {
    // Malformed/non-network subresource destinations have no structural
    // same-origin evidence and remain blocked as passive activity.
  }

  if (context.activePageOrigin === null || destinationOrigin !== context.activePageOrigin) {
    return { code, disposition: "passive" }
  }

  const sameOriginStateChange =
    code === "non_idempotent_request" || code === "request_body_forbidden"
  return {
    code,
    disposition:
      sameOriginStateChange || !PASSIVE_SUBRESOURCE_TYPES.has(context.resourceType.toLowerCase())
        ? "fatal"
        : "passive",
  }
}

export function classifyBlockedWebSocket(
  rawUrl: string,
  activePageOrigin: string | null,
  actionScope: BrowserPolicyActionScope | null,
): BlockedPolicyDisposition {
  if (
    activePageOrigin === null ||
    (actionScope !== "direct_interaction" && actionScope !== "webmcp")
  ) {
    return "passive"
  }
  try {
    const url = new URL(rawUrl)
    const comparableOrigin =
      url.protocol === "wss:"
        ? new URL(`https://${url.host}`).origin
        : url.protocol === "ws:"
          ? new URL(`http://${url.host}`).origin
          : null
    return comparableOrigin === activePageOrigin ? "fatal" : "passive"
  } catch {
    return "passive"
  }
}

export function redactUrlForPersistence(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "https:") return null
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    url.pathname = url.pathname
      .split("/")
      .map((segment) => (HIGH_ENTROPY_PATH_SEGMENT.test(segment) ? "redacted" : segment))
      .join("/")
    return url.href
  } catch {
    return null
  }
}
