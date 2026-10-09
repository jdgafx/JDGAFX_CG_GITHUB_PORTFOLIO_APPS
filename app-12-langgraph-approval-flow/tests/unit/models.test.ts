import { describe, expect, it } from 'vitest'
import { MODEL, PRICES, estimateCost } from '../../netlify/shared/models'

describe('estimateCost', () => {
  it('prices 1000 prompt and 200 completion tokens at 0.0002 USD', () => {
    expect(estimateCost(MODEL, 1000, 200)).toBeCloseTo(0.0002, 12)
  })

  it('returns undefined for a model with no known price, so no figure is invented', () => {
    expect(estimateCost('unknown/model', 1000, 200)).toBeUndefined()
  })

  it('returns zero for zero tokens', () => {
    expect(estimateCost(MODEL, 0, 0)).toBe(0)
  })
})

describe('the one model', () => {
  it('is Haiku 5.5, pinned in one constant that every node uses', () => {
    expect(MODEL).toBe('anthropic/claude-haiku-5.5')
  })

  it('has the one list price, in USD per 1M tokens', () => {
    expect(PRICES).toEqual({ 'anthropic/claude-haiku-5.5': { input: 0.1, output: 0.5 } })
  })
})
