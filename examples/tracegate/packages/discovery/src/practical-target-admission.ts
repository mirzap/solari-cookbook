import { lookup as nodeLookup } from "node:dns/promises"
import {
  PublicEvaluationTargetV2Schema,
  TargetAdmissionResultSchema,
  classifyNetworkHostname,
  classifyResolvedIp,
  type PublicEvaluationTargetV2,
  type AdmissionReasonCode,
  type TargetAdmissionPort,
  type TargetAdmissionResult,
} from "@tracegate/shared"

export interface ResolvedAddress {
  readonly address: string
  readonly family: number
}

export interface PracticalTargetAdmissionOptions {
  readonly lookup?: (hostname: string) => Promise<readonly ResolvedAddress[]>
  readonly now?: () => Date
  readonly admissionTtlMs?: number
  readonly lookupTimeoutMs?: number
  readonly serviceWorkerControl?: "blocked" | "unsupported"
  readonly requestInterception?: "get_head_only_observable" | "unavailable"
}

/** Compatibility predicate backed exclusively by the shared address classifier. */
export function isPublicNetworkAddress(address: string): boolean {
  return classifyResolvedIp(address) === "public"
}

async function defaultLookup(hostname: string): Promise<readonly ResolvedAddress[]> {
  return nodeLookup(hostname, { all: true, verbatim: true })
}

async function lookupWithDeadline(
  lookup: (hostname: string) => Promise<readonly ResolvedAddress[]>,
  hostname: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<readonly ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(new DOMException("Target admission aborted", "AbortError")))
    const timeout = setTimeout(
      () => finish(() => reject(new DOMException("DNS lookup timed out", "TimeoutError"))),
      timeoutMs,
    )
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    lookup(hostname).then(
      (answers) => finish(() => resolve(answers)),
      (error) => finish(() => reject(error)),
    )
  })
}

function rejected(
  reason: Exclude<AdmissionReasonCode, "admitted">,
  message: string,
): TargetAdmissionResult {
  return TargetAdmissionResultSchema.parse({ status: "rejected", reason, message })
}

export class PracticalTargetAdmission implements TargetAdmissionPort {
  readonly #lookup: (hostname: string) => Promise<readonly ResolvedAddress[]>
  readonly #now: () => Date
  readonly #ttlMs: number
  readonly #lookupTimeoutMs: number
  readonly #serviceWorkers: "blocked" | "unsupported"
  readonly #requestInterception: "get_head_only_observable" | "unavailable"

  constructor(options: PracticalTargetAdmissionOptions = {}) {
    this.#lookup = options.lookup ?? defaultLookup
    this.#now = options.now ?? (() => new Date())
    this.#ttlMs = options.admissionTtlMs ?? 300_000
    this.#lookupTimeoutMs = options.lookupTimeoutMs ?? 5_000
    if (this.#lookupTimeoutMs < 100 || this.#lookupTimeoutMs > 30_000) {
      throw new Error("DNS lookup timeout is out of bounds")
    }
    this.#serviceWorkers = options.serviceWorkerControl ?? "blocked"
    this.#requestInterception = options.requestInterception ?? "get_head_only_observable"
  }

  async assess(
    target: PublicEvaluationTargetV2,
    signal: AbortSignal,
  ): Promise<TargetAdmissionResult> {
    if (signal.aborted) return rejected("operation_aborted", "Target admission was aborted")
    const parsed = PublicEvaluationTargetV2Schema.safeParse(target)
    if (!parsed.success) return rejected("invalid_target", "Target failed structural HTTPS validation")

    const hostnames = new Set<string>()
    for (const raw of [parsed.data.startUrl, ...parsed.data.allowedNavigationOrigins]) {
      const url = new URL(raw)
      if (url.port && url.port !== "443") {
        return rejected("unsupported_port", "Only the default HTTPS port is supported")
      }
      const hostname = url.hostname.toLowerCase()
      const hostnameClassification = classifyNetworkHostname(hostname)
      if (hostnameClassification === "ip_literal") {
        return rejected("ip_literal", "IP-literal targets are not admitted")
      }
      if (hostnameClassification !== "public_dns_name") {
        return rejected("private_or_reserved_address", "Special-use hostnames are not public targets")
      }
      hostnames.add(hostname)
    }

    for (const hostname of hostnames) {
      let answers: readonly ResolvedAddress[]
      try {
        answers = await lookupWithDeadline(
          this.#lookup,
          hostname,
          this.#lookupTimeoutMs,
          signal,
        )
      } catch {
        if (signal.aborted) return rejected("operation_aborted", "Target admission was aborted")
        return rejected("target_unreachable", "Public DNS preflight failed")
      }
      if (answers.length === 0) return rejected("target_unreachable", "Public DNS returned no addresses")
      const answerClassifications = answers.map((answer) => classifyResolvedIp(answer.address))
      const publicAnswerCount = answerClassifications.filter((classification) => classification === "public").length
      if (publicAnswerCount === 0) {
        return rejected("private_or_reserved_address", "DNS resolved only to private, reserved, or invalid addresses")
      }
      if (publicAnswerCount !== answers.length) {
        return rejected("mixed_address_set", "DNS returned a mixed public and non-public address set")
      }
    }

    const admittedAt = this.#now()
    return TargetAdmissionResultSchema.parse({
      status: "admitted",
      target: {
        schemaVersion: 1,
        startUrl: parsed.data.startUrl,
        allowedNavigationOrigins: parsed.data.allowedNavigationOrigins,
        admittedAt: admittedAt.toISOString(),
        expiresAt: new Date(admittedAt.getTime() + this.#ttlMs).toISOString(),
        policyVersion: "public-safe-v1",
        enforcement: "practical_best_effort",
        practicalControls: {
          dnsPreflight: "public_answers_only",
          serviceWorkers: this.#serviceWorkers,
          requestInterception: this.#requestInterception,
          limitations: [
            "no_provider_preconnect_ip_enforcement",
            "dns_rebinding_not_fully_prevented",
            "browser_process_traffic_not_fully_observable",
          ],
        },
      },
    })
  }
}
