export const TRACEGATE_MODEL_IDS = [
  'deepseek/deepseek-v4-flash-0731',
  'mistralai/mistral-small-2603',
  'openai/gpt-5-mini',
] as const

export type TraceGateModelId = (typeof TRACEGATE_MODEL_IDS)[number]

export interface CompatibilityModelDefinition {
  readonly id: TraceGateModelId
  readonly label: string
  readonly p0Preferred: boolean
  readonly resolvedModelIds: readonly string[]
}

export const COMPATIBILITY_MODELS: ReadonlyArray<CompatibilityModelDefinition> = [
  {
    id: 'deepseek/deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash 0731',
    p0Preferred: true,
    resolvedModelIds: [
      'deepseek/deepseek-v4-flash-0731',
      'deepseek/deepseek-v4-flash-20260731',
    ],
  },
  {
    id: 'mistralai/mistral-small-2603',
    label: 'Mistral Small 4',
    p0Preferred: false,
    resolvedModelIds: ['mistralai/mistral-small-2603'],
  },
  {
    id: 'openai/gpt-5-mini',
    label: 'GPT-5 Mini',
    p0Preferred: false,
    resolvedModelIds: ['openai/gpt-5-mini'],
  },
]

export function isTraceGateModelId(value: string): value is TraceGateModelId {
  return (TRACEGATE_MODEL_IDS as readonly string[]).includes(value)
}

export function isExpectedResolvedModel(
  requestedModelId: TraceGateModelId,
  resolvedModelId: string,
): boolean {
  return (
    COMPATIBILITY_MODELS.find((model) => model.id === requestedModelId)
      ?.resolvedModelIds.includes(resolvedModelId) ?? false
  )
}
