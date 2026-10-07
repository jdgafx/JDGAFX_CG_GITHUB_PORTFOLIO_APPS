export interface ProviderConfig { url: string; apiKey: string; model: string; name: 'xAI' | 'OpenRouter' }
export function generationOptions(provider: ProviderConfig, maxTokens: number): Record<string, unknown> { const options: Record<string, unknown> = {}; if (provider.name !== 'OpenRouter' || provider.model !== 'openrouter/free') options.max_tokens = maxTokens; if (provider.name === 'OpenRouter' && provider.model !== 'openrouter/free') options.reasoning = { exclude: true }; return options }
export async function requestWithContentRetry(request: () => Promise<Response>): Promise<Response> { const response = await request(); if (!response.ok) return response; const probe = await response.clone().json().catch(() => null) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> } | null; const choice = probe?.choices?.[0]; if ((choice?.message?.content?.trim() && choice?.finish_reason !== 'length') || choice?.finish_reason === 'stop') return response; return request() }

// Direct chat-capable routes verified against OpenRouter on 2026-08-23. Do
// not use openrouter/free here: it has served a content-safety classifier to
// this conversational product.
export const VERIFIED_CHAT_MODELS = [
  '~anthropic/claude-haiku-latest',
  'nvidia/nemotron-3.5-lightning:free',
]

export function getProvider(_openRouterModel: string): ProviderConfig | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (openRouterKey) {
    const configured = process.env.OPENROUTER_MODEL
    const model = configured && configured !== 'openrouter/free' && VERIFIED_CHAT_MODELS.includes(configured)
      ? configured
      : VERIFIED_CHAT_MODELS[0]
    return { url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions', apiKey: openRouterKey, model, name: 'OpenRouter' }
  }
  const xaiKey = process.env.XAI_API_KEY
  return xaiKey ? { url: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1/chat/completions', apiKey: xaiKey, model: process.env.XAI_MODEL ?? 'grok-4.6', name: 'xAI' } : null
}
