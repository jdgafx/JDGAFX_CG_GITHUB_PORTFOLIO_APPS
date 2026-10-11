import { describe, expect, it } from 'vitest'
import { MODEL, PRICES, estimateCost } from '../../netlify/shared/models'

const SERVED = 'anthropic/claude-haiku-5.5'

describe('estimateCost', () => {
  it('prices 1000 prompt and 200 completion tokens of the served model at 0.0002 USD', () => {
    expect(estimateCost(SERVED, 1000, 200)).toBeCloseTo(0.0002, 12)
  })

  it('returns undefined for a served model with no known price, so no figure is invented', () => {
    expect(estimateCost('unknown/model', 1000, 200)).toBeUndefined()
  })

  it('returns undefined when the reply named no model, so no figure is invented', () => {
    expect(estimateCost(null, 1000, 200)).toBeUndefined()
  })

  it('never prices the requested alias, which is not a served id', () => {
    expect(estimateCost(MODEL, 1000, 200)).toBeUndefined()
  })

  it('does not price an object prototype key as a model', () => {
    expect(estimateCost('constructor', 1000, 200)).toBeUndefined()
  })

  it('returns zero for zero tokens', () => {
    expect(estimateCost(SERVED, 0, 0)).toBe(0)
  })
})

describe('the one model', () => {
  it('is the newest Haiku alias, in one constant that every node uses', () => {
    expect(MODEL).toBe('~anthropic/claude-haiku-latest')
  })

  it('has the one list price, keyed by the served model id it was measured for, in USD per 1M tokens', () => {
    expect(PRICES).toEqual({ 'anthropic/claude-haiku-5.5': { input: 0.1, output: 0.5 } })
  })
})
