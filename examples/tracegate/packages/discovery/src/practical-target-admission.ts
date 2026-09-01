import { lookup as nodeLookup } from "node:dns/promises"
import { isIP } from "node:net"

import {
  PublicEvaluationTargetV2Schema,
  TargetAdmissionResultSchema,
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
  readonly serviceWorkerControl?: "blocked" | "unsupported"
  readonly requestInterception?: "get_head_only_observable" | "unavailable"
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [a, b, c] = octets as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicIpv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0]!
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length)
    if (isIP(mapped) === 4) return isPublicIpv4(mapped)
    const hextets = mapped.split(":")
    if (hextets.length === 2) {
      const high = Number.parseInt(hextets[0]!, 16)
      const low = Number.parseInt(hextets[1]!, 16)
      if (Number.isInteger(high) && Number.isInteger(low)) {
        return isPublicIpv4(
          `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
        )
      }
    }
    return false
  }
  if (value === "::" || value === "::1") return false
  if (/^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith("ff")) return false
  if (value.startsWith("2001:db8:")) return false
  return true
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4
    ? isPublicIpv4(address)
    : family === 6
      ? isPublicIpv6(address)
      : false
}

async function defaultLookup(hostname: string): Promise<readonly ResolvedAddress[]> {
  return nodeLookup(hostname, { all: true, verbatim: true })
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
  readonly #serviceWorkers: "blocked" | "unsupported"
  readonly #requestInterception: "get_head_only_observable" | "unavailable"

  constructor(options: PracticalTargetAdmissionOptions = {}) {
    this.#lookup = options.lookup ?? defaultLookup
    this.#now = options.now ?? (() => new Date())
    this.#ttlMs = options.admissionTtlMs ?? 300_000
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
      if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
        return rejected("private_or_reserved_address", "Local hostnames are not public targets")
      }
      if (isIP(hostname)) return rejected("ip_literal", "IP-literal targets are not admitted")
      hostnames.add(hostname)
    }

    for (const hostname of hostnames) {
      let answers: readonly ResolvedAddress[]
      try {
        answers = await Promise.race([
          this.#lookup(hostname),
          new Promise<never>((_resolve, rejectPromise) => {
            signal.addEventListener(
              "abort",
              () => rejectPromise(new DOMException("Target admission aborted", "AbortError")),
              { once: true },
            )
          }),
        ])
      } catch {
        if (signal.aborted) return rejected("operation_aborted", "Target admission was aborted")
        return rejected("target_unreachable", "Public DNS preflight failed")
      }
      if (answers.length === 0) return rejected("target_unreachable", "Public DNS returned no addresses")
      const publicAnswers = answers.filter((answer) => isPublicNetworkAddress(answer.address))
      if (publicAnswers.length === 0) {
        return rejected("private_or_reserved_address", "DNS resolved only to private or reserved addresses")
      }
      if (publicAnswers.length !== answers.length) {
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
