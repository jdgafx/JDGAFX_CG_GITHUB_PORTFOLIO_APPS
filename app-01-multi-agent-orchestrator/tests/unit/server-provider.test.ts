import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MODEL, buildChatBody, getProvider, requestHeaders } from '../../netlify/shared/provider'

const savedKey = process.env.OPENROUTER_API_KEY
const savedUrl = process.env.OPENROUTER_URL

beforeEach(() => {
  delete process.env.OPENROUTER_URL
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  if (savedUrl === undefined) delete process.env.OPENROUTER_URL
  else process.env.OPENROUTER_URL = savedUrl
})

describe('getProvider', () => {
  it('returns no provider when the server key is blank', () => {
    process.env.OPENROUTER_API_KEY = ''
    expect(getProvider()).toBeNull()
  })

  it('uses the server key and the OpenRouter chat endpoint by default', () => {
    process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
    expect(getProvider()).toEqual({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'test-only-placeholder',
    })
  })
})

describe('buildChatBody', () => {
  it('pins the fixed model, caps output with max_tokens, and asks for usage with cost', () => {
    expect(buildChatBody('SYS', 'USER', 600)).toEqual({
      model: '~anthropic/claude-haiku-latest',
      max_tokens: 600,
      stream: true,
      stream_options: { include_usage: true },
      usage: { include: true },
      reasoning: { enabled: false },
      provider: { require_parameters: true },
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USER' },
      ],
    })
  })

  it('carries the stage token ceiling it is given', () => {
    expect(buildChatBody('SYS', 'USER', 1200).max_tokens).toBe(1200)
  })

  it('keeps the model constant fixed', () => {
    expect(MODEL).toBe('~anthropic/claude-haiku-latest')
  })
})

describe('requestHeaders', () => {
  it('sends the key as a bearer token and names the app', () => {
    expect(requestHeaders('test-only-placeholder')).toMatchObject({
      Authorization: 'Bearer test-only-placeholder',
      'Content-Type': 'application/json',
      'X-Title': 'AgentFlow',
    })
  })
})
