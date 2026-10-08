import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatRequest, getProvider, MODEL } from '../../netlify/shared/provider'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('chatRequest', () => {
  it('always sends the output cap, reasoning off and usage reporting, with the fixed model', () => {
    expect(chatRequest('Summarise the week', 1024)).toEqual({
      model: '~anthropic/claude-haiku-latest',
      max_tokens: 1024,
      reasoning: { enabled: false },
      usage: { include: true },
      stream: true,
      messages: [{ role: 'user', content: 'Summarise the week' }],
    })
  })

  it('uses the fixed model constant', () => {
    expect(MODEL).toBe('~anthropic/claude-haiku-latest')
    expect(chatRequest('x', 8).model).toBe(MODEL)
  })
})

describe('getProvider', () => {
  it('returns null when the server key is not set', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect(getProvider()).toBeNull()
  })

  it('returns the OpenRouter chat endpoint and the key, read at call time', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-only-placeholder')
    expect(getProvider()).toEqual({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'test-only-placeholder',
      name: 'OpenRouter',
    })
  })
})
