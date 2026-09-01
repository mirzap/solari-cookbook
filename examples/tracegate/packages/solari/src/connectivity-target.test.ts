import assert from "node:assert/strict"
import { test } from "node:test"

import { createTunnelTargetFromEnv } from "./connectivity-target.js"

test("tunnel target requires an HTTPS public origin", () => {
  assert.throws(
    () =>
      createTunnelTargetFromEnv({
        DEMO_PUBLIC_URL: "http://public.example.test",
        DEMO_ADMIN_URL: "http://127.0.0.1:4317",
        DEMO_ADMIN_SECRET: "not-a-real-secret-value",
      }),
    /HTTPS/,
  )
})

test("tunnel target accepts public HTTPS and loopback admin URLs", async () => {
  const target = createTunnelTargetFromEnv({
    DEMO_PUBLIC_URL: "https://demo.example.test",
    DEMO_ADMIN_URL: "http://127.0.0.1:4317",
    DEMO_ADMIN_SECRET: "not-a-real-secret-value",
  })
  assert.equal(target.provider, "tunnel")
  assert.equal(target.publicBaseUrl.protocol, "https:")
  assert.equal(target.adminBaseUrl.hostname, "127.0.0.1")
  await target.close()
})

test("tunnel target rejects capability-shaped query URLs", () => {
  assert.throws(
    () =>
      createTunnelTargetFromEnv({
        DEMO_PUBLIC_URL: "https://demo.example.test/?token=do-not-store",
        DEMO_ADMIN_URL: "http://127.0.0.1:4317",
        DEMO_ADMIN_SECRET: "not-a-real-secret-value",
      }),
    /query/,
  )
})

test("tunnel target rejects a non-loopback admin origin", () => {
  assert.throws(
    () =>
      createTunnelTargetFromEnv({
        DEMO_PUBLIC_URL: "https://demo.example.test",
        DEMO_ADMIN_URL: "https://admin.example.test",
        DEMO_ADMIN_SECRET: "not-a-real-secret-value",
      }),
    /loopback/,
  )
})
