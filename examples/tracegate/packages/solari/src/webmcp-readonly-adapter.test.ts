import assert from "node:assert/strict"
import { test } from "node:test"

import {
  PublicHttpsOriginSchema,
  type BrowserController,
} from "@tracegate/shared"

import { SolariWebMcpReadOnlyAdapter } from "./webmcp-readonly-adapter.js"

const currentOrigin = PublicHttpsOriginSchema.parse("https://jobs.example")

function controllerWithTools() {
  let catalog = [
    {
      name: "search_jobs",
      title: "Search jobs",
      description: "Find public job listings by role and minimum salary",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", maxLength: 200 },
          minimumSalary: { type: "integer", minimum: 0, maximum: 1_000_000 },
        },
        required: ["query", "minimumSalary"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    },
    {
      name: "apply_for_job",
      title: "Apply",
      description: "Submit a job application",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "search_remote",
      title: "Search remote host",
      description: "Find public job listings",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
  ]
  const invocations: Array<{ name: string; input: object }> = []
  const controller = {
    currentBrowserOrigin() {
      return "https://jobs.example"
    },
    async currentOriginWebMcpTools() {
      return catalog
    },
    async invokeCurrentOriginWebMcpTool(name: string, input: object) {
      invocations.push({ name, input })
      return JSON.stringify({ jobs: [{ title: "Senior Software Engineer", salary: 175000 }], apiToken: "secret" })
    },
  } as unknown as BrowserController
  return {
    controller,
    invocations,
    replaceCatalog(next: typeof catalog) {
      catalog = next
    },
  }
}

test("admits only bounded current-origin tools that explicitly declare read-only", async () => {
  const fake = controllerWithTools()
  const adapter = new SolariWebMcpReadOnlyAdapter()
  const tools = await adapter.discover(
    fake.controller,
    currentOrigin,
    new AbortController().signal,
  )
  assert.equal(tools.length, 1)
  assert.equal(tools[0]?.name, "search_jobs")
  assert.equal(tools[0]?.trust, "untrusted_page_capability")
  assert.equal(tools[0]?.declaredReadOnly, true)
})

test("revalidates the admitted descriptor and returns bounded redacted untrusted data", async () => {
  const fake = controllerWithTools()
  const adapter = new SolariWebMcpReadOnlyAdapter()
  const [tool] = await adapter.discover(
    fake.controller,
    currentOrigin,
    new AbortController().signal,
  )
  assert.ok(tool)
  const result = await adapter.invoke(
    fake.controller,
    {
      toolId: tool.id,
      currentOrigin,
      input: { query: "senior software engineer", minimumSalary: 150000 },
    },
    new AbortController().signal,
  )
  assert.equal(fake.invocations.length, 1)
  assert.equal(result.trust, "untrusted_page_tool_result")
  assert.equal(result.redacted, true)
  assert.deepEqual(result.output.apiToken, "[REDACTED]")
})

test("rejects an admitted catalog larger than the frozen bound", async () => {
  const controller = {
    currentBrowserOrigin: () => "https://jobs.example",
    async currentOriginWebMcpTools() {
      return Array.from({ length: 11 }, (_, index) => ({
        name: `read_jobs_${index}`,
        title: null,
        description: `Read public jobs group ${index}`,
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      }))
    },
    async invokeCurrentOriginWebMcpTool() { return "{}" },
  } as unknown as BrowserController
  await assert.rejects(
    new SolariWebMcpReadOnlyAdapter().discover(
      controller,
      currentOrigin,
      new AbortController().signal,
    ),
    /exceeds/,
  )
})

test("rejects stale descriptors and inputs outside the admitted closed schema", async () => {
  const fake = controllerWithTools()
  const adapter = new SolariWebMcpReadOnlyAdapter()
  const [tool] = await adapter.discover(
    fake.controller,
    currentOrigin,
    new AbortController().signal,
  )
  assert.ok(tool)

  await assert.rejects(
    adapter.invoke(
      fake.controller,
      {
        toolId: tool.id,
        currentOrigin,
        input: { query: "engineer", minimumSalary: 150000, destination: "https://evil.example" },
      },
      new AbortController().signal,
    ),
    /closed schema/,
  )

  fake.replaceCatalog([])
  await assert.rejects(
    adapter.invoke(
      fake.controller,
      {
        toolId: tool.id,
        currentOrigin,
        input: { query: "engineer", minimumSalary: 150000 },
      },
      new AbortController().signal,
    ),
    /changed/,
  )
})
