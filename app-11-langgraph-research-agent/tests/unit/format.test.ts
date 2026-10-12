import { describe, expect, it } from 'vitest'
import { atLeast, costHint, noCostText, notReported, plainModel, shortModel } from '../../src/lib/format'

describe('costHint', () => {
  const served = ['anthropic/claude-haiku-5.5']

  it('says the price comes from OpenRouter and names the model that answered', () => {
    expect(costHint({ cost: 0.5, unpricedRows: 0 }, served)).toBe('OpenRouter price for anthropic/claude-haiku-5.5')
    expect(costHint({ cost: 0.5, unpricedRows: 0 }, ['anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-4.5'])).toBe(
      'OpenRouter price for anthropic/claude-haiku-5.5, anthropic/claude-haiku-4.5',
    )
  })

  it('labels a total built from some calls as partial, with the count of unpriced rows', () => {
    expect(costHint({ cost: 0.5, unpricedRows: 1 }, served)).toBe(
      'partial (1 row without a price), OpenRouter price for anthropic/claude-haiku-5.5',
    )
    expect(costHint({ cost: 0.5, unpricedRows: 2 }, served)).toBe(
      'partial (2 rows without a price), OpenRouter price for anthropic/claude-haiku-5.5',
    )
  })

  it('names calls whose usage never arrived, beside the rows without a price', () => {
    expect(costHint({ cost: 0.5, unpricedRows: 0, unreportedCalls: 1 }, served)).toBe(
      'partial (1 call not reported), OpenRouter price for anthropic/claude-haiku-5.5',
    )
    expect(costHint({ cost: 0.5, unpricedRows: 1, unreportedCalls: 2 }, served)).toBe(
      'partial (1 row without a price, 2 calls not reported), OpenRouter price for anthropic/claude-haiku-5.5',
    )
  })

  it('says the total includes the cost of a refused call', () => {
    expect(costHint({ cost: 0.5, unpricedRows: 0, unreportedCalls: 0, refusedCalls: 1 }, served)).toBe(
      'includes the cost of a refused call, OpenRouter price for anthropic/claude-haiku-5.5',
    )
    expect(costHint({ cost: 0.5, unpricedRows: 0, refusedCalls: 2 }, served)).toContain('includes the cost of 2 refused calls')
  })

  it('says only that there is no price when there is no total', () => {
    expect(costHint({ unpricedRows: 3 }, served)).toBe('tokens shown, no price')
  })
})

describe('noCostText', () => {
  it('says the served model was not reported when the replies named none', () => {
    expect(noCostText([])).toBe('served model not reported')
  })

  it('says the price is unavailable when a model answered but OpenRouter gave no price for it', () => {
    expect(noCostText(['anthropic/claude-haiku-5.5'])).toBe('price unavailable')
  })
})

describe('model chips', () => {
  it('drops the provider prefix and the ~ of an OpenRouter alias', () => {
    expect(shortModel('anthropic/claude-haiku-5.5')).toBe('claude-haiku-5.5')
    expect(shortModel('~anthropic/claude-haiku-latest')).toBe('claude-haiku-latest')
    expect(plainModel('~anthropic/claude-haiku-latest')).toBe('anthropic/claude-haiku-latest')
    expect(plainModel('anthropic/claude-haiku-5.5')).toBe('anthropic/claude-haiku-5.5')
  })
})

describe('calls whose usage never arrived', () => {
  it('words the count, and turns a total into a floor only when a call is missing', () => {
    expect(notReported(0)).toBe('')
    expect(notReported(1)).toBe('1 call not reported')
    expect(notReported(2)).toBe('2 calls not reported')
    expect(atLeast('$0.000120', 0)).toBe('$0.000120')
    expect(atLeast('$0.000120', 1)).toBe('at least $0.000120')
  })
})
