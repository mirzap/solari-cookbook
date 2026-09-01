import {
  blockedCompatibilityReport,
  isOpenRouterAccountActionRequired,
  safeDiagnostic,
  type CompatibilityReport,
} from './compatibility.js'
import { runLiveModelProbe } from './live-probe.js'
import {
  COMPATIBILITY_MODELS,
  isTraceGateModelId,
} from './models.js'

function providerAllowlist(): string[] {
  const raw = process.env.OPENROUTER_PROVIDER_ONLY
  if (!raw) return []
  const providers = raw.split(',').map((value) => value.trim())
  if (providers.some((value) => !/^[A-Za-z0-9._/-]{1,80}$/u.test(value))) {
    throw new Error('OPENROUTER_PROVIDER_ONLY contains an invalid provider slug')
  }
  return providers
}

function selectedModels() {
  const requested = process.env.TRACEGATE_PROBE_MODEL
  if (!requested) return COMPATIBILITY_MODELS
  if (!isTraceGateModelId(requested)) {
    throw new Error('TRACEGATE_PROBE_MODEL must be one exact planned model slug')
  }
  return COMPATIBILITY_MODELS.filter((model) => model.id === requested)
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.log(JSON.stringify(blockedCompatibilityReport(), null, 2))
    process.exitCode = 2
    return
  }

  const providerOnly = providerAllowlist()
  const results = []
  for (const model of selectedModels()) {
    results.push(
      await runLiveModelProbe({
        modelId: model.id,
        apiKey,
        providerOnly,
      }),
    )
  }
  const p0PassingModels = results
    .filter((result) => result.p0Eligible)
    .map((result) => result.modelId)
  const accountActionRequired = results.every((result) =>
    isOpenRouterAccountActionRequired(result.safeError),
  )
  const report: CompatibilityReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configured: true,
    packageVersions: {
      tanstackAi: '0.52.0',
      tanstackAiOpenRouter: '0.19.5',
      zod: '4.5.4',
    },
    models: results,
    p0PassingModels,
    blocker:
      p0PassingModels.length > 0
        ? null
        : accountActionRequired
          ? 'OpenRouter account has insufficient credits; no exact planned model request reached model execution.'
          : 'No exact planned model passed every production-shaped compatibility capability.',
  }
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = p0PassingModels.length > 0 ? 0 : 1
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      schemaVersion: 1,
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      fatal: safeDiagnostic(error),
    }),
  )
  process.exitCode = 1
})
