import type { AgentModelDriver, AgentModelDriverFactory } from '@tracegate/agent'

/**
 * Public runtime boundary for the single verified P0 model route.
 * The implementation is loaded on first model turn so importing this package does
 * not eagerly evaluate unrelated workspace package barrels.
 */
export function createDeepSeekOpenRouterDriverFactory(apiKey: string): AgentModelDriverFactory {
  if (!apiKey.trim()) throw new Error('OPENROUTER_API_KEY is required')

  return (options) => {
    let driver: Promise<AgentModelDriver> | null = null
    return {
      runTurn(input) {
        if (input.signal.aborted) return Promise.reject(new DOMException('Agent operation was cancelled', 'AbortError'))
        driver ??= import('./tanstack-agent-driver.js')
          .then((runtime) => runtime.createDeepSeekOpenRouterDriverFactory(apiKey)(options))
          .catch(() => { throw new Error('DeepSeek OpenRouter runtime failed to load') })
        return driver.then((resolved) => {
          if (input.signal.aborted) throw new DOMException('Agent operation was cancelled', 'AbortError')
          return resolved.runTurn(input)
        })
      },
    }
  }
}
