import { describe, expect, it } from 'vitest'
import { DECIDE_MODEL, INTAKE_MODEL, PRICES, REPLY_MODEL, estimateCost } from '../../netlify/shared/models'

describe('estimateCost', () => {
  it('prices 1000 prompt and 200 completion tokens on gpt-oss-20b at 0.000036 USD', () => {
    expect(estimateCost('openai/gpt-oss-20b', 1000, 200)).toBeCloseTo(0.000036, 12)
  })

  it('prices the intake model from its list price', () => {
    expect(estimateCost(INTAKE_MODEL, 1000, 200)).toBeCloseTo(0.000196, 12)
  })

  it('returns undefined for a model with no known price, so no figure is invented', () => {
    expect(estimateCost('unknown/model', 1000, 200)).toBeUndefined()
  })

  it('returns zero for zero tokens', () => {
    expect(estimateCost(DECIDE_MODEL, 0, 0)).toBe(0)
  })
})

describe('model ids and prices', () => {
  it('uses the Haiku alias for both the decide and the reply calls', () => {
    expect(DECIDE_MODEL).toBe('~anthropic/claude-haiku-latest')
    expect(REPLY_MODEL).toBe(DECIDE_MODEL)
  })

  it('lists the four list prices from the brief, in USD per 1M tokens', () => {
    expect(PRICES).toEqual({
      'xiaomi/mimo-v2.6-pro': { input: 0.44, output: 0.87 },
      'xiaomi/mimo-v2.6-flash': { input: 0.14, output: 0.28 },
      'openai/gpt-oss-20b': { input: 0.018, output: 0.09 },
      '~anthropic/claude-haiku-latest': { input: 0.1, output: 0.5 },
    })
  })
})
