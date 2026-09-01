import assert from "node:assert/strict"
import { test } from "node:test"

import { PublicEvaluationTargetV2Schema } from "@tracegate/shared"

import {
  PracticalTargetAdmission,
  isPublicNetworkAddress,
} from "./practical-target-admission.js"

const target = PublicEvaluationTargetV2Schema.parse({
  kind: "public-web",
  startUrl: "https://jobs.example/search",
  allowedNavigationOrigins: ["https://jobs.example"],
})

test("admits structurally safe HTTPS targets after public DNS preflight", async () => {
  const admission = new PracticalTargetAdmission({
    lookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ],
    now: () => new Date("2026-09-01T00:00:00.000Z"),
  })
  const result = await admission.assess(target, new AbortController().signal)
  assert.equal(result.status, "admitted")
  if (result.status === "admitted") {
    assert.equal(result.target.enforcement, "practical_best_effort")
    assert.equal(result.target.practicalControls?.dnsPreflight, "public_answers_only")
    assert.deepEqual(result.target.practicalControls?.limitations, [
      "no_provider_preconnect_ip_enforcement",
      "dns_rebinding_not_fully_prevented",
      "browser_process_traffic_not_fully_observable",
    ])
  }
})

test("rejects private-only and mixed DNS answer sets", async () => {
  const privateOnly = new PracticalTargetAdmission({
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
  })
  const privateResult = await privateOnly.assess(target, new AbortController().signal)
  assert.deepEqual(
    privateResult.status === "rejected" && privateResult.reason,
    "private_or_reserved_address",
  )

  const mixed = new PracticalTargetAdmission({
    lookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
  })
  const mixedResult = await mixed.assess(target, new AbortController().signal)
  assert.deepEqual(
    mixedResult.status === "rejected" && mixedResult.reason,
    "mixed_address_set",
  )
})

test("bounds DNS lookup time and reports target unreachable", async () => {
  const admission = new PracticalTargetAdmission({
    lookupTimeoutMs: 100,
    lookup: async () => new Promise(() => {}),
  })
  const result = await admission.assess(target, new AbortController().signal)
  assert.equal(result.status, "rejected")
  assert.equal(result.status === "rejected" && result.reason, "target_unreachable")
})

test("aborts a later admitted-origin lookup without accepting partial DNS evidence", async () => {
  const multiOriginTarget = PublicEvaluationTargetV2Schema.parse({
    kind: "public-web",
    startUrl: "https://jobs.example/search",
    allowedNavigationOrigins: ["https://jobs.example", "https://assets.example"],
  })
  const controller = new AbortController()
  let calls = 0
  const admission = new PracticalTargetAdmission({
    lookup: async () => {
      calls += 1
      if (calls === 1) return [{ address: "93.184.216.34", family: 4 }]
      return new Promise(() => {})
    },
  })
  const pending = admission.assess(multiOriginTarget, controller.signal)
  setTimeout(() => controller.abort(), 10)
  const result = await pending
  assert.equal(calls, 2)
  assert.equal(result.status === "rejected" && result.reason, "operation_aborted")
})

test("public-address classifier rejects obvious private, local, and documentation ranges", () => {
  for (const address of [
    "10.0.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.10",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "2001:db8::1",
    "2001:0::1",
    "2002:5db8:d822::1",
    "3fff::1",
    "::ffff:c0a8:1",
    "0:0:0:0:0:ffff:7f00:1",
  ]) {
    assert.equal(isPublicNetworkAddress(address), false, address)
  }
  assert.equal(isPublicNetworkAddress("93.184.216.34"), true)
  assert.equal(isPublicNetworkAddress("2606:2800:220:1:248:1893:25c8:1946"), true)
})
