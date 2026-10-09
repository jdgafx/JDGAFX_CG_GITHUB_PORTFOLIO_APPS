import { describe, expect, it } from 'vitest'
import { drawnLine, formatCost, shortModel } from '../../src/lib/format'

const base = { labels: [] as string[], queryPlan: { chartType: 'bar' } }

describe('drawnLine', () => {
  it('counts the groups of a chart that was drawn', () => {
    expect(drawnLine({ ...base, labels: ['a', 'b', 'c'] })).toBe('bar chart, 3 groups')
    expect(drawnLine({ ...base, labels: ['a'], queryPlan: { chartType: 'line' } })).toBe('line chart, 1 group')
  })

  it('says why nothing was drawn instead of "0 groups"', () => {
    expect(drawnLine(base)).toBe('nothing drawn: no rows matched')
    expect(drawnLine({ ...base, having: { total: 12 } })).toBe('nothing drawn: no group met the threshold')
  })
})

describe('figures', () => {
  it('shows small costs with six digits and larger ones with four', () => {
    expect(formatCost(0.000412)).toBe('$0.000412')
    expect(formatCost(0.0213)).toBe('$0.0213')
  })

  it('drops the provider from a model id', () => {
    expect(shortModel('anthropic/claude-haiku-5.5')).toBe('claude-haiku-5.5')
    expect(shortModel('claude-haiku-5.5')).toBe('claude-haiku-5.5')
  })
})
