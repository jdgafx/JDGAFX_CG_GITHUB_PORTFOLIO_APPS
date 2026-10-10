import { describe, expect, it } from 'vitest'
import { costFor, MAX_TOKENS, NODE_MODEL, SERVED_MODEL, STEP_NEEDS_MS } from '../../netlify/shared/models'

describe('model assignment', () => {
  it('requests the Claude Haiku alias for every node, named by id once', () => {
    expect(NODE_MODEL).toBe('~anthropic/claude-haiku-latest')
    expect(SERVED_MODEL).toBe('anthropic/claude-haiku-5.5')
  })

  it('caps each node reply and sends no temperature setting at all', async () => {
    expect(MAX_TOKENS).toEqual({ plan: 400, agent: 800, draft: 1200, critic: 400 })
    const models = (await import('../../netlify/shared/models')) as Record<string, unknown>
    expect(Object.keys(models).filter((name) => name.includes('TEMPERATURE'))).toEqual([])
  })

  it('needs more time for a model step than for a Wikipedia round', () => {
    expect(STEP_NEEDS_MS.tools).toBeLessThan(STEP_NEEDS_MS.draft)
  })
})

describe('costFor', () => {
  it('estimates from the list price when OpenRouter reports no cost', () => {
    // 1000 prompt tokens at $0.10 per 1M plus 200 completion tokens at $0.50 per 1M.
    expect(costFor(NODE_MODEL, { prompt_tokens: 1000, completion_tokens: 200 })).toEqual({
      cost: 0.0002,
      source: 'estimated',
    })
  })

  it('prices the id that answered as well as the alias that was requested', () => {
    const usage = { prompt_tokens: 1000, completion_tokens: 200 }
    expect(costFor(SERVED_MODEL, usage)).toEqual(costFor(NODE_MODEL, usage))
    expect(costFor(SERVED_MODEL, usage)).toEqual({ cost: 0.0002, source: 'estimated' })
  })

  it('prices Haiku 4.5, which has answered the alias, at its own list price', () => {
    // 1000 prompt tokens at $1 per 1M plus 200 completion tokens at $5 per 1M.
    expect(costFor('anthropic/claude-haiku-4.5', { prompt_tokens: 1000, completion_tokens: 200 })).toEqual({
      cost: 0.002,
      source: 'estimated',
    })
  })

  it('prefers the cost the provider reported', () => {
    expect(costFor(NODE_MODEL, { prompt_tokens: 1, completion_tokens: 1, cost: 0.5 })).toEqual({
      cost: 0.5,
      source: 'usage',
    })
  })

  it('returns null when there is no price or no token count, rather than inventing a number', () => {
    expect(costFor('some/unlisted-model', { prompt_tokens: 1000, completion_tokens: 200 })).toBeNull()
    expect(costFor(NODE_MODEL, {})).toBeNull()
    expect(costFor(NODE_MODEL, { prompt_tokens: 10 })).toBeNull()
  })
})
