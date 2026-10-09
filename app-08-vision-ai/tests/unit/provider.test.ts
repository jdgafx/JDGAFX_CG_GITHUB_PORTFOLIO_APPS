import { afterEach, describe, expect, it } from 'vitest'
import { MODEL, chatBody, getProvider } from '../../netlify/shared/provider'

const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = ORIGINAL_KEY
})

describe('getProvider', () => {
  it('returns null when the server key is blank', () => {
    process.env.OPENROUTER_API_KEY = ''
    expect(getProvider()).toBeNull()
  })

  it('returns the fixed OpenRouter endpoint with the server key', () => {
    process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
    expect(getProvider()).toEqual({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'test-only-placeholder',
    })
  })
})

describe('chatBody', () => {
  it('pins the vision model and always sends max_tokens, reasoning off and usage', () => {
    const messages = [{ role: 'system' as const, content: 'Describe it.' }]
    expect(MODEL).toBe('anthropic/claude-haiku-5.5')
    expect(chatBody(messages, 8192)).not.toHaveProperty('temperature')
    expect(chatBody(messages, 8192)).toEqual({
      model: 'anthropic/claude-haiku-5.5',
      messages,
      stream: true,
      max_tokens: 8192,
      reasoning: { enabled: false },
      provider: { require_parameters: true },
      usage: { include: true },
    })
  })
})
