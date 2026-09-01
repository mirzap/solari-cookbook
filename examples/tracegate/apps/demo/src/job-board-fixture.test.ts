import assert from "node:assert/strict"
import type { AddressInfo } from "node:net"
import { after, before, test } from "node:test"

import { createConnectivityServer } from "./server.js"

const server = createConnectivityServer({ adminSecret: "fixture-admin-secret-value" })
let baseUrl = ""

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

test("serves deterministic anonymous job filters with semantic fallback", async () => {
  const response = await fetch(
    `${baseUrl}/jobs?query=Senior&minimumSalary=150000`,
  )
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /<form method="get" action="\/jobs">/)
  assert.match(html, /<label for="minimumSalary">Minimum salary<\/label>/)
  assert.match(html, /<option value="150000" selected>\$150,000\+<\/option>/)
  assert.match(html, /Senior Software Engineer/)
  assert.match(html, /Senior Frontend Engineer/)
  assert.match(html, /data-job-id="job-2"[^>]* hidden/)
  assert.doesNotMatch(html, /apply now|submit application/i)
})

test("registers a progressive read-only WebMCP search capability", async () => {
  const html = await (await fetch(`${baseUrl}/jobs`)).text()
  assert.match(html, /document\.modelContext\.registerTool/)
  assert.match(html, /name: 'search_jobs'/)
  assert.match(html, /readOnlyHint: true/)
  assert.match(html, /additionalProperties: false/)
  assert.match(html, /Find public job listings by role keywords and minimum salary/)
})

test("keeps unsafe controls on an explicit adversarial fixture page", async () => {
  const html = await (await fetch(`${baseUrl}/unsafe-controls`)).text()
  assert.match(html, />Sign in</)
  assert.match(html, />Buy now</)
  assert.match(html, />Delete account</)
  assert.match(html, /type="file"/)
  assert.match(html, /method="post"/)
})
