import type { StreamChunk, TokenUsage } from '@tanstack/ai'
import { z } from 'zod'
import {
  COMPATIBILITY_MODELS,
  type TraceGateModelId,
} from './models.js'

export const COMPATIBILITY_CAPABILITIES = [
  'streamingTools',
  'multipleToolProposals',
  'parallelToolProposals',
  'strictStructuredSchema',
  'usage',
  'cancellation',
  'toolErrors',
  'malformedEventMapping',
  'providerRouting',
] as const

export type CompatibilityCapability =
  (typeof COMPATIBILITY_CAPABILITIES)[number]
export type CapabilityStatus = 'pass' | 'fail' | 'blocked' | 'not_run'

export interface CapabilityResult {
  readonly status: CapabilityStatus
  readonly detail: string
}

export interface SafeUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
  readonly cost?: number
}

export interface ModelCompatibilityResult {
  readonly modelId: TraceGateModelId
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number
  readonly capabilities: Record<CompatibilityCapability, CapabilityResult>
  readonly usage: SafeUsage | null
  readonly resolvedModel: string | null
  readonly resolvedProvider: string | null
  readonly toolCallCount: number
  readonly maxObservedToolConcurrency: number
  readonly safeError: string | null
  readonly p0Eligible: boolean
}

export interface CompatibilityReport {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly configured: boolean
  readonly packageVersions: {
    readonly tanstackAi: '0.52.0'
    readonly tanstackAiOpenRouter: '0.19.5'
    readonly zod: '4.5.4'
  }
  readonly models: ReadonlyArray<ModelCompatibilityResult>
  readonly p0PassingModels: ReadonlyArray<TraceGateModelId>
  readonly blocker: string | null
}

export type SafeMappedEvent =
  | { readonly kind: 'run.started'; readonly model: string | null }
  | {
      readonly kind: 'run.finished'
      readonly model: string | null
      readonly usage: SafeUsage | null
    }
  | {
      readonly kind: 'run.error'
      readonly code: string
      readonly message: string
    }
  | {
      readonly kind: 'tool.started'
      readonly toolCallId: string
      readonly toolName: string
    }
  | { readonly kind: 'tool.args'; readonly toolCallId: string }
  | { readonly kind: 'tool.ended'; readonly toolCallId: string }
  | {
      readonly kind: 'tool.result'
      readonly toolCallId: string
      readonly isError: boolean
    }
  | { readonly kind: 'text.delta' }
  | { readonly kind: 'structured.complete' }
  | { readonly kind: 'ignored'; readonly eventType: string }
  | {
      readonly kind: 'protocol.error'
      readonly code: 'malformed_event' | 'unknown_event'
      readonly message: string
    }

const MAX_SAFE_MESSAGE_LENGTH = 240
const SECRET_PATTERNS = [
  /sk-or-v1-[A-Za-z0-9_-]+/giu,
  /(?:authorization|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/giu,
  /bearer\s+[^\s,;]+/giu,
  /wss?:\/\/[^\s"']*[?&](?:token|key|secret|authorization)=[^&\s"']+/giu,
] as const

export function safeDiagnostic(value: unknown): string {
  const source = value instanceof Error ? value.message : String(value)
  let redacted = source
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]')
  }
  return redacted.slice(0, MAX_SAFE_MESSAGE_LENGTH)
}

export function isOpenRouterAccountActionRequired(
  safeMessage: string | null,
): boolean {
  return safeMessage !== null && /\binsufficient credits\b/iu.test(safeMessage)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringField(
  event: Record<string, unknown>,
  field: string,
): string | null {
  const value = event[field]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function safeIdentifier(
  value: unknown,
  pattern: RegExp,
  maxLength: number,
): string | null {
  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    !pattern.test(value)
  ) {
    return null
  }
  return safeDiagnostic(value) === value ? value : null
}

export function safeModelIdentifier(value: unknown): string | null {
  return safeIdentifier(value, /^[A-Za-z0-9._/:-]+$/u, 120)
}

function safeToolCallId(value: unknown): string | null {
  return safeIdentifier(value, /^[A-Za-z0-9._:-]+$/u, 160)
}

function safeToolName(value: unknown): string | null {
  return safeIdentifier(value, /^[A-Za-z0-9._-]+$/u, 80)
}

function safeErrorCode(value: unknown): string {
  return (
    safeIdentifier(value, /^[A-Za-z0-9._-]+$/u, 64) ??
    'provider_protocol_error'
  )
}

export function normalizeUsage(value: unknown): SafeUsage | null {
  if (!isRecord(value)) return null
  const promptTokens = value.promptTokens
  const completionTokens = value.completionTokens
  const totalTokens = value.totalTokens
  if (
    typeof promptTokens !== 'number' ||
    typeof completionTokens !== 'number' ||
    typeof totalTokens !== 'number' ||
    !Number.isSafeInteger(promptTokens) ||
    !Number.isSafeInteger(completionTokens) ||
    !Number.isSafeInteger(totalTokens) ||
    promptTokens < 0 ||
    completionTokens < 0 ||
    totalTokens !== promptTokens + completionTokens
  ) {
    return null
  }
  const cost = value.cost
  if (
    cost !== undefined &&
    (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)
  ) {
    return null
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(typeof cost === 'number' ? { cost } : {}),
  }
}

function malformed(message: string): SafeMappedEvent {
  return {
    kind: 'protocol.error',
    code: 'malformed_event',
    message,
  }
}

export function mapTanStackEvent(event: unknown): SafeMappedEvent {
  if (!isRecord(event)) return malformed('Provider event is not an object')
  const type = stringField(event, 'type')
  if (!type) return malformed('Provider event has no string type')

  switch (type) {
    case 'RUN_STARTED':
      if (!stringField(event, 'runId') || !stringField(event, 'threadId')) {
        return malformed('RUN_STARTED is missing runId or threadId')
      }
      return {
        kind: 'run.started',
        model: safeModelIdentifier(event.model),
      }
    case 'RUN_FINISHED':
      return {
        kind: 'run.finished',
        model: safeModelIdentifier(event.model),
        usage: normalizeUsage(event.usage),
      }
    case 'RUN_ERROR':
      return {
        kind: 'run.error',
        code: safeErrorCode(event.code),
        message: safeDiagnostic(
          stringField(event, 'message') ?? 'Provider run failed',
        ),
      }
    case 'TOOL_CALL_START': {
      const toolCallId = safeToolCallId(event.toolCallId)
      const toolName =
        safeToolName(event.toolCallName) ?? safeToolName(event.toolName)
      if (!toolCallId || !toolName) {
        return malformed('TOOL_CALL_START is missing call identity')
      }
      return { kind: 'tool.started', toolCallId, toolName }
    }
    case 'TOOL_CALL_ARGS': {
      const toolCallId = safeToolCallId(event.toolCallId)
      if (!toolCallId || typeof event.delta !== 'string') {
        return malformed('TOOL_CALL_ARGS is missing call identity or delta')
      }
      return { kind: 'tool.args', toolCallId }
    }
    case 'TOOL_CALL_END': {
      const toolCallId = safeToolCallId(event.toolCallId)
      if (!toolCallId) return malformed('TOOL_CALL_END is missing call identity')
      return { kind: 'tool.ended', toolCallId }
    }
    case 'TOOL_CALL_RESULT': {
      const toolCallId = safeToolCallId(event.toolCallId)
      if (!toolCallId) {
        return malformed('TOOL_CALL_RESULT is missing call identity')
      }
      const metadata = isRecord(event.metadata) ? event.metadata : null
      const tanstack = metadata && isRecord(metadata.tanstack)
        ? metadata.tanstack
        : null
      return {
        kind: 'tool.result',
        toolCallId,
        isError:
          event.role === 'tool' &&
          (event.state === 'error' ||
            tanstack?.state === 'output-error' ||
            stringField(event, 'error') !== null),
      }
    }
    case 'TEXT_MESSAGE_CONTENT':
      return typeof event.delta === 'string'
        ? { kind: 'text.delta' }
        : malformed('TEXT_MESSAGE_CONTENT is missing delta')
    case 'CUSTOM':
      return event.name === 'structured-output.complete'
        ? { kind: 'structured.complete' }
        : { kind: 'ignored', eventType: 'CUSTOM' }
    case 'TEXT_MESSAGE_START':
    case 'TEXT_MESSAGE_END':
    case 'STEP_STARTED':
    case 'STEP_FINISHED':
    case 'REASONING_START':
    case 'REASONING_MESSAGE_START':
    case 'REASONING_MESSAGE_CONTENT':
    case 'REASONING_MESSAGE_END':
    case 'REASONING_END':
    case 'REASONING_ENCRYPTED_VALUE':
    case 'MESSAGES_SNAPSHOT':
    case 'STATE_SNAPSHOT':
    case 'STATE_DELTA':
      return { kind: 'ignored', eventType: type }
    default:
      return {
        kind: 'protocol.error',
        code: 'unknown_event',
        message: `Unknown provider event type: ${safeDiagnostic(type)}`,
      }
  }
}

export function mapStreamChunk(event: StreamChunk): SafeMappedEvent {
  return mapTanStackEvent(event)
}

export interface EventSequenceAnalysis {
  readonly completeToolLifecycle: boolean
  readonly startsBeforeFirstResult: number
  readonly protocolErrorCount: number
  readonly orderingErrorCount: number
  readonly runErrorCount: number
  readonly runStartedCount: number
  readonly runFinishedCount: number
  readonly normalRunTermination: boolean
}

type ToolLifecycleState = 'started' | 'args' | 'ended' | 'resulted'

export function analyzeEventSequence(
  events: readonly SafeMappedEvent[],
): EventSequenceAnalysis {
  const states = new Map<string, ToolLifecycleState>()
  const startsBeforeFirstResult = new Set<string>()
  let sawResult = false
  let protocolErrorCount = 0
  let orderingErrorCount = 0
  let runErrorCount = 0
  let runStartedCount = 0
  let runFinishedCount = 0

  for (const event of events) {
    switch (event.kind) {
      case 'run.started':
        runStartedCount += 1
        break
      case 'run.finished':
        runFinishedCount += 1
        break
      case 'run.error':
        runErrorCount += 1
        break
      case 'tool.started':
        if (states.has(event.toolCallId)) {
          orderingErrorCount += 1
        } else {
          states.set(event.toolCallId, 'started')
          if (!sawResult) startsBeforeFirstResult.add(event.toolCallId)
        }
        break
      case 'tool.args': {
        const state = states.get(event.toolCallId)
        if (state === 'started' || state === 'args') {
          states.set(event.toolCallId, 'args')
        } else {
          orderingErrorCount += 1
        }
        break
      }
      case 'tool.ended':
        if (states.get(event.toolCallId) === 'args') {
          states.set(event.toolCallId, 'ended')
        } else {
          orderingErrorCount += 1
        }
        break
      case 'tool.result':
        sawResult = true
        if (states.get(event.toolCallId) === 'ended') {
          states.set(event.toolCallId, 'resulted')
        } else {
          orderingErrorCount += 1
        }
        break
      case 'protocol.error':
        protocolErrorCount += 1
        break
      default:
        break
    }
  }

  return {
    completeToolLifecycle:
      states.size > 0 &&
      [...states.values()].every((state) => state === 'resulted') &&
      orderingErrorCount === 0,
    startsBeforeFirstResult: startsBeforeFirstResult.size,
    protocolErrorCount,
    orderingErrorCount,
    runErrorCount,
    runStartedCount,
    runFinishedCount,
    normalRunTermination:
      runStartedCount === 1 && runFinishedCount > 0 && runErrorCount === 0,
  }
}

export function safeUsageFromMiddleware(usage: TokenUsage): SafeUsage | null {
  return normalizeUsage(usage)
}

export const StrictProbeResultSchema = z
  .object({
    verdict: z.literal('probe_complete'),
    inspectedSlots: z.tuple([z.literal('A'), z.literal('B')]),
    recoveredFromToolError: z.literal(true),
  })
  .strict()

export type StrictProbeResult = z.infer<typeof StrictProbeResultSchema>

export function emptyCapabilities(
  status: CapabilityStatus,
  detail: string,
): Record<CompatibilityCapability, CapabilityResult> {
  return Object.fromEntries(
    COMPATIBILITY_CAPABILITIES.map((capability) => [
      capability,
      { status, detail },
    ]),
  ) as Record<CompatibilityCapability, CapabilityResult>
}

export function blockedCompatibilityReport(now = new Date()): CompatibilityReport {
  const startedAt = now.toISOString()
  const blocker =
    'OPENROUTER_API_KEY is not configured; live OpenRouter model capabilities cannot be verified.'
  return {
    schemaVersion: 1,
    generatedAt: startedAt,
    configured: false,
    packageVersions: {
      tanstackAi: '0.52.0',
      tanstackAiOpenRouter: '0.19.5',
      zod: '4.5.4',
    },
    models: COMPATIBILITY_MODELS.map(({ id }) => ({
      modelId: id,
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      capabilities: emptyCapabilities('blocked', blocker),
      usage: null,
      resolvedModel: null,
      resolvedProvider: null,
      toolCallCount: 0,
      maxObservedToolConcurrency: 0,
      safeError: blocker,
      p0Eligible: false,
    })),
    p0PassingModels: [],
    blocker,
  }
}

export function isP0Eligible(
  capabilities: Record<CompatibilityCapability, CapabilityResult>,
): boolean {
  return COMPATIBILITY_CAPABILITIES.every(
    (capability) => capabilities[capability].status === 'pass',
  )
}
