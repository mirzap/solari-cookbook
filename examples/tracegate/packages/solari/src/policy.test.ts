import assert from "node:assert/strict"
import { test } from "node:test"

import { isTraceGateError } from "@tracegate/shared"

import {
  assertAllowedNavigation,
  canonicalAllowedOrigins,
  classifyObservableRequest,
  obviousUnsafeControl,
  redactUrlForPersistence,
} from "./policy.js"

test("allows only exact HTTPS target-origin navigation", () => {
  const origins = canonicalAllowedOrigins(["https://demo.example"])
  assert.equal(
    assertAllowedNavigation(
      "https://demo.example/runs/opaque-token-value-1234567890",
      origins,
    ).origin,
    "https://demo.example",
  )
  for (const url of [
    "https://other.example/",
    "http://demo.example/",
    "file:///tmp/nope",
    "https://user:pass@demo.example/",
  ]) {
    assert.throws(
      () => assertAllowedNavigation(url, origins),
      (error) => isTraceGateError(error) && error.safe.code === "unsafe_action_blocked",
    )
  }
})

test("classifies observable request method, body, protocol, and main-frame origin", () => {
  const origins = canonicalAllowedOrigins(["https://jobs.example"])
  const base = {
    url: "https://jobs.example/search",
    method: "GET",
    hasBody: false,
    mainFrameNavigation: false,
  }
  assert.equal(classifyObservableRequest(base, origins), null)
  assert.equal(classifyObservableRequest({ ...base, method: "POST" }, origins), "non_idempotent_request")
  assert.equal(classifyObservableRequest({ ...base, hasBody: true }, origins), "request_body_forbidden")
  assert.equal(
    classifyObservableRequest({ ...base, url: "file:///tmp/data" }, origins),
    "alternate_protocol_forbidden",
  )
  assert.equal(
    classifyObservableRequest(
      { ...base, url: "https://other.example/", mainFrameNavigation: true },
      origins,
    ),
    "origin_not_admitted",
  )
  // Cross-origin GET subresources remain observable-but-allowed; this is one
  // of the functional PoC's documented whole-browser egress limitations.
  assert.equal(
    classifyObservableRequest({ ...base, url: "https://cdn.example/asset.js" }, origins),
    null,
  )
})

test("blocks obvious auth, financial, submit, upload, and destructive controls", () => {
  const base = {
    tag: "button",
    role: "button",
    disabled: false,
    attributes: {},
  }
  assert.equal(obviousUnsafeControl({ ...base, name: "Sign in" }), "authentication_forbidden")
  assert.equal(obviousUnsafeControl({ ...base, name: "Buy now" }), "financial_action_forbidden")
  assert.equal(obviousUnsafeControl({ ...base, name: "Delete account" }), "destructive_action_forbidden")
  assert.equal(
    obviousUnsafeControl({ ...base, name: "Search", attributes: { type: "submit" } }),
    "submit_activation_forbidden",
  )
  assert.equal(
    obviousUnsafeControl({ ...base, name: "Résumé", attributes: { type: "file" } }),
    "upload_or_download_forbidden",
  )
  assert.equal(obviousUnsafeControl({ ...base, name: "Filter jobs" }), null)
  assert.equal(
    obviousUnsafeControl({
      ...base,
      name: "Search jobs",
      attributes: { type: "submit", formmethod: "get" },
    }),
    null,
  )
})

test("redacts high-entropy path segments, query, and fragment for persistence", () => {
  const redacted = redactUrlForPersistence(
    "https://jobs.example/search/opaque_token_value_1234567890/results?secret=yes#x",
  )
  assert.equal(
    redacted,
    "https://jobs.example/search/redacted/results",
  )
})
