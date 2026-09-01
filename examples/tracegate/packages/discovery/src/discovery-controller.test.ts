import assert from "node:assert/strict"
import { test } from "node:test"

import {
  AdmittedPublicTargetSchema,
  AgentObservationSchema,
  RunIdSchema,
} from "@tracegate/shared"

import { TraceGateDiscoveryController } from "./discovery-controller.js"

const observation = AgentObservationSchema.parse({
  schemaVersion: 2,
  trust: "untrusted_page_content",
  revision: 2,
  url: "https://jobs.example/search?role=senior",
  title: "Senior engineering jobs",
  visibleText: "Senior Software Engineer $175,000",
  elements: [
    {
      ref: "e:2:0",
      role: "combobox",
      name: "Minimum salary",
      disabled: false,
      checked: null,
      selected: true,
      expanded: null,
      attributes: { name: "salary", value: "150000" },
    },
  ],
  discoverySummary: "1 visible semantic control",
  truncated: false,
})

const admittedTarget = AdmittedPublicTargetSchema.parse({
  schemaVersion: 1,
  startUrl: "https://jobs.example/search",
  allowedNavigationOrigins: ["https://jobs.example"],
  admittedAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-09-01T00:05:00.000Z",
  policyVersion: "public-safe-v1",
  enforcement: "practical_best_effort",
  practicalControls: {
    dnsPreflight: "public_answers_only",
    serviceWorkers: "blocked",
    requestInterception: "get_head_only_observable",
    limitations: [
      "no_provider_preconnect_ip_enforcement",
      "dns_rebinding_not_fully_prevented",
      "browser_process_traffic_not_fully_observable",
    ],
  },
})

test("discovers through the active browser path, not ambient fetch", async () => {
  const requestedPaths: string[] = []
  const controller = new TraceGateDiscoveryController({
    source: {
      async currentPageDiscoverySnapshot() {
        return {
          observationRevision: observation.revision,
          jsonLdTexts: [
            JSON.stringify({ "@type": "JobPosting", baseSalary: { "@type": "MonetaryAmount" } }),
          ],
          webMcpPresent: false,
        }
      },
      async readCurrentOriginText(path) {
        requestedPaths.push(path)
        return {
          status: 200,
          finalUrl: "https://jobs.example/llms.txt",
          text: "# Public job search\nSemantic filters",
          truncated: false,
        }
      },
    },
    now: () => new Date("2026-09-01T00:00:00.000Z"),
  })

  const evidence = await controller.discover(
    {
      runId: RunIdSchema.parse("01890f00-0000-7000-8000-000000000002"),
      observation,
      interfaceMode: "auto",
      admittedTarget,
    },
    new AbortController().signal,
  )
  assert.deepEqual(requestedPaths, ["/llms.txt"])
  assert.equal(evidence.semanticControlCount, 1)
  assert.equal(evidence.llmsTxt.status, "available")
  assert.deepEqual(evidence.jsonLdTypes.sort(), ["JobPosting", "MonetaryAmount"])
  assert.equal(evidence.webMcpGate, "unavailable")
})

test("rejects a source snapshot from a different observation revision", async () => {
  const controller = new TraceGateDiscoveryController({
    source: {
      async currentPageDiscoverySnapshot() {
        return { observationRevision: 3, jsonLdTexts: [], webMcpPresent: false }
      },
      async readCurrentOriginText() {
        return { status: 404, finalUrl: "https://jobs.example/llms.txt", text: "", truncated: false }
      },
    },
  })
  await assert.rejects(
    controller.discover(
      {
        runId: RunIdSchema.parse("01890f00-0000-7000-8000-000000000002"),
        observation,
        interfaceMode: "semantic-only",
        admittedTarget,
      },
      new AbortController().signal,
    ),
    /revision/,
  )
})
