import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, test } from "node:test"

import { handleJobBoardFixture } from "./job-board-fixture.js"

const server = createServer((request, response) => {
  if (!handleJobBoardFixture(request, response)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
    response.end("not found")
  }
})
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
  const response = await fetch(`${baseUrl}/jobs?query=Senior&minimumSalary=150000`)
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /<form method="get" action="\/jobs">/)
  assert.match(html, /<label for="minimumSalary">Minimum salary<\/label>/)
  assert.match(html, /<option value="150000" selected>\$150,000\+<\/option>/)
  assert.match(html, /Senior Software Engineer/)
  assert.match(html, /Senior Frontend Engineer/)
  assert.match(html, /data-job-id="job-2"[^>]* hidden/)
  assert.doesNotMatch(html, /apply now|submit application|sign in|checkout|send message/i)
})

test("serves bounded read-only fixture metadata", async () => {
  const response = await fetch(`${baseUrl}/llms.txt`)
  const text = await response.text()
  assert.equal(response.status, 200)
  assert.match(text, /Anonymous public engineering job search/)
  assert.ok(Buffer.byteLength(text, "utf8") < 4_096)

  const head = await fetch(`${baseUrl}/jobs`, { method: "HEAD" })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
})

test("registers a capability-gated read-only WebMCP search descriptor", async () => {
  const html = await (await fetch(`${baseUrl}/jobs`)).text()
  assert.match(html, /document\.modelContext\.registerTool/)
  assert.match(html, /name: 'search_jobs'/)
  assert.match(html, /readOnlyHint: true/)
  assert.match(html, /additionalProperties: false/)
  assert.match(html, /Find public job listings by role keywords and minimum salary/)
  assert.doesNotMatch(html, /password|credential|destination|endpoint/i)
})

test("keeps unsafe controls isolated on an explicit adversarial fixture page", async () => {
  const jobs = await (await fetch(`${baseUrl}/jobs`)).text()
  assert.doesNotMatch(jobs, />Sign in<|>Buy now<|>Delete account<|type="file"|method="post"/)

  const html = await (await fetch(`${baseUrl}/unsafe-controls`)).text()
  assert.match(html, />Sign in</)
  assert.match(html, />Buy now</)
  assert.match(html, />Delete account</)
  assert.match(html, /type="file"/)
  assert.match(html, /method="post"/)
})

test("rejects mutation methods and unknown fixture routes", async () => {
  const mutation = await fetch(`${baseUrl}/jobs`, { method: "POST" })
  assert.equal(mutation.status, 404)
  const unknown = await fetch(`${baseUrl}/admin`)
  assert.equal(unknown.status, 404)
})
