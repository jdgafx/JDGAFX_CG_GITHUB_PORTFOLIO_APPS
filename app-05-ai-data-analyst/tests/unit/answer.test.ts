import { describe, expect, it } from 'vitest'
import { answerSentence, describePlan } from '../../src/lib/answer'
import type { FilterOp, QueryPlan } from '../../src/types'

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

describe('describePlan', () => {
  it('names the group and the measure, with no filter and file order by default', () => {
    expect(describePlan(PLAN)).toEqual({
      groupBy: 'product',
      measure: 'total revenue',
      filter: 'None',
      sort: 'None, file order',
    })
  })

  it('reads each filter operator as a plain comparison', () => {
    const filterWords = (op: FilterOp) =>
      describePlan({ ...PLAN, filter: { field: 'temp_f', op, value: '70' } }).filter
    expect(filterWords('eq')).toBe('temp_f is 70')
    expect(filterWords('neq')).toBe('temp_f is not 70')
    expect(filterWords('gt')).toBe('temp_f is greater than 70')
    expect(filterWords('lte')).toBe('temp_f is at most 70')
    expect(filterWords('contains')).toBe('temp_f contains 70')
  })

  it('says whether a sort follows the measured value or the group label', () => {
    expect(describePlan({ ...PLAN, sortBy: { field: 'revenue', dir: 'desc' } }).sort).toBe(
      'total revenue, highest first',
    )
    expect(describePlan({ ...PLAN, sortBy: { field: 'product', dir: 'asc' } }).sort).toBe('product, A to Z')
  })

  it('describes the order a line chart gets when no sort is set', () => {
    expect(describePlan({ ...PLAN, chartType: 'line' }).sort).toBe('None, dates and numbers run in order')
  })
})
