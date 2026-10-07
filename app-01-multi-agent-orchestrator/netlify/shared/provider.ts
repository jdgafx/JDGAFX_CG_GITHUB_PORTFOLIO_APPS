export interface ProviderConfig {
  url: string
  apiKey: string
  model: string
  name: 'xAI' | 'OpenRouter'
}

export function generationOptions(provider: ProviderConfig, maxTokens: number, requireParameters = false, explicitCap = false): Record<string, unknown> {
  const options: Record<string, unknown> = requireParameters && provider.name === 'OpenRouter' ? { provider: { require_parameters: true } } : {}
  if (explicitCap || provider.name !== 'OpenRouter' || provider.model !== 'openrouter/free') options.max_tokens = maxTokens
  return options
}

export function getProvider(_openRouterModel: string, requestedModel?: string): ProviderConfig | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (openRouterKey) {
    return { url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions', apiKey: openRouterKey, model: process.env.OPENROUTER_MODEL ?? 'openrouter/free', name: 'OpenRouter' }
  }
  const xaiKey = process.env.XAI_API_KEY
  if (xaiKey) {
    return {
      url: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1/chat/completions',
      apiKey: xaiKey,
      model: requestedModel ?? process.env.XAI_MODEL ?? 'grok-4.6',
      name: 'xAI',
    }
  }
  return null
}
