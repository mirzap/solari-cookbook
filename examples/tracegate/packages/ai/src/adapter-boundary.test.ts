import assert from 'node:assert/strict'
import test from 'node:test'
import { chat } from '@tanstack/ai'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { mapTanStackEvent } from './compatibility.js'

interface FakeChatSender {
  send: (...args: unknown[]) => Promise<unknown>
}

interface AdapterInternals {
  orClient: { chat: FakeChatSender }
}

function senderFor(
  adapter: ReturnType<typeof createOpenRouterText<'deepseek/deepseek-v4-flash-0731'>>,
): FakeChatSender {
  return (adapter as unknown as AdapterInternals).orClient.chat
}

function baseChunk(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    choices: [],
    created: 1_788_259_200,
    id: 'synthetic-chunk',
    model: 'deepseek/deepseek-v4-flash-0731',
    object: 'chat.completion.chunk',
    ...overrides,
  }
}

test('pinned OpenRouter adapter forwards AbortController.signal to SDK boundary', async () => {
  const adapter = createOpenRouterText(
    'deepseek/deepseek-v4-flash-0731',
    'sk-or-v1-synthetic-test-only',
  )
  const abortController = new AbortController()
  let receivedSignal: unknown
  senderFor(adapter).send = async (...args: unknown[]) => {
    const requestOptions = args[1]
    receivedSignal =
      requestOptions !== null && typeof requestOptions === 'object'
        ? (requestOptions as Record<string, unknown>).signal
        : undefined
    return (async function* (): AsyncIterable<unknown> {
      yield baseChunk({
        choices: [
          {
            delta: { role: 'assistant', content: 'ok' },
            finishReason: 'stop',
            index: 0,
          },
        ],
      })
      yield baseChunk({
        usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
      })
    })()
  }

  const mapped = []
  for await (const chunk of chat({
    adapter,
    messages: [{ role: 'user', content: 'synthetic boundary probe' }],
    abortController,
    debug: false,
  })) {
    mapped.push(mapTanStackEvent(chunk))
  }

  assert.equal(receivedSignal, abortController.signal)
  assert.ok(mapped.some((event) => event.kind === 'run.started'))
  assert.ok(mapped.some((event) => event.kind === 'run.finished'))
  const finished = mapped.find((event) => event.kind === 'run.finished')
  assert.deepEqual(
    finished?.kind === 'run.finished' ? finished.usage : null,
    { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
  )
})

test('pinned adapter forwards OpenRouter routing preferences to the SDK request', async () => {
  const adapter = createOpenRouterText(
    'deepseek/deepseek-v4-flash-0731',
    'sk-or-v1-synthetic-test-only',
  )
  let receivedRequest: unknown
  senderFor(adapter).send = async (...args: unknown[]) => {
    receivedRequest = args[0]
    return (async function* (): AsyncIterable<unknown> {
      yield baseChunk({
        choices: [
          {
            delta: { role: 'assistant', content: 'ok' },
            finishReason: 'stop',
            index: 0,
          },
        ],
      })
      yield baseChunk({
        usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
      })
    })()
  }

  for await (const _chunk of chat({
    adapter,
    messages: [{ role: 'user', content: 'synthetic routing probe' }],
    modelOptions: {
      provider: {
        allowFallbacks: true,
        dataCollection: 'deny',
        sort: 'throughput',
        only: ['novita'],
      },
      parallelToolCalls: true,
    },
    debug: false,
  })) {
    // Consume the complete synthetic stream.
  }

  assert.ok(receivedRequest && typeof receivedRequest === 'object')
  const chatRequest = (receivedRequest as Record<string, unknown>).chatRequest
  assert.ok(chatRequest && typeof chatRequest === 'object')
  const request = chatRequest as Record<string, unknown>
  assert.deepEqual(request.provider, {
    allowFallbacks: true,
    dataCollection: 'deny',
    sort: 'throughput',
    only: ['novita'],
  })
  assert.equal(request.parallelToolCalls, true)
})

test('pinned adapter maps a synthetic upstream stream error without raw leakage', async () => {
  const adapter = createOpenRouterText(
    'deepseek/deepseek-v4-flash-0731',
    'sk-or-v1-synthetic-test-only',
  )
  senderFor(adapter).send = async () =>
    (async function* (): AsyncIterable<unknown> {
      yield baseChunk({
        error: {
          code: 502,
          message:
            'authorization: Bearer sk-or-v1-synthetic-provider-secret',
          metadata: { providerCode: 'unsafe-raw-code' },
        },
      })
    })()

  const mapped = []
  for await (const chunk of chat({
    adapter,
    messages: [{ role: 'user', content: 'synthetic error probe' }],
    debug: false,
  })) {
    mapped.push(mapTanStackEvent(chunk))
  }

  const error = mapped.find((event) => event.kind === 'run.error')
  assert.equal(error?.kind, 'run.error')
  const serialized = JSON.stringify(error)
  assert.doesNotMatch(serialized, /sk-or-v1|unsafe-raw-code|authorization/u)
  assert.match(serialized, /\[REDACTED\]/u)
})
