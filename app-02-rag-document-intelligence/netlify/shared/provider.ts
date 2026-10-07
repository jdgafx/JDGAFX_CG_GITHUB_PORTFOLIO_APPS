export interface ProviderConfig { url: string; apiKey: string; model: string; name: 'xAI' | 'OpenRouter' }
export function generationOptions(provider: ProviderConfig, maxTokens: number, requireParameters = false): Record<string, unknown> { const options: Record<string, unknown> = requireParameters && provider.name === 'OpenRouter' ? { provider: { require_parameters: true } } : {}; if (provider.name !== 'OpenRouter' || provider.model !== 'openrouter/free') options.max_tokens = maxTokens; return options }
export async function requestWithContentRetry(request: () => Promise<Response>): Promise<Response> { const response = await request(); if (!response.ok) return response; const probe = await response.clone().json().catch(() => null) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> } | null; const choice = probe?.choices?.[0]; if ((choice?.message?.content?.trim() && choice?.finish_reason !== 'length') || choice?.finish_reason === 'stop') return response; return request() }

export function getProvider(_openRouterModel: string): ProviderConfig | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (openRouterKey) return { url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions', apiKey: openRouterKey, model: process.env.OPENROUTER_MODEL ?? 'openrouter/free', name: 'OpenRouter' }
  const xaiKey = process.env.XAI_API_KEY
  return xaiKey ? { url: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1/chat/completions', apiKey: xaiKey, model: process.env.XAI_MODEL ?? 'grok-4.6', name: 'xAI' } : null
}
