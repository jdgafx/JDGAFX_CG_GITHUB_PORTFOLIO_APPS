import { describe, expect, it } from 'vitest'
import { MAX_TOKENS, MODEL, OPENROUTER_URL } from '../../netlify/shared/provider'

describe('provider settings', () => {
  it('pins one model, one endpoint and one token cap for every planner call', () => {
    expect(MODEL).toBe('anthropic/claude-haiku-5.5')
    expect(MAX_TOKENS).toBe(4096)
    expect(OPENROUTER_URL).toBe('https://openrouter.ai/api/v1/chat/completions')
  })
})
