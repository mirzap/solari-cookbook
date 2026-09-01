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
): TraceGateError {
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
      fieldIssues: [],
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
  if (type === "file") return "upload_or_download_forbidden"
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
  if (request.method !== "GET" && request.method !== "HEAD") return "non_idempotent_request"
  if (request.hasBody) return "request_body_forbidden"
  if (
    request.mainFrameNavigation &&
    (url.protocol !== "https:" || !allowedOrigins.has(url.origin))
  ) {
    return "origin_not_admitted"
  }
  return null
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
