import { describe, expect, it } from 'vitest'
import { answerSentence } from '../../src/lib/answer'
import type { QueryPlan } from '../../src/types'

const PLAN: QueryPlan = {
  chartType: 'bar',
  groupBy: 'product',
  aggregate: { field: 'revenue', fn: 'sum' },
  title: 'Total revenue by product',
  explanation: '',
}

describe('answerSentence', () => {
  it('states the top group and its total in words', () => {
    expect(answerSentence(PLAN, { label: 'Gadget Y', value: 270000 })).toBe(
      'Gadget Y has the highest total revenue: 270,000.',
    )
  })

  it('names the measure for each calculation', () => {
    expect(
      answerSentence({ ...PLAN, aggregate: { field: 'revenue', fn: 'avg' } }, { label: 'Gadget Y', value: 27000.456 }),
    ).toBe('Gadget Y has the highest average revenue: 27,000.46.')
    expect(
      answerSentence({ ...PLAN, aggregate: { field: 'revenue', fn: 'count' } }, { label: 'North', value: 13 }),
    ).toBe('North has the highest number of rows: 13.')
  })

  it('returns nothing when there are no groups', () => {
    expect(answerSentence(PLAN, null)).toBeNull()
  })
})
