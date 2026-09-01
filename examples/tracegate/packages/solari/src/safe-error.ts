import { SolariError as BrowserSolariError } from "@solarisdk/browser"

export interface SafeError {
  kind: string
  code?: string
  status?: number
}

export function toSafeError(error: unknown): SafeError {
  if (error instanceof BrowserSolariError) {
    return {
      kind: "SolariError",
      ...(error.code ? { code: error.code } : {}),
      ...(error.status ? { status: error.status } : {}),
    }
  }

  if (error instanceof Error) return { kind: error.name || "Error" }
  return { kind: "UnknownError" }
}

export function isBrowserLimitError(error: unknown): boolean {
  return (
    error instanceof BrowserSolariError &&
    (error.code === "ConcurrencyLimitExceeded" || error.status === 429)
  )
}

export function isRecordingUnsupported(error: unknown): boolean {
  return (
    error instanceof BrowserSolariError &&
    (error.code === "FeatureRequiresPlan" ||
      error.code === "PlanLimitExceeded" ||
      error.status === 402)
  )
}

export function isReleasedOrMissing(error: unknown): boolean {
  return (
    error instanceof BrowserSolariError &&
    (error.code === "InvalidSessionId" || error.status === 404)
  )
}
