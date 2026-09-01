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
  readonly lookupTimeoutMs?: number
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

function parseIpv6Words(address: string): readonly number[] | null {
  let value = address.toLowerCase().split("%")[0]!
  if (isIP(value) !== 6) return null

  const ipv4Separator = value.lastIndexOf(":")
  const ipv4Tail = value.slice(ipv4Separator + 1)
  if (ipv4Tail.includes(".")) {
    if (isIP(ipv4Tail) !== 4) return null
    const octets = ipv4Tail.split(".").map(Number)
    value = `${value.slice(0, ipv4Separator)}:${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`
  }

  const halves = value.split("::")
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const explicit = [...left, ...right]
  if (explicit.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const omitted = 8 - explicit.length
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null
  return [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: omitted }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ]
}

function isPublicIpv6(address: string): boolean {
  const words = parseIpv6Words(address)
  if (!words) return false
  const [first, second, third] = words as [number, number, number, ...number[]]

  // Only globally routed unicast space is eligible. All mapped/compatible IPv4,
  // loopback, local, link-local, site-local, multicast, and unspecified forms
  // consequently fail closed before the narrower special-purpose exclusions.
  if (first < 0x2000 || first > 0x3fff) return false
  if (first === 0x2002 || first === 0x3ffe) return false // 6to4 and retired 6bone
  if (first === 0x2001 && second === 0x0000) return false // Teredo
  if (first === 0x2001 && second === 0x0db8) return false // documentation
  if (first === 0x2001 && second === 0x0002 && third === 0x0000) return false // benchmarking
  if (first === 0x2001 && (second & 0xfff0) === 0x0010) return false // ORCHID
  if (first === 0x2001 && (second & 0xfff0) === 0x0020) return false // ORCHIDv2
  if (first === 0x3fff && second <= 0x0fff) return false // documentation 3fff::/20
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
      if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
        return rejected("private_or_reserved_address", "Local hostnames are not public targets")
      }
      if (isIP(hostname)) return rejected("ip_literal", "IP-literal targets are not admitted")
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
