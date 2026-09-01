import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { initialPromptMessages, type AgentToolExecutor } from '@tracegate/agent'
import { TraceGateError, WebMcpToolDescriptorV1Schema, buildAgentExecutionInputV2 } from '@tracegate/shared'
import { ASSERTION_ONLY_CANARY, assertionCanaryConfigFixture, observationFixture } from '@tracegate/shared/testing'
import { TanStackOpenRouterAgentDriver } from './tanstack-agent-driver.js'

type Adapter = ReturnType<typeof createOpenRouterText<'deepseek/deepseek-v4-flash-0731'>>
interface Internals {
  orClient: {
    chat: { send: (...args: unknown[]) => Promise<unknown> }
    generations: { getGeneration: (request: { id: string }) => Promise<unknown> }
  }
}

const genericWebMcpDescriptor = WebMcpToolDescriptorV1Schema.parse({
  schemaVersion: 1,
  id: 'current.records.search',
  name: 'search_public_records',
  description: 'Read filtered public records from the current document.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 20 } },
    required: ['query'],
    additionalProperties: false,
  },
  currentOrigin: 'https://example.com',
  trust: 'untrusted_page_capability',
  declaredReadOnly: true,
})

const baseChunk = (overrides: Record<string, unknown>) => ({
  choices: [], created: 1_788_259_200, id: 'generation-safe-1', model: 'deepseek/deepseek-v4-flash-0731', object: 'chat.completion.chunk', ...overrides,
})

const noTools: AgentToolExecutor = {
  admit() { throw new Error('unexpected tool proposal') },
  execute() { throw new Error('unexpected tool execution') },
  async failAdmitted() {},
}

function driverWith(adapter: Adapter) {
  return new TanStackOpenRouterAgentDriver({
    apiKey: 'sk-or-v1-synthetic-test-only',
    adapterFactory: () => adapter,
    modelOptions: {
      temperature: 0.2,
      topP: 1,
      parallelToolCalls: true,
      provider: { allowFallbacks: true, dataCollection: 'deny', sort: 'throughput', only: ['novita'] },
    },
  })
}

test('DeepSeek driver forwards production routing, normalizes usage, resolves provider, and propagates the signal', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  let request: unknown
  let signal: unknown
  internals.orClient.chat.send = async (...args) => {
    request = args[0]
    signal = (args[1] as { signal?: unknown } | undefined)?.signal
    return (async function* () {
      yield baseChunk({ choices: [{ delta: { role: 'assistant', content: 'continue safely' }, finishReason: 'stop', index: 0 }] })
      yield baseChunk({ usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 } })
    })()
  }
  internals.orClient.generations.getGeneration = async () => ({ data: { providerName: 'Novita', model: 'deepseek/deepseek-v4-flash-0731' } })
  const controller = new AbortController()
  const result = await driverWith(adapter).runTurn({ messages: [{ role: 'system', content: 'trusted' }, { role: 'user', content: 'UNTRUSTED_BROWSER_OBSERVATION' }], toolSurface: { observationRevision: 1, tools: [], webMcpTools: [] }, executor: noTools, signal: controller.signal })
  assert.ok(signal instanceof AbortSignal)
  assert.equal(signal.aborted, false)
  assert.equal(result.resolvedProvider, 'Novita')
  assert.deepEqual(result.usage, { promptTokens: 7, completionTokens: 2, totalTokens: 9 })
  assert.match(result.assistantSummary, /continue safely/u)
  const chatRequest = (request as { chatRequest?: Record<string, unknown> }).chatRequest
  assert.deepEqual(chatRequest?.provider, { allowFallbacks: true, dataCollection: 'deny', sort: 'throughput', only: ['novita'] })
  assert.equal(chatRequest?.parallelToolCalls, true)
})

test('assertion canary never reaches the OpenRouter request boundary', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  let request: unknown
  internals.orClient.chat.send = async (...args) => {
    request = args[0]
    return (async function* () {
      yield baseChunk({ choices: [{ delta: { role: 'assistant', content: 'inspect safely' }, finishReason: 'stop', index: 0 }] })
      yield baseChunk({ usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 } })
    })()
  }
  internals.orClient.generations.getGeneration = async () => ({ data: { providerName: 'Novita' } })
  const execution = buildAgentExecutionInputV2(assertionCanaryConfigFixture, observationFixture, ['inspect', 'finish'])
  await driverWith(adapter).runTurn({ messages: initialPromptMessages(execution), toolSurface: { observationRevision: 1, tools: ['inspect', 'finish'], webMcpTools: [] }, executor: noTools, signal: new AbortController().signal })
  const serialized = JSON.stringify(request)
  assert.match(serialized, /UNTRUSTED_USER_TASK|UNTRUSTED_BROWSER_OBSERVATION/u)
  assert.doesNotMatch(serialized, new RegExp(ASSERTION_ONLY_CANARY, 'u'))
})

test('dynamic tool request exposes only the admitted sanitized WebMCP catalog and no assertion canary', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  let request: unknown
  internals.orClient.chat.send = async (...args) => {
    request = args[0]
    return (async function* () {
      yield baseChunk({ choices: [{ delta: { role: 'assistant', content: 'inspect results' }, finishReason: 'stop', index: 0 }] })
      yield baseChunk({ usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 } })
    })()
  }
  internals.orClient.generations.getGeneration = async () => ({ data: { providerName: 'Novita' } })
  await driverWith(adapter).runTurn({
    messages: [{ role: 'system', content: 'trusted assertion-free policy' }, { role: 'user', content: 'find public records' }],
    toolSurface: { observationRevision: 1, tools: ['invokeWebMcpReadOnly', 'finish'], webMcpTools: [genericWebMcpDescriptor] },
    executor: noTools,
    signal: new AbortController().signal,
  })
  const serialized = JSON.stringify(request)
  assert.match(serialized, /invokeWebMcpReadOnly/u)
  assert.match(serialized, new RegExp(genericWebMcpDescriptor.id, 'u'))
  assert.match(serialized, /untrusted_page_capability/u)
  assert.doesNotMatch(serialized, new RegExp(ASSERTION_ONLY_CANARY, 'u'))
})

test('DeepSeek driver propagates cancellation to the pinned adapter request', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  let received: AbortSignal | null = null
  internals.orClient.chat.send = async (...args) => {
    received = (args[1] as { signal: AbortSignal }).signal
    return (async function* () {
      await new Promise<void>((_resolve, reject) => received!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      yield baseChunk({})
    })()
  }
  const controller = new AbortController()
  const pending = driverWith(adapter).runTurn({ messages: [{ role: 'user', content: 'safe' }], toolSurface: { observationRevision: 1, tools: [], webMcpTools: [] }, executor: noTools, signal: controller.signal })
  await new Promise((resolve) => setTimeout(resolve, 5))
  controller.abort('cancel')
  await assert.rejects(pending, (error: unknown) => error instanceof TraceGateError && error.safe.code === 'operation_aborted')
  assert.equal(received?.aborted, true)
})

test('synthetic TanStack tool lifecycle admits and completes one strict tool exchange', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  internals.orClient.chat.send = async () => (async function* () {
    yield baseChunk({ choices: [{ delta: { role: 'assistant', toolCalls: [{ index: 0, id: 'call-inspect-1', type: 'function', function: { name: 'inspect', arguments: '{}' } }] }, finishReason: 'tool_calls', index: 0 }] })
    yield baseChunk({ usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 } })
  })()
  internals.orClient.generations.getGeneration = async () => ({ data: { providerName: 'Novita' } })
  const admitted: string[] = []
  const executed: string[] = []
  const executor: AgentToolExecutor = {
    admit(id, name, rawArguments) {
      admitted.push(`${id}:${name}:${rawArguments}`)
      return { normalizedId: 'tool-1', ordinal: 1 } as never
    },
    async execute(id) {
      executed.push(id)
      return JSON.stringify({ schemaVersion: 2, trust: 'untrusted_page_or_tool_content', kind: 'safe_tool_result', result: { summary: 'inspected' } })
    },
    async failAdmitted() {},
  }
  const result = await driverWith(adapter).runTurn({
    messages: [{ role: 'system', content: 'trusted' }, { role: 'user', content: 'inspect current public page' }],
    toolSurface: { observationRevision: 1, tools: ['inspect'], webMcpTools: [] },
    executor,
    signal: new AbortController().signal,
  })
  assert.deepEqual(admitted, ['call-inspect-1:inspect:{}'])
  assert.deepEqual(executed, ['call-inspect-1'])
  assert.equal(result.messages.filter((message) => message.role === 'tool').length, 1)
  assert.deepEqual(result.usage, { promptTokens: 8, completionTokens: 2, totalTokens: 10 })
})

test('WebMCP tool schema rejects prototype-key input before executor dispatch', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  internals.orClient.chat.send = async () => (async function* () {
    yield baseChunk({ choices: [{ delta: { role: 'assistant', toolCalls: [{ index: 0, id: 'call-webmcp-1', type: 'function', function: { name: 'invokeWebMcpReadOnly', arguments: `{"toolId":"${genericWebMcpDescriptor.id}","input":{"query":"public notice","constructor":1}}` } }] }, finishReason: 'tool_calls', index: 0 }] })
    yield baseChunk({ usage: { promptTokens: 9, completionTokens: 3, totalTokens: 12 } })
  })()
  internals.orClient.generations.getGeneration = async () => ({ data: { providerName: 'Novita' } })
  let admitted = 0
  let executed = 0
  let failed = 0
  const executor: AgentToolExecutor = {
    admit() { admitted += 1; return { normalizedId: 'tool-1', ordinal: 1 } as never },
    async execute() { executed += 1; return 'unexpected' },
    async failAdmitted() { failed += 1 },
  }
  await driverWith(adapter).runTurn({ messages: [{ role: 'user', content: 'read public records' }], toolSurface: { observationRevision: 1, tools: ['invokeWebMcpReadOnly'], webMcpTools: [genericWebMcpDescriptor] }, executor, signal: new AbortController().signal })
  assert.equal(admitted, 1)
  assert.equal(executed, 0)
  assert.equal(failed, 1)
})

test('driver fails closed on malformed lifecycle identifiers without raw leakage', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  internals.orClient.chat.send = async () => (async function* () {
    yield baseChunk({ choices: [{ delta: { role: 'assistant', toolCalls: [{ index: 0, id: 'bad id Bearer sk-or-malformed-stream-secret-123456', type: 'function', function: { name: 'inspect', arguments: '{}' } }] }, finishReason: 'tool_calls', index: 0 }] })
    yield baseChunk({ usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 } })
  })()
  await assert.rejects(
    driverWith(adapter).runTurn({ messages: [{ role: 'user', content: 'safe' }], toolSurface: { observationRevision: 1, tools: ['inspect'], webMcpTools: [] }, executor: noTools, signal: new AbortController().signal }),
    (error: unknown) => {
      assert.ok(error instanceof TraceGateError)
      assert.equal(error.safe.code, 'provider_protocol_error')
      assert.doesNotMatch(JSON.stringify(error.safe), /malformed-stream-secret|Bearer|bad id/u)
      return true
    },
  )
})

test('driver rejects absent usage rather than inventing zero tokens', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  internals.orClient.chat.send = async () => (async function* () {
    yield baseChunk({ choices: [{ delta: { role: 'assistant', content: 'bounded response' }, finishReason: 'stop', index: 0 }] })
  })()
  await assert.rejects(
    driverWith(adapter).runTurn({ messages: [{ role: 'user', content: 'safe' }], toolSurface: { observationRevision: 1, tools: [], webMcpTools: [] }, executor: noTools, signal: new AbortController().signal }),
    (error: unknown) => error instanceof TraceGateError && error.safe.code === 'provider_protocol_error' && /usage/u.test(error.safe.message),
  )
})

test('semantic-only fallback omits the WebMCP tool and catalog from the provider request', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  let request: unknown
  internals.orClient.chat.send = async (...args) => {
    request = args[0]
    return (async function* () {
      yield baseChunk({ choices: [{ delta: { role: 'assistant', content: 'inspect semantically' }, finishReason: 'stop', index: 0 }] })
      yield baseChunk({ usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 } })
    })()
  }
  internals.orClient.generations.getGeneration = async () => ({ data: { providerName: 'Novita' } })
  await driverWith(adapter).runTurn({ messages: [{ role: 'user', content: 'safe' }], toolSurface: { observationRevision: 1, tools: ['inspect', 'finish'], webMcpTools: [] }, executor: noTools, signal: new AbortController().signal })
  const serialized = JSON.stringify(request)
  assert.match(serialized, /inspect/u)
  assert.doesNotMatch(serialized, /invokeWebMcpReadOnly|current\.records\.search/u)
})

test('DeepSeek driver maps provider failure to a bounded redacted protocol error', async () => {
  const adapter = createOpenRouterText('deepseek/deepseek-v4-flash-0731', 'sk-or-v1-synthetic-test-only')
  const internals = adapter as unknown as Internals
  internals.orClient.chat.send = async () => (async function* () {
    yield baseChunk({ error: { code: 502, message: 'authorization: Bearer sk-or-v1-runtime-secret-123456', metadata: { unsafe: 'raw-provider-payload' } } })
  })()
  await assert.rejects(
    driverWith(adapter).runTurn({ messages: [{ role: 'user', content: 'safe' }], toolSurface: { observationRevision: 1, tools: [], webMcpTools: [] }, executor: noTools, signal: new AbortController().signal }),
    (error: unknown) => {
      assert.ok(error instanceof TraceGateError)
      assert.equal(error.safe.code, 'provider_protocol_error')
      const safe = JSON.stringify(error.safe)
      assert.match(safe, /\[REDACTED\]/u)
      assert.doesNotMatch(safe, /runtime-secret|raw-provider-payload|authorization/u)
      return true
    },
  )
})
