import { describe, expect, it } from 'vitest'
import { MAX_OUTPUT_TOKENS, chatBody, replyEnding, replyText } from '../../netlify/shared/provider'

interface SentBody {
  model: string
  max_tokens: number
  reasoning?: { enabled?: boolean }
  usage: { include: boolean }
  provider: { require_parameters: boolean }
  response_format: { type: string }
  messages: Array<{ role: string; content: string }>
}

describe('chatBody', () => {
  it('sends the fixed model, a token cap that leaves room to think, no reasoning override and usage reporting', () => {
    const body = JSON.parse(chatBody('system text', 'user text')) as SentBody
    expect(body.model).toBe('~anthropic/claude-haiku-latest')
    expect(body).not.toHaveProperty('temperature')
    expect(body.provider).toEqual({ require_parameters: true })
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS)
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096 + 1500)
    expect(body.reasoning?.enabled).not.toBe(false)
    expect(body).not.toHaveProperty('reasoning')
    expect(body.usage).toEqual({ include: true })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toEqual([
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'user text' },
    ])
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

describe('replyEnding', () => {
  it('is "complete" only for finish_reason stop', () => {
    expect(replyEnding({ choices: [{ finish_reason: 'stop' }] })).toBe('complete')
  })

  it('is "length" when the provider stopped at the token ceiling', () => {
    expect(replyEnding({ choices: [{ finish_reason: 'length' }] })).toBe('length')
    expect(replyEnding({ choices: [{ finish_reason: 'max_tokens' }] })).toBe('length')
  })

  it('is "unfinished" for a missing or null finish_reason and for any other reason: only "stop" is a reply that ended', () => {
    expect(replyEnding({ choices: [{ finish_reason: null }] })).toBe('unfinished')
    expect(replyEnding({ choices: [{}] })).toBe('unfinished')
    expect(replyEnding({ choices: [] })).toBe('unfinished')
    expect(replyEnding({})).toBe('unfinished')
    for (const reason of ['content_filter', 'tool_calls', 'error', 'STOP', '']) expect(replyEnding({ choices: [{ finish_reason: reason }] })).toBe('unfinished')
  })
})
