import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProvider, MAX_TOKENS, MODEL, OPENROUTER_URL } from '../../netlify/shared/provider'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('provider settings', () => {
  it('pins one model, one endpoint and one token cap for every planner call', () => {
    expect(MODEL).toBe('~anthropic/claude-haiku-latest')
    expect(MAX_TOKENS).toBe(4096)
    expect(OPENROUTER_URL).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('returns no provider when the key is blank', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '   ')
    expect(getProvider()).toBeNull()
  })

  it('returns the fixed model with the key trimmed', () => {
    vi.stubEnv('OPENROUTER_API_KEY', ' test-only-placeholder ')
    expect(getProvider()).toEqual({
      url: OPENROUTER_URL,
      apiKey: 'test-only-placeholder',
      model: '~anthropic/claude-haiku-latest',
    })
  })
})
