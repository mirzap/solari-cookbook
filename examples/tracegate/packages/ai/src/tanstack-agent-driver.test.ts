import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import type { AgentToolExecutor } from '@tracegate/agent'
import { TraceGateError } from '@tracegate/shared'
import { ASSERTION_ONLY_CANARY, webMcpToolDescriptorFixture } from '@tracegate/shared/testing'
import { TanStackOpenRouterAgentDriver } from './tanstack-agent-driver.js'

type Adapter = ReturnType<typeof createOpenRouterText<'deepseek/deepseek-v4-flash-0731'>>
interface Internals {
  orClient: {
    chat: { send: (...args: unknown[]) => Promise<unknown> }
    generations: { getGeneration: (request: { id: string }) => Promise<unknown> }
  }
}

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
    messages: [{ role: 'system', content: 'trusted assertion-free policy' }, { role: 'user', content: 'find public jobs' }],
    toolSurface: { observationRevision: 1, tools: ['invokeWebMcpReadOnly', 'finish'], webMcpTools: [webMcpToolDescriptorFixture] },
    executor: noTools,
    signal: new AbortController().signal,
  })
  const serialized = JSON.stringify(request)
  assert.match(serialized, /invokeWebMcpReadOnly/u)
  assert.match(serialized, new RegExp(webMcpToolDescriptorFixture.id, 'u'))
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
  await assert.rejects(pending, (error: unknown) => error instanceof TraceGateError && error.safe.code === 'provider_protocol_error')
  assert.equal(received?.aborted, true)
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
