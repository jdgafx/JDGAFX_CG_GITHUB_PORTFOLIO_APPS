import { describe, expect, it } from 'vitest'
import { estimateCost, readCost } from '../../netlify/shared/cost'
import { MODEL } from '../../netlify/shared/models'

describe('estimateCost', () => {
  it('prices 1000 prompt and 200 completion tokens at $0.10 in and $0.50 out per 1M, which is 0.0002 USD', () => {
    expect(estimateCost(MODEL, { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 })).toBe(0.0002)
  })

  it('prices a million tokens each way at the list price, 0.10 plus 0.50', () => {
    const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 }

    expect(estimateCost(MODEL, usage)).toBeCloseTo(0.6, 9)
  })

  it('returns null when the model has no price or the usage is incomplete', () => {
    expect(estimateCost('unknown/model', { prompt_tokens: 1, completion_tokens: 1 })).toBeNull()
    expect(estimateCost(MODEL, { total_tokens: 1200 })).toBeNull()
  })
})

describe('readCost', () => {
  it('prefers the cost OpenRouter reported and labels it as reported', () => {
    expect(readCost(MODEL, { prompt_tokens: 1000, completion_tokens: 200 }, 0.00004)).toEqual({
      cost: 0.00004,
      source: 'usage',
    })
  })

  it('falls back to a labelled estimate when no cost was reported', () => {
    expect(readCost(MODEL, { prompt_tokens: 1000, completion_tokens: 200 }, null)).toEqual({
      cost: 0.0002,
      source: 'estimated',
    })
  })

  it('gives no number at all when there is neither a reported cost nor usage', () => {
    expect(readCost(MODEL, null, null)).toBeNull()
  })
})
