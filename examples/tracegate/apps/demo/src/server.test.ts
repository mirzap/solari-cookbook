import assert from "node:assert/strict"
import { request } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, test } from "node:test"

import { createConnectivityServer } from "./server.js"

const ADMIN_SECRET = "local-test-secret-not-sensitive"
const server = createConnectivityServer({ adminSecret: ADMIN_SECRET })
let baseUrl = ""

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

async function adminRead(headers: HeadersInit = {}): Promise<Response> {
  return fetch(`${baseUrl}/__connectivity/admin`, {
    headers: {
      authorization: `Bearer ${ADMIN_SECRET}`,
      ...headers,
    },
  })
}

async function navigationShapedAdminStatus(): Promise<number> {
  return new Promise((resolve, reject) => {
    const adminUrl = new URL("/__connectivity/admin", baseUrl)
    const outgoing = request(
      adminUrl,
      {
        headers: {
          authorization: `Bearer ${ADMIN_SECRET}`,
          "sec-fetch-mode": "navigate",
        },
      },
      (response) => {
        response.resume()
        response.once("end", () => resolve(response.statusCode ?? 0))
      },
    )
    outgoing.once("error", reject)
    outgoing.end()
  })
}

test("serves a semantic connectivity form", async () => {
  const response = await fetch(`${baseUrl}/__connectivity`)
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /<form method="post" action="\/__connectivity\/mutate">/)
  assert.match(html, /<button type="submit"/)
  assert.match(html, /role="status"/)
})

test("rejects unauthenticated and browser-shaped admin reads as not found", async () => {
  assert.equal((await fetch(`${baseUrl}/__connectivity/admin`)).status, 404)
  assert.equal(await navigationShapedAdminStatus(), 404)
  assert.equal((await adminRead({ origin: baseUrl })).status, 404)
})

test("POST mutates state and a server-to-server admin read verifies it", async () => {
  const beforeResponse = await adminRead()
  assert.equal(beforeResponse.status, 200)
  const before = (await beforeResponse.json()) as { revision: number }

  const mutation = await fetch(`${baseUrl}/__connectivity/mutate`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "marker=solari-connectivity",
    redirect: "follow",
  })
  assert.equal(mutation.status, 200)
  assert.match(await mutation.text(), /Connectivity mutation accepted/)

  const afterResponse = await adminRead()
  assert.equal(afterResponse.status, 200)
  const after = (await afterResponse.json()) as {
    revision: number
    mutationCount: number
  }
  assert.equal(after.revision, before.revision + 1)
  assert.equal(after.mutationCount >= 1, true)
})
