import { Solari, SolariError, type Session } from "@solarisdk/browser"
import {
  BrowserProviderCreateAmbiguousErrorSchema,
  BrowserSessionIdSchema,
  RunWarningSchema,
  TraceGateError,
  UtcDateTimeSchema,
  createBrowserProviderConcurrencyLimitError,
  createControlError,
  type BrowserAcquireRequest,
  type BrowserLease,
  type BrowserProvider,
  type BrowserSessionId,
  type ReleaseResult,
  type SensitiveBrowserEndpoint,
} from "@tracegate/shared"

export interface SolariBrowserProviderOptions {
  apiKey: string
  timeoutMs?: number
  region?: "us-west"
}

type ProviderSession = Pick<Session, "id" | "cdpEndpoint">

interface SolariClientBoundary {
  readonly sessions: {
    create(options: { recording: boolean }): Promise<ProviderSession>
    releaseAndWait(sessionId: string): Promise<void>
  }
  close(): Promise<void>
}

/** Package-internal test seam; intentionally not exported from the public barrel. */
export interface SolariBrowserProviderDependencies {
  readonly client?: SolariClientBoundary
  readonly now?: () => Date
}

function safeNow(now: () => Date): ReturnType<typeof UtcDateTimeSchema.parse> {
  return UtcDateTimeSchema.parse(now().toISOString())
}

function releaseWarning(): ReturnType<typeof RunWarningSchema.parse> {
  return RunWarningSchema.parse({
    schemaVersion: 1,
    category: "infrastructure",
    code: "cleanup_failed",
    phase: "browser_release",
    retryable: true,
    message: "Solari Browser release was not confirmed",
    fieldIssues: [],
    causeChain: [],
  })
}

class SolariLease implements BrowserLease {
  readonly providerSessionId: BrowserSessionId
  readonly connectEndpoint: SensitiveBrowserEndpoint
  readonly region: string | null
  readonly recordingRequested: boolean
  #releasePromise: Promise<ReleaseResult> | null = null

  constructor(
    private readonly client: SolariClientBoundary,
    private readonly now: () => Date,
    session: ProviderSession,
    recordingRequested: boolean,
    region: string | null,
  ) {
    this.providerSessionId = BrowserSessionIdSchema.parse(session.id)
    const endpoint = new URL(session.cdpEndpoint)
    if (!["wss:", "ws:", "https:", "http:"].includes(endpoint.protocol)) {
      throw new Error("Unsupported Solari CDP endpoint protocol")
    }
    this.connectEndpoint = session.cdpEndpoint as SensitiveBrowserEndpoint
    this.recordingRequested = recordingRequested
    this.region = region
  }

  release(_reason: string, signal: AbortSignal): Promise<ReleaseResult> {
    if (this.#releasePromise) return this.#releasePromise
    this.#releasePromise = this.#release(signal)
    return this.#releasePromise
  }

  async #release(signal: AbortSignal): Promise<ReleaseResult> {
    // Provider cleanup must still run after execution cancellation. The
    // measured SDK release operation does not accept an AbortSignal.
    void signal
    try {
      await this.client.sessions.releaseAndWait(this.providerSessionId)
      return {
        status: "released",
        confirmation: "confirmed_released",
        releasedAt: safeNow(this.now),
        warning: null,
      }
    } catch {
      // A provider 404 is deliberately not treated as idempotent success.
      return {
        status: "failed",
        confirmation: "unconfirmed",
        releasedAt: null,
        warning: releaseWarning(),
      }
    }
  }
}

export class SolariBrowserProvider implements BrowserProvider {
  readonly #client: SolariClientBoundary
  readonly #region: "us-west"
  readonly #now: () => Date
  #closePromise: Promise<void> | null = null

  constructor(
    options: SolariBrowserProviderOptions,
    dependencies: SolariBrowserProviderDependencies = {},
  ) {
    if (!options.apiKey) throw new Error("Solari API key is required")
    this.#region = options.region ?? "us-west"
    this.#now = dependencies.now ?? (() => new Date())
    this.#client = dependencies.client ?? new Solari({
      apiKey: options.apiKey,
      region: this.#region,
      // Create has no measured idempotency key; exactly one HTTP attempt.
      maxAttempts: 1,
      timeoutMs: options.timeoutMs ?? 20_000,
    })
  }

  async acquire(
    request: BrowserAcquireRequest,
    signal: AbortSignal,
  ): Promise<BrowserLease> {
    if (signal.aborted) {
      throw new TraceGateError(
        createControlError("operation_aborted", "Browser acquisition aborted", {
          category: "cancellation",
          phase: "browser_acquire",
        }),
      )
    }
    if (request.region && request.region !== this.#region) {
      throw new TraceGateError(
        createControlError("validation_failed", "Unsupported Solari region", {
          category: "infrastructure",
          phase: "browser_acquire",
        }),
      )
    }

    let session: ProviderSession
    try {
      session = await this.#client.sessions.create({
        recording: request.recordingRequested,
      })
    } catch (error) {
      this.#throwCreateFailure(error, request)
    }

    // A returned session is acknowledged. If the provider payload cannot form
    // a safe lease, make one bounded emergency release attempt before failing.
    try {
      return new SolariLease(
        this.#client,
        this.#now,
        session!,
        request.recordingRequested,
        this.#region,
      )
    } catch (error) {
      let releaseConfirmed = false
      try {
        await this.#client.sessions.releaseAndWait(session!.id)
        releaseConfirmed = true
      } catch {
        // The frozen BrowserProvider port cannot return an invalid lease plus
        // cleanup state. The safe error below records the unconfirmed outcome.
      }
      throw new TraceGateError(
        createControlError(
          "service_unavailable",
          releaseConfirmed
            ? "Solari acknowledged an invalid session payload; emergency release was confirmed"
            : "Solari acknowledged an invalid session payload; emergency release was not confirmed",
          {
            category: "infrastructure",
            phase: "browser_acquire",
            retryable: false,
          },
        ),
        error,
      )
    }
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#client.close()
    return this.#closePromise
  }

  #throwCreateFailure(error: unknown, request: BrowserAcquireRequest): never {
    if (
      error instanceof SolariError &&
      (error.code === "ConcurrencyLimitExceeded" || error.status === 429)
    ) {
      throw createBrowserProviderConcurrencyLimitError(null)
    }
    if (!(error instanceof SolariError) || error.status === undefined) {
      throw new TraceGateError(
        BrowserProviderCreateAmbiguousErrorSchema.parse({
          schemaVersion: 1,
          category: "infrastructure",
          code: "session_create_ambiguous",
          phase: "browser_acquire",
          retryCurrentCreate: false,
          potentialSessionLeak: true,
          attemptCorrelationId: request.attemptCorrelationId,
          message: "Browser session creation outcome is ambiguous",
          fieldIssues: [],
          causeChain: [],
        }),
        error,
      )
    }
    throw new TraceGateError(
      createControlError("service_unavailable", "Solari Browser acquisition failed", {
        category: "infrastructure",
        phase: "browser_acquire",
        retryable: false,
      }),
      error,
    )
  }
}
