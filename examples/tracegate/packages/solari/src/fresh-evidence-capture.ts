import { createHash } from "node:crypto"

import {
  AssertionCaptureResultSchema,
  CanonicalAssertionObservationSchema,
  UtcDateTimeSchema,
  evaluateCapturedAssertion,
  type AssertionCaptureInput,
  type AssertionCaptureResult,
  type AssertionEvidenceCapture,
  type AssertionSnapshotBrowserController,
  type AssertionV1,
  type BrowserController,
  type CanonicalAssertionObservation,
  type TransientAssertionSnapshotV1,
} from "@tracegate/shared"

import { redactUrlForPersistence } from "./policy.js"

const QUIET_INTERVAL_MS = 750
const MAX_CAPTURE_ATTEMPTS = 3

export interface FreshAssertionEvidenceCaptureOptions {
  readonly sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>
  readonly now?: () => Date
}

function asSource(controller: BrowserController): AssertionSnapshotBrowserController {
  const candidate = controller as BrowserController & Partial<AssertionSnapshotBrowserController>
  if (typeof candidate.captureAssertionSnapshot !== "function") {
    throw new Error("Browser controller does not expose dedicated assertion snapshots")
  }
  return candidate as BrowserController & AssertionSnapshotBrowserController
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function assertionRelevantProjection(
  snapshot: TransientAssertionSnapshotV1,
  assertions: readonly AssertionV1[],
): unknown {
  const captureFinalUrl = assertions.some((assertion) => assertion.kind === "url")
  const captureTitle = assertions.some(
    (assertion) => assertion.kind === "text" && assertion.scope === "title",
  )
  const captureDocumentVisibleText = assertions.some(
    (assertion) => assertion.kind === "text" && assertion.scope === "document_visible_text",
  )
  return {
    finalUrl: captureFinalUrl ? snapshot.finalUrl : null,
    title: captureTitle ? snapshot.title : null,
    documentVisibleText: captureDocumentVisibleText ? snapshot.documentVisibleText : null,
    semanticStateValues: snapshot.semanticStateValues,
  }
}

function canonicalFingerprint(
  snapshot: TransientAssertionSnapshotV1,
  assertions: readonly AssertionV1[],
): string {
  return sha256(JSON.stringify(assertionRelevantProjection(snapshot, assertions)))
}

function unstableAssertions(
  assertions: readonly CanonicalAssertionObservation[],
): CanonicalAssertionObservation[] {
  return assertions.map((assertion) =>
    CanonicalAssertionObservationSchema.parse({
      assertionId: assertion.assertionId,
      status: "unverifiable",
      observedResult: null,
      expectedSummary: assertion.expectedSummary,
      actualSummary: "Assertion-relevant browser state did not stabilize.",
      reasonCode: "page_unstable",
    }),
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
      snapshot: TransientAssertionSnapshotV1
      assertions: CanonicalAssertionObservation[]
      fingerprint: string
      attempts: number
    } | null = null
    let last: {
      snapshot: TransientAssertionSnapshotV1
      assertions: CanonicalAssertionObservation[]
      fingerprint: string
    } | null = null

    for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt += 1) {
      if (attempt > 1) await this.#sleep(QUIET_INTERVAL_MS, signal)
      const snapshot = await source.captureAssertionSnapshot(input, signal)
      const assertions = input.assertions.map((assertion) =>
        evaluateCapturedAssertion(assertion, snapshot),
      )
      const fingerprint = canonicalFingerprint(snapshot, input.assertions)
      last = { snapshot, assertions, fingerprint }
      if (fingerprint === previousFingerprint) {
        accepted = { snapshot, assertions, fingerprint, attempts: attempt }
        break
      }
      previousFingerprint = fingerprint
    }

    if (!last) throw new Error("Fresh assertion capture produced no snapshot")
    const selected = accepted ?? last
    const assertions = accepted ? accepted.assertions : unstableAssertions(last.assertions)
    const capturedAt = UtcDateTimeSchema.parse(this.#now().toISOString())
    const canonicalFinalUrl = selected.snapshot.finalUrl.status === "captured"
      ? selected.snapshot.finalUrl.value
      : null
    return AssertionCaptureResultSchema.parse({
      transient: {
        schemaVersion: 1,
        canonicalFinalUrl,
        documentId: selected.snapshot.documentId,
        loaderId: selected.snapshot.loaderId,
        capturedAt,
        assertionObservations: assertions,
        evidenceHash: selected.fingerprint,
      },
      evidence: {
        schemaVersion: 1,
        capturedAt,
        redactedDisplayUrl: canonicalFinalUrl === null
          ? null
          : redactUrlForPersistence(canonicalFinalUrl),
        documentIdHash: sha256(selected.snapshot.documentId),
        loaderIdHash: sha256(selected.snapshot.loaderId),
        quietIntervalMs: QUIET_INTERVAL_MS,
        requiredIdenticalCaptures: 2,
        captureAttempts: accepted?.attempts ?? MAX_CAPTURE_ATTEMPTS,
        evidenceHash: selected.fingerprint,
        policyActivity: selected.snapshot.policyActivity,
        assertions,
      },
    })
  }
}
