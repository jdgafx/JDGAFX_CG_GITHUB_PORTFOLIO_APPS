import { describe, expect, it } from 'vitest'
import { CHAT_URL, chatRequest, MODEL } from '../../netlify/shared/provider'

describe('chatRequest', () => {
  it('always sends the output cap, reasoning off and usage reporting, with the fixed model', () => {
    expect(chatRequest('Summarise the week', 1024)).toEqual({
      model: 'anthropic/claude-haiku-5.5',
      max_tokens: 1024,
      reasoning: { enabled: false },
      usage: { include: true },
      stream: true,
      messages: [{ role: 'user', content: 'Summarise the week' }],
    })
  })

  it('never sends a temperature, which Haiku 5.5 rejects', () => {
    expect(chatRequest('x', 8)).not.toHaveProperty('temperature')
  })

  it('uses the fixed model constant', () => {
    expect(MODEL).toBe('anthropic/claude-haiku-5.5')
    expect(chatRequest('x', 8).model).toBe(MODEL)
  })
})

describe('CHAT_URL', () => {
  it('is the OpenRouter chat completions endpoint', () => {
    expect(CHAT_URL).toBe('https://openrouter.ai/api/v1/chat/completions')
  })
})
