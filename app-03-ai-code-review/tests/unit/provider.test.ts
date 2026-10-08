import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatBody, providerCall, replyCutShort, replyText } from '../../netlify/shared/provider'

afterEach(() => {
  vi.unstubAllEnvs()
})

interface SentBody {
  model: string
  max_tokens: number
  reasoning: { enabled: boolean }
  usage: { include: boolean }
  response_format: { type: string }
  messages: Array<{ role: string; content: string }>
}

describe('chatBody', () => {
  it('sends the fixed model, a token cap, reasoning off and usage reporting', () => {
    const body = JSON.parse(chatBody('system text', 'user text')) as SentBody
    expect(body.model).toBe('~anthropic/claude-haiku-latest')
    expect(body.max_tokens).toBe(4096)
    expect(body.reasoning).toEqual({ enabled: false })
    expect(body.usage).toEqual({ include: true })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toEqual([
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'user text' },
    ])
  })
})

describe('providerCall', () => {
  it('returns null when no key is configured', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect(providerCall()).toBeNull()
  })

  it('returns the fixed chat endpoint with the configured key', () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-only-placeholder')
    expect(providerCall()).toEqual({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'test-only-placeholder',
    })
  })
})

describe('replyText', () => {
  it('returns the first choice content, trimmed', () => {
    expect(replyText({ choices: [{ message: { content: '  {"comments":[]}\n' } }] })).toBe('{"comments":[]}')
  })

  it('returns an empty string when there is no content', () => {
    expect(replyText({})).toBe('')
    expect(replyText({ choices: [{ message: { content: null } }] })).toBe('')
    expect(replyText({ choices: [] })).toBe('')
  })
})

describe('replyCutShort', () => {
  it('is true when the provider stopped at the token ceiling', () => {
    expect(replyCutShort({ choices: [{ finish_reason: 'length' }] })).toBe(true)
    expect(replyCutShort({ choices: [{ finish_reason: 'max_tokens' }] })).toBe(true)
  })

  it('is false for a normal stop or when no finish reason is given', () => {
    expect(replyCutShort({ choices: [{ finish_reason: 'stop' }] })).toBe(false)
    expect(replyCutShort({ choices: [{ finish_reason: null }] })).toBe(false)
    expect(replyCutShort({})).toBe(false)
  })
})
