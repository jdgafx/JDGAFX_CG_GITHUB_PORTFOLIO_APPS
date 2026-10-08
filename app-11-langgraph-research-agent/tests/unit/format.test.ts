import { describe, expect, it } from 'vitest'
import { costHint, costSourceText } from '../../src/lib/format'

describe('costHint', () => {
  it('says where a complete total came from', () => {
    expect(costHint({ cost: 0.5, costSource: 'usage', unpricedRows: 0 })).toBe('reported by OpenRouter')
    expect(costHint({ cost: 0.5, costSource: 'estimated', unpricedRows: 0 })).toBe('estimated from list prices')
    expect(costSourceText.usage).toBe('reported by OpenRouter')
  })

  it('labels a total built from some calls as partial, with the count of unpriced rows', () => {
    expect(costHint({ cost: 0.5, costSource: 'usage', unpricedRows: 1 })).toBe('partial (1 row without a price)')
    expect(costHint({ cost: 0.5, costSource: 'estimated', unpricedRows: 2 })).toBe(
      'partial (2 rows without a price)',
    )
  })

  it('says no model call has a price when there is no total', () => {
    expect(costHint({ unpricedRows: 3 })).toBe('no model call has a price')
  })
})
