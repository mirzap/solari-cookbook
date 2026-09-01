import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPATIBILITY_CAPABILITIES,
  StrictProbeResultSchema,
  analyzeEventSequence,
  blockedCompatibilityReport,
  emptyCapabilities,
  isOpenRouterAccountActionRequired,
  isP0Eligible,
  mapTanStackEvent,
  normalizeUsage,
  safeDiagnostic,
} from './compatibility.js'
import {
  COMPATIBILITY_MODELS,
  TRACEGATE_MODEL_IDS,
  isExpectedResolvedModel,
  isTraceGateModelId,
} from './models.js'

test('registry contains only the three exact planned model slugs', () => {
  assert.deepEqual(TRACEGATE_MODEL_IDS, [
    'deepseek/deepseek-v4-flash-0731',
    'mistralai/mistral-small-2603',
    'openai/gpt-5-mini',
  ])
  assert.equal(COMPATIBILITY_MODELS.length, 3)
  assert.equal(COMPATIBILITY_MODELS.filter((model) => model.p0Preferred).length, 1)
  assert.equal(COMPATIBILITY_MODELS[0]?.id, 'deepseek/deepseek-v4-flash-0731')
  assert.equal(isTraceGateModelId('openai/gpt-5-mini'), true)
  assert.equal(isTraceGateModelId('openai/gpt-4o-mini'), false)
  assert.equal(
    isExpectedResolvedModel(
      'deepseek/deepseek-v4-flash-0731',
      'deepseek/deepseek-v4-flash-20260731',
    ),
    true,
  )
  assert.equal(
    isExpectedResolvedModel(
      'deepseek/deepseek-v4-flash-0731',
      'deepseek/deepseek-v3',
    ),
    false,
  )
})

test('credential gate blocks every live capability without fabricating a pass', () => {
  const report = blockedCompatibilityReport(
    new Date('2026-09-01T12:00:00.000Z'),
  )
  assert.equal(report.configured, false)
  assert.deepEqual(report.p0PassingModels, [])
  assert.match(report.blocker ?? '', /OPENROUTER_API_KEY/u)
  assert.equal(report.models.length, 3)
  for (const model of report.models) {
    assert.equal(model.p0Eligible, false)
    assert.equal(model.usage, null)
    assert.equal(model.resolvedProvider, null)
    for (const capability of COMPATIBILITY_CAPABILITIES) {
      assert.equal(model.capabilities[capability].status, 'blocked')
    }
  }
})

test('strict structured result rejects additions, coercions, and wrong literals', () => {
  assert.equal(
    StrictProbeResultSchema.safeParse({
      verdict: 'probe_complete',
      inspectedSlots: ['A', 'B'],
      recoveredFromToolError: true,
    }).success,
    true,
  )
  assert.equal(
    StrictProbeResultSchema.safeParse({
      verdict: 'probe_complete',
      inspectedSlots: ['A', 'B'],
      recoveredFromToolError: true,
      extra: 'not allowed',
    }).success,
    false,
  )
  assert.equal(
    StrictProbeResultSchema.safeParse({
      verdict: 'complete',
      inspectedSlots: ['B', 'A'],
      recoveredFromToolError: 'true',
    }).success,
    false,
  )
})

test('stream mapper recognizes complete multiple/parallel tool proposal lifecycle', () => {
  const rawEvents: unknown[] = [
    { type: 'RUN_STARTED', runId: 'run-1', threadId: 'thread-1', model: 'm' },
    {
      type: 'TOOL_CALL_START',
      toolCallId: 'call-a',
      toolCallName: 'inspect_fixture',
    },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'call-a', delta: '{"slot":"A"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'call-a' },
    {
      type: 'TOOL_CALL_START',
      toolCallId: 'call-b',
      toolCallName: 'inspect_fixture',
    },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'call-b', delta: '{"slot":"B"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'call-b' },
    {
      type: 'TOOL_CALL_RESULT',
      toolCallId: 'call-a',
      role: 'tool',
      content: '{"slot":"A","revision":7}',
    },
    {
      type: 'TOOL_CALL_RESULT',
      toolCallId: 'call-b',
      role: 'tool',
      content: '{"slot":"B","revision":7}',
    },
    {
      type: 'RUN_FINISHED',
      runId: 'run-1',
      threadId: 'thread-1',
      model: 'm',
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    },
  ]
  const mapped = rawEvents.map(mapTanStackEvent)
  const analysis = analyzeEventSequence(mapped)
  assert.equal(analysis.completeToolLifecycle, true)
  assert.equal(analysis.startsBeforeFirstResult, 2)
  assert.equal(analysis.protocolErrorCount, 0)
  assert.deepEqual(mapped.at(-1), {
    kind: 'run.finished',
    model: 'm',
    usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
  })
})

test('one outer start with multiple clean turn finishes is normal agent-loop termination', () => {
  const analysis = analyzeEventSequence([
    mapTanStackEvent({
      type: 'RUN_STARTED',
      runId: 'run-1',
      threadId: 'thread-1',
    }),
    mapTanStackEvent({ type: 'RUN_FINISHED' }),
    mapTanStackEvent({ type: 'RUN_FINISHED' }),
    mapTanStackEvent({ type: 'RUN_FINISHED' }),
  ])
  assert.equal(analysis.runStartedCount, 1)
  assert.equal(analysis.runFinishedCount, 3)
  assert.equal(analysis.normalRunTermination, true)
})

test('out-of-order and duplicate tool events cannot satisfy lifecycle gates', () => {
  const mapped = [
    mapTanStackEvent({
      type: 'RUN_STARTED',
      runId: 'run-1',
      threadId: 'thread-1',
      model: 'deepseek/model',
    }),
    mapTanStackEvent({ type: 'TOOL_CALL_END', toolCallId: 'call-a' }),
    mapTanStackEvent({
      type: 'TOOL_CALL_START',
      toolCallId: 'call-a',
      toolCallName: 'inspect_fixture',
    }),
    mapTanStackEvent({
      type: 'TOOL_CALL_START',
      toolCallId: 'call-a',
      toolCallName: 'inspect_fixture',
    }),
    mapTanStackEvent({
      type: 'TOOL_CALL_RESULT',
      toolCallId: 'call-a',
      role: 'tool',
    }),
    mapTanStackEvent({ type: 'RUN_ERROR', code: 'bad', message: 'failed' }),
  ]
  const analysis = analyzeEventSequence(mapped)
  assert.equal(analysis.completeToolLifecycle, false)
  assert.equal(analysis.startsBeforeFirstResult, 1)
  assert.ok(analysis.orderingErrorCount >= 2)
  assert.equal(analysis.runErrorCount, 1)
  assert.equal(analysis.normalRunTermination, false)
})

test('malformed and unknown events fail closed without retaining raw data', () => {
  const malformed = mapTanStackEvent({
    type: 'TOOL_CALL_START',
    rawEvent: { authorization: 'Bearer sk-or-v1-do-not-keep' },
  })
  const unknown = mapTanStackEvent({
    type: 'FUTURE_PROVIDER_EVENT',
    unsafe: 'sk-or-v1-do-not-keep',
  })
  const scalar = mapTanStackEvent('not-an-event')
  assert.deepEqual(malformed, {
    kind: 'protocol.error',
    code: 'malformed_event',
    message: 'TOOL_CALL_START is missing call identity',
  })
  assert.equal(unknown.kind, 'protocol.error')
  assert.equal(scalar.kind, 'protocol.error')
  const serialized = JSON.stringify([malformed, unknown, scalar])
  assert.doesNotMatch(serialized, /sk-or-v1/u)
  assert.doesNotMatch(serialized, /authorization/u)

  const unsafeModel = mapTanStackEvent({
    type: 'RUN_STARTED',
    runId: 'run-2',
    threadId: 'thread-2',
    model: 'sk-or-v1-provider-secret',
  })
  assert.deepEqual(unsafeModel, { kind: 'run.started', model: null })
  const unsafeCode = mapTanStackEvent({
    type: 'RUN_ERROR',
    code: `sk-or-v1-${'x'.repeat(200)}`,
    message: 'bounded',
  })
  assert.equal(
    unsafeCode.kind === 'run.error' ? unsafeCode.code : null,
    'provider_protocol_error',
  )
  const unsafeTool = mapTanStackEvent({
    type: 'TOOL_CALL_START',
    toolCallId: `call-${'x'.repeat(200)}`,
    toolCallName: 'inspect_fixture',
  })
  assert.equal(unsafeTool.kind, 'protocol.error')
  assert.doesNotMatch(
    JSON.stringify([unsafeModel, unsafeCode, unsafeTool]),
    /sk-or-v1-provider-secret/u,
  )
})

test('provider errors are bounded and redact secret-shaped values', () => {
  const mapped = mapTanStackEvent({
    type: 'RUN_ERROR',
    code: 'upstream_error',
    message:
      'authorization: Bearer sk-or-v1-abcdef api_key=private-value '.repeat(20),
    rawEvent: { response: 'must not survive' },
  })
  assert.equal(mapped.kind, 'run.error')
  if (mapped.kind !== 'run.error') return
  assert.equal(mapped.code, 'upstream_error')
  assert.ok(mapped.message.length <= 240)
  assert.doesNotMatch(mapped.message, /sk-or-v1|private-value|must not survive/u)
  assert.match(mapped.message, /\[REDACTED\]/u)

  const cdp = safeDiagnostic(
    'wss://remote.example/devtools?token=credential&other=value',
  )
  assert.doesNotMatch(cdp, /credential/u)
})

test('usage is nullable, finite, and never invents zero for absent data', () => {
  assert.equal(normalizeUsage(undefined), null)
  assert.equal(
    normalizeUsage({ promptTokens: 1, completionTokens: 2 }),
    null,
  )
  assert.equal(
    normalizeUsage({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: Number.NaN,
    }),
    null,
  )
  assert.equal(
    normalizeUsage({ promptTokens: -1, completionTokens: 2, totalTokens: 1 }),
    null,
  )
  assert.equal(
    normalizeUsage({ promptTokens: 1, completionTokens: 2, totalTokens: 4 }),
    null,
  )
  assert.equal(
    normalizeUsage({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      cost: Number.POSITIVE_INFINITY,
    }),
    null,
  )
  assert.deepEqual(
    normalizeUsage({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      cost: 0.00001,
      providerUsageDetails: { unsafe: 'discarded' },
    }),
    {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      cost: 0.00001,
    },
  )
})

test('account action detection is narrow and does not expose credentials', () => {
  assert.equal(
    isOpenRouterAccountActionRequired(
      'Insufficient credits. Add more using the provider billing page',
    ),
    true,
  )
  assert.equal(
    isOpenRouterAccountActionRequired('Request was aborted by the caller'),
    false,
  )
  assert.equal(isOpenRouterAccountActionRequired(null), false)
})

test('P0 eligibility requires every capability to pass', () => {
  const allPass = emptyCapabilities('pass', 'verified')
  assert.equal(isP0Eligible(allPass), true)
  allPass.cancellation = { status: 'fail', detail: 'did not close' }
  assert.equal(isP0Eligible(allPass), false)
})
