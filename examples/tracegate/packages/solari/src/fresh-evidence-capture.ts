import { createHash } from "node:crypto"

import {
  AssertionCaptureResultSchema,
  CanonicalAssertionObservationSchema,
  UtcDateTimeSchema,
  type AssertionCaptureInput,
  type AssertionCaptureResult,
  type AssertionEvidenceCapture,
  type AssertionV1,
  type BrowserController,
  type CanonicalAssertionObservation,
  type CompactElement,
  type PolicyActivitySummary,
  type UntrustedAgentObservation,
} from "@tracegate/shared"

import {
  type CurrentAssertionSnapshot,
} from "./browser-controller.js"
import { redactUrlForPersistence } from "./policy.js"

const QUIET_INTERVAL_MS = 750
const MAX_CAPTURE_ATTEMPTS = 3

interface AssertionSnapshotSource {
  currentAssertionSnapshot(signal: AbortSignal): Promise<CurrentAssertionSnapshot>
}

export interface FreshAssertionEvidenceCaptureOptions {
  readonly sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>
  readonly now?: () => Date
}

function asSource(controller: BrowserController): AssertionSnapshotSource {
  const candidate = controller as BrowserController & Partial<AssertionSnapshotSource>
  if (typeof candidate.currentAssertionSnapshot !== "function") {
    throw new Error("Browser controller does not expose fresh assertion snapshots")
  }
  return candidate as AssertionSnapshotSource
}

async function defaultSleep(durationMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
      reject(signal.reason)
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, durationMs)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

function comparable(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase("en-US")
}

function nameMatches(
  element: CompactElement,
  matcher: Extract<AssertionV1, { kind: "semantic" | "state" }>["locator"]["accessibleName"],
): boolean {
  const actual = comparable(element.name, matcher.caseSensitive)
  const expected = comparable(matcher.value, matcher.caseSensitive)
  return matcher.operator === "equals" ? actual === expected : actual.includes(expected)
}

function semanticMatches(
  observation: UntrustedAgentObservation,
  assertion: Extract<AssertionV1, { kind: "semantic" | "state" }>,
): CompactElement[] {
  return observation.elements.filter(
    (element) =>
      element.role.toLocaleLowerCase("en-US") ===
        assertion.locator.role.toLocaleLowerCase("en-US") &&
      nameMatches(element, assertion.locator.accessibleName),
  )
}

function unverifiable(
  assertion: AssertionV1,
  reasonCode: CanonicalAssertionObservation["reasonCode"],
  actualSummary: string,
): CanonicalAssertionObservation {
  return CanonicalAssertionObservationSchema.parse({
    assertionId: assertion.id,
    status: "unverifiable",
    observedResult: null,
    expectedSummary: assertion.label ?? `${assertion.kind} assertion`,
    actualSummary,
    reasonCode,
  })
}

function observed(
  assertion: AssertionV1,
  result: boolean,
  actualSummary: string,
): CanonicalAssertionObservation {
  return CanonicalAssertionObservationSchema.parse({
    assertionId: assertion.id,
    status: "observed",
    observedResult: result,
    expectedSummary: assertion.label ?? `${assertion.kind} assertion`,
    actualSummary,
    reasonCode: null,
  })
}

export function evaluateAssertionFromObservation(
  assertion: AssertionV1,
  observation: UntrustedAgentObservation,
): CanonicalAssertionObservation {
  if (assertion.kind === "url") {
    const actual = new URL(observation.url)
    const expected = new URL(assertion.expectedUrl)
    const result =
      assertion.operator === "equals"
        ? actual.href === expected.href
        : actual.origin === expected.origin && actual.pathname === expected.pathname
    return observed(assertion, result, result ? "Final URL matched" : "Final URL did not match")
  }

  if (assertion.kind === "text") {
    if (assertion.scope === "document_visible_text" && observation.truncated) {
      return unverifiable(assertion, "observation_truncated", "Visible document text was truncated")
    }
    const actual = comparable(
      assertion.scope === "title" ? observation.title : observation.visibleText,
      assertion.caseSensitive,
    )
    const expected = comparable(assertion.expected, assertion.caseSensitive)
    const result =
      assertion.operator === "equals"
        ? actual === expected
        : assertion.operator === "contains"
          ? actual.includes(expected)
          : !actual.includes(expected)
    return observed(assertion, result, result ? "Text predicate matched" : "Text predicate did not match")
  }

  if (observation.truncated) {
    return unverifiable(assertion, "observation_truncated", "Semantic element capture was truncated")
  }
  const matches = semanticMatches(observation, assertion)
  if (assertion.kind === "semantic") {
    const result =
      assertion.count.operator === "equals"
        ? matches.length === assertion.count.value
        : assertion.count.operator === "at_least"
          ? matches.length >= assertion.count.value
          : matches.length <= assertion.count.value
    return observed(assertion, result, `Observed ${matches.length} semantic matches`)
  }

  if (matches.length > 1) {
    return unverifiable(assertion, "semantic_match_ambiguous", "More than one semantic element matched")
  }
  if (matches.length === 0) {
    return observed(assertion, false, "No semantic element matched")
  }
  const element = matches[0]!
  const actual =
    assertion.property === "value"
      ? (element.attributes.value ?? null)
      : element[assertion.property]
  if (actual === null) {
    return unverifiable(assertion, "unsupported_state", "Requested element state was unavailable")
  }
  return observed(
    assertion,
    actual === assertion.expected,
    actual === assertion.expected ? "Element state matched" : "Element state did not match",
  )
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function canonicalFingerprint(
  snapshot: CurrentAssertionSnapshot,
  assertions: readonly CanonicalAssertionObservation[],
): string {
  return sha256(
    JSON.stringify({
      documentId: snapshot.documentId,
      loaderId: snapshot.loaderId,
      url: snapshot.observation.url,
      title: snapshot.observation.title,
      visibleText: snapshot.observation.visibleText,
      // Element refs encode the observation revision and therefore change on
      // every capture even when browser-observable state is identical.
      elements: snapshot.observation.elements.map(({ ref: _ref, ...element }) => element),
      truncated: snapshot.observation.truncated,
      policyActivity: snapshot.policyActivity,
      assertions,
    }),
  )
}

function unstableAssertions(
  assertions: readonly AssertionV1[],
): CanonicalAssertionObservation[] {
  return assertions.map((assertion) =>
    unverifiable(assertion, "page_unstable", "Canonical captures did not stabilize"),
  )
}

export class FreshBrowserAssertionEvidenceCapture implements AssertionEvidenceCapture {
  readonly #sleep: (durationMs: number, signal: AbortSignal) => Promise<void>
  readonly #now: () => Date

  constructor(options: FreshAssertionEvidenceCaptureOptions = {}) {
    this.#sleep = options.sleep ?? defaultSleep
    this.#now = options.now ?? (() => new Date())
  }

  async capture(
    controller: BrowserController,
    input: AssertionCaptureInput,
    signal: AbortSignal,
  ): Promise<AssertionCaptureResult> {
    const source = asSource(controller)
    let previousFingerprint: string | null = null
    let accepted: {
      snapshot: CurrentAssertionSnapshot
      assertions: CanonicalAssertionObservation[]
      fingerprint: string
      attempts: number
    } | null = null
    let lastSnapshot: CurrentAssertionSnapshot | null = null

    for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt += 1) {
      if (attempt > 1) await this.#sleep(QUIET_INTERVAL_MS, signal)
      const snapshot = await source.currentAssertionSnapshot(signal)
      const assertions = input.assertions.map((assertion) =>
        evaluateAssertionFromObservation(assertion, snapshot.observation),
      )
      const fingerprint = canonicalFingerprint(snapshot, assertions)
      lastSnapshot = snapshot
      if (fingerprint === previousFingerprint) {
        accepted = { snapshot, assertions, fingerprint, attempts: attempt }
        break
      }
      previousFingerprint = fingerprint
    }

    if (!lastSnapshot) throw new Error("Fresh assertion capture produced no snapshot")
    const assertions = accepted?.assertions ?? unstableAssertions(input.assertions)
    const fingerprint = accepted?.fingerprint ?? canonicalFingerprint(lastSnapshot, assertions)
    const capturedAt = UtcDateTimeSchema.parse(this.#now().toISOString())
    const snapshot = accepted?.snapshot ?? lastSnapshot
    return AssertionCaptureResultSchema.parse({
      transient: {
        schemaVersion: 1,
        canonicalFinalUrl: snapshot.observation.url,
        documentId: snapshot.documentId,
        loaderId: snapshot.loaderId,
        capturedAt,
        assertionObservations: assertions,
        evidenceHash: fingerprint,
      },
      evidence: {
        schemaVersion: 1,
        capturedAt,
        redactedDisplayUrl: redactUrlForPersistence(snapshot.observation.url),
        documentIdHash: sha256(snapshot.documentId),
        loaderIdHash: sha256(snapshot.loaderId),
        quietIntervalMs: QUIET_INTERVAL_MS,
        requiredIdenticalCaptures: 2,
        captureAttempts: accepted?.attempts ?? MAX_CAPTURE_ATTEMPTS,
        evidenceHash: fingerprint,
        policyActivity: snapshot.policyActivity,
        assertions,
      },
    })
  }
}
