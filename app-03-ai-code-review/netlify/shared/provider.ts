export type ProviderName = 'xAI' | 'Anthropic' | 'OpenRouter'

export interface ProviderConfig {
  url: string
  apiKey: string
  model: string
  name: ProviderName
}

interface ProviderRequestInput {
  system: string
  user: string
  maxTokens: number
  requireParameters?: boolean
}

export interface ProviderRequestInit {
  headers: Record<string, string>
  body: string
}

export function generationOptions(provider: ProviderConfig, maxTokens: number, requireParameters = false): Record<string, unknown> {
  const options: Record<string, unknown> = requireParameters && provider.name === 'OpenRouter'
    ? { provider: { require_parameters: true } }
    : {}
  if (provider.name !== 'OpenRouter' || provider.model !== 'openrouter/free') options.max_tokens = maxTokens
  return options
}

export function providerRequest(provider: ProviderConfig, input: ProviderRequestInput): ProviderRequestInit {
  if (provider.name === 'Anthropic') {
    return {
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': provider.apiKey,
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      }),
    }
  }

  return {
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      ...generationOptions(provider, input.maxTokens, input.requireParameters),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    }),
  }
}

export async function requestWithContentRetry(request: () => Promise<Response>): Promise<Response> {
  const response = await request()
  if (!response.ok) return response
  const probe = await response.clone().json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    content?: Array<{ text?: string }>
    stop_reason?: string
  } | null
  const choice = probe?.choices?.[0]
  const content = choice?.message?.content?.trim() ?? probe?.content?.map((part) => part.text ?? '').join('').trim() ?? ''
  const finishReason = choice?.finish_reason ?? probe?.stop_reason
  if (content && finishReason !== 'length' && finishReason !== 'max_tokens') return response
  return request()
}

export function providerText(data: {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  content?: Array<{ text?: string }>
}): string | undefined {
  return data.choices?.[0]?.message?.content ?? data.content?.map((part) => part.text ?? '').join('')
}

export function providerFinishReason(data: {
  choices?: Array<{ finish_reason?: string }>
  stop_reason?: string
}): string | undefined {
  return data.choices?.[0]?.finish_reason ?? data.stop_reason
}

export function providerModel(data: { model?: string }, fallback: string): string {
  return data.model ?? fallback
}

function directFallbacks(): ProviderConfig[] {
  const fallbacks: ProviderConfig[] = []
  const xaiKey = process.env.XAI_API_KEY
  if (xaiKey) {
    fallbacks.push({
      url: process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1/chat/completions',
      apiKey: xaiKey,
      model: process.env.XAI_MODEL ?? 'grok-4.6',
      name: 'xAI',
    })
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    fallbacks.push({
      url: process.env.ANTHROPIC_URL ?? 'https://api.anthropic.com/v1/messages',
      apiKey: anthropicKey,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
      name: 'Anthropic',
    })
  }
  return fallbacks
}

export function getProvider(_openRouterModel: string): ProviderConfig | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (openRouterKey) {
    return {
      url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: openRouterKey,
      model: process.env.OPENROUTER_MODEL ?? 'openrouter/free',
      name: 'OpenRouter',
    }
  }

  return directFallbacks()[0] ?? null
}

export function getFallbackProvider(primary: ProviderConfig): ProviderConfig | null {
  return directFallbacks().find((provider) => provider.name !== primary.name) ?? null
}
