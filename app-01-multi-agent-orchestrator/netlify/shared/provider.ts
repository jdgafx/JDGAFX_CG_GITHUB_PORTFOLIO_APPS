/** The one chat model every stage calls. Client-supplied model fields are ignored. */
export const MODEL = '~anthropic/claude-haiku-latest'

export const APP_TITLE = 'AgentFlow'
export const DEFAULT_SITE_URL = 'https://jdgafx-app-01-multi-agent-orchestrator.netlify.app'
export const SITE_URL = process.env.URL || DEFAULT_SITE_URL

export interface Provider {
  url: string
  apiKey: string
}

/** OpenRouter is the only provider. Its key is the server-side OPENROUTER_API_KEY. */
export function getProvider(): Provider | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return { url: process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions', apiKey }
}
