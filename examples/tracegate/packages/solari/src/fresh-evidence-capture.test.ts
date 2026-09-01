import assert from "node:assert/strict"
import { test } from "node:test"

import {
  AssertionSetV1Schema,
  UntrustedAgentObservationSchema,
  type BrowserController,
} from "@tracegate/shared"

import { FreshBrowserAssertionEvidenceCapture } from "./fresh-evidence-capture.js"

const assertions = AssertionSetV1Schema.parse([
  {
    schemaVersion: 1,
    id: "url",
    kind: "url",
    operator: "origin_and_path_equals",
    expectedUrl: "https://jobs.example/search",
  },
  {
    schemaVersion: 1,
    id: "text",
    kind: "text",
    scope: "document_visible_text",
    operator: "contains",
    expected: "Senior Software Engineer",
    caseSensitive: false,
  },
  {
    schemaVersion: 1,
    id: "semantic",
    kind: "semantic",
    locator: {
      role: "combobox",
      accessibleName: { operator: "equals", value: "Minimum salary", caseSensitive: false },
    },
    count: { operator: "equals", value: 1 },
  },
  {
    schemaVersion: 1,
    id: "state",
    kind: "state",
    locator: {
      role: "combobox",
      accessibleName: { operator: "equals", value: "Minimum salary", caseSensitive: false },
    },
    property: "value",
    expected: "150000",
  },
])

function observation(title = "Senior jobs") {
  return UntrustedAgentObservationSchema.parse({
    schemaVersion: 2,
    trust: "untrusted_page_content",
    revision: 5,
    url: "https://jobs.example/search?query=engineer&tracking=opaque",
    title,
    visibleText: "Senior Software Engineer $175,000",
    elements: [
      {
        ref: "e:5:0",
        role: "combobox",
        name: "Minimum salary",
        disabled: false,
        checked: null,
        selected: true,
        expanded: null,
        attributes: { value: "150000" },
      },
    ],
    discoverySummary: "1 visible semantic element",
    truncated: false,
  })
}

function controllerWithTitles(titles: readonly string[]): BrowserController {
  let index = 0
  return {
    async currentAssertionSnapshot() {
      const title = titles[Math.min(index, titles.length - 1)]!
      index += 1
      const revision = index + 4
      const current = observation(title)
      return {
        documentId: "document-1",
        loaderId: "loader-1",
        observation: UntrustedAgentObservationSchema.parse({
          ...current,
          revision,
          elements: current.elements.map((element, elementIndex) => ({
            ...element,
            ref: `e:${revision}:${elementIndex}`,
          })),
        }),
        policyActivity: { passiveWarningCount: 0, agentBlockedCount: 0, codes: [] },
      }
    },
  } as unknown as BrowserController
}

test("accepts two identical fresh canonical captures and keeps raw URL transient", async () => {
  const capture = new FreshBrowserAssertionEvidenceCapture({
    sleep: async () => {},
    now: () => new Date("2026-09-01T00:00:00.000Z"),
  })
  const result = await capture.capture(
    controllerWithTitles(["Senior jobs", "Senior jobs"]),
    { assertions },
    new AbortController().signal,
  )
  assert.equal(result.evidence.captureAttempts, 2)
  assert.equal(result.transient.canonicalFinalUrl, "https://jobs.example/search?query=engineer&tracking=opaque")
  assert.equal(result.evidence.redactedDisplayUrl, "https://jobs.example/search")
  assert.deepEqual(
    result.evidence.assertions.map((assertion) => assertion.observedResult),
    [true, true, true, true],
  )
})

test("marks every assertion unverifiable when bounded captures do not stabilize", async () => {
  const capture = new FreshBrowserAssertionEvidenceCapture({ sleep: async () => {} })
  const result = await capture.capture(
    controllerWithTitles(["first", "second", "third"]),
    { assertions },
    new AbortController().signal,
  )
  assert.equal(result.evidence.captureAttempts, 3)
  assert.equal(
    result.evidence.assertions.every(
      (assertion) => assertion.status === "unverifiable" && assertion.reasonCode === "page_unstable",
    ),
    true,
  )
})

test("cancellation interrupts the bounded quiet interval", async () => {
  const capture = new FreshBrowserAssertionEvidenceCapture()
  const controller = new AbortController()
  const pending = capture.capture(
    controllerWithTitles(["Senior jobs", "Senior jobs"]),
    { assertions },
    controller.signal,
  )
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(pending, (error) => error instanceof DOMException && error.name === "AbortError")
})
