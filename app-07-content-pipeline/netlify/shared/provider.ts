export interface ProviderConfig { url: string; apiKey: string; model: string; name: 'xAI' | 'OpenRouter' }
export function generationOptions(provider: ProviderConfig, maxTokens: number): Record<string, unknown> { const options: Record<string, unknown> = provider.name === 'OpenRouter' && provider.model === 'openrouter/free' ? { provider: { require_parameters: true } } : {}; options.max_tokens = maxTokens; if (provider.name === 'OpenRouter' && provider.model !== 'openrouter/free') options.reasoning = { exclude: true }; return options }

// Verified in the live OpenRouter account on 2026-08-23: this direct route
// returned a short, stopped chat completion. The free router is intentionally
// not used here because it can select a slow or empty provider for Research.
export const VERIFIED_FAST_MODELS = [
  '~anthropic/claude-haiku-latest',
  'liquid/lfm-2.5-2.6b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'openrouter/free',
]

export function getProviders(_openRouterModel: string): ProviderConfig[] {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (openRouterKey) {
    const configured = process.env.OPENROUTER_MODEL
    const models = configured && configured !== 'openrouter/free' && VERIFIED_FAST_MODELS.includes(configured)
      ? [configured, ...VERIFIED_FAST_MODELS.filter(model => model !== configured)]
      : VERIFIED_FAST_MODELS
    return models.map(model => ({ url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions', apiKey: openRouterKey, model, name: 'OpenRouter' as const }))
  }
  const xaiKey = process.env.XAI_API_KEY
  return xaiKey ? [{ url: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1/chat/completions', apiKey: xaiKey, model: process.env.XAI_MODEL ?? 'grok-4.6', name: 'xAI' }] : []
}

export function getProvider(_openRouterModel: string): ProviderConfig | null {
  return getProviders(_openRouterModel)[0] ?? null
}
