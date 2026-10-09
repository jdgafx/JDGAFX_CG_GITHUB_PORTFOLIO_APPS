import { describe, expect, it } from 'vitest'
import {
  AGENT_MODEL,
  costFor,
  CRITIC_MODEL,
  DRAFT_MODEL,
  MAX_TOKENS,
  PLAN_MODEL,
  TEMPERATURE,
} from '../../netlify/shared/models'

describe('model assignments', () => {
  it('names the model for each node as the brief sets it', () => {
    expect(PLAN_MODEL).toBe('xiaomi/mimo-v2.6-flash')
    expect(AGENT_MODEL).toBe('xiaomi/mimo-v2.6-pro')
    expect(DRAFT_MODEL).toBe('xiaomi/mimo-v2.6-pro')
    expect(CRITIC_MODEL).toBe('~anthropic/claude-haiku-latest')
  })

  it('caps each node reply and keeps the temperature low', () => {
    expect(MAX_TOKENS).toEqual({ plan: 400, agent: 800, draft: 1200, critic: 400 })
    expect(TEMPERATURE).toBe(0.2)
  })
})

describe('costFor', () => {
  it('estimates from the list price when OpenRouter reports no cost', () => {
    // 1000 prompt tokens at $0.14 per 1M plus 200 completion tokens at $0.28 per 1M.
    expect(costFor(PLAN_MODEL, { prompt_tokens: 1000, completion_tokens: 200 })).toEqual({
      cost: 0.000196,
      source: 'estimated',
    })
  })

  it('estimates the pro model from its own price', () => {
    expect(costFor(AGENT_MODEL, { prompt_tokens: 1000, completion_tokens: 200 })).toEqual({
      cost: 0.000614,
      source: 'estimated',
    })
  })

  it('prefers the cost the provider reported', () => {
    expect(costFor(PLAN_MODEL, { prompt_tokens: 1, completion_tokens: 1, cost: 0.5 })).toEqual({
      cost: 0.5,
      source: 'usage',
    })
  })

  it('returns null when there is no price or no token count, rather than inventing a number', () => {
    expect(costFor('some/unlisted-model', { prompt_tokens: 1000, completion_tokens: 200 })).toBeNull()
    expect(costFor(PLAN_MODEL, {})).toBeNull()
    expect(costFor(PLAN_MODEL, { prompt_tokens: 10 })).toBeNull()
  })
})
