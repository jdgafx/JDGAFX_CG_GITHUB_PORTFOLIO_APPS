import { describe, expect, it } from 'vitest'
import { answerSentence, describePlan, describeResult } from '../../src/lib/answer'
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
    expect(answerSentence(PLAN, { label: 'Gadget Y', value: 270000, tied: ['Gadget Y'] })).toBe(
      'Gadget Y has the highest total revenue: 270,000.',
    )
  })

  it('names the measure for each calculation', () => {
    expect(
      answerSentence({ ...PLAN, aggregate: { field: 'revenue', fn: 'avg' } }, { label: 'Gadget Y', value: 27000.456, tied: ['Gadget Y'] }),
    ).toBe('Gadget Y has the highest average revenue: 27,000.46.')
    expect(
      answerSentence({ ...PLAN, aggregate: { field: 'revenue', fn: 'count' } }, { label: 'North', value: 13, tied: ['North'] }),
    ).toBe('North has the highest number of rows: 13.')
  })

  it('returns nothing when there are no groups', () => {
    expect(answerSentence(PLAN, null)).toBeNull()
  })

  it('says lowest when the plan ranks the measure ascending', () => {
    const lowest = { ...PLAN, aggregate: { field: 'temp_min_c', fn: 'min' as const }, sortBy: { field: 'temp_min_c', dir: 'asc' as const } }
    expect(answerSentence(lowest, { label: '2025-11', value: -11, tied: ['2025-11'] })).toBe('2025-11 has the lowest minimum temp_min_c: -11.')
  })

  it('names a tie instead of one winner', () => {
    const lowest = { ...PLAN, aggregate: { field: 'id', fn: 'count' as const }, sortBy: { field: 'count', dir: 'asc' as const } }
    const labels = ['Georgia', 'Fiji', 'Italy', 'Colorado', 'Utah']
    expect(answerSentence(lowest, { label: 'Georgia', value: 1, tied: labels })).toBe(
      '5 groups tie for the lowest number of rows: 1 (Georgia, Fiji, Italy, and 2 more).',
    )
    expect(answerSentence(PLAN, { label: 'A', value: 5, tied: ['A', 'B'] })).toBe(
      '2 groups tie for the highest total revenue: 5 (A, B).',
    )
  })

  it('keeps saying highest for a descending sort, a label sort or no sort', () => {
    const top = { label: 'A', value: 5, tied: ['A'] }
    expect(answerSentence({ ...PLAN, sortBy: { field: 'revenue', dir: 'desc' } }, top)).toContain('highest')
    expect(answerSentence({ ...PLAN, sortBy: { field: 'product', dir: 'asc' } }, top)).toContain('highest')
    expect(answerSentence(PLAN, top)).toContain('highest')
  })
})

describe('describeResult', () => {
  const top = { label: 'Alaska', value: 624, tied: ['Alaska'] }
  const COUNT = { ...PLAN, aggregate: { field: 'id', fn: 'count' as const } }

  it('leads with the notice and marks a stand-in when the plan lists missing items', () => {
    const plan = { ...COUNT, missing: ['deaths'], notice: 'The dataset has no deaths column, so I counted events.' }
    expect(describeResult(plan, top)).toEqual({
      notice: 'The dataset has no deaths column, so I counted events.',
      note: null,
      answer: 'Alaska has the highest number of rows: 624.',
      substitute: true,
    })
  })

  it('builds the lead from the list when the model gave no sentence', () => {
    expect(describeResult({ ...COUNT, missing: ['deaths', 'damage cost'] }, top).notice).toBe(
      'The data has no column for: deaths, damage cost.',
    )
  })

  it('keeps a remark without missing items as a plain note, never a stand-in', () => {
    const plan = { ...PLAN, notice: 'Values like "1,200" were read as numbers.' }
    expect(describeResult(plan, top)).toEqual({
      notice: null,
      note: 'Values like "1,200" were read as numbers.',
      answer: 'Alaska has the highest total revenue: 624.',
      substitute: false,
    })
  })

  it('has no notice and no note for an ordinary plan', () => {
    expect(describeResult(PLAN, top)).toMatchObject({ notice: null, note: null, substitute: false })
  })
})

describe('describePlan', () => {
  it('names the group and the measure, with no filter and file order by default', () => {
    expect(describePlan(PLAN)).toEqual({
      groupBy: 'product',
      measure: 'total revenue',
      filter: 'None',
      having: null,
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

  it('puts a threshold on the aggregated value in words', () => {
    expect(describePlan({ ...PLAN, having: { op: 'gte', value: 100 } }).having).toBe('total revenue of at least 100')
    expect(describePlan({ ...PLAN, having: { op: 'lt', value: 5.5 } }).having).toBe('total revenue below 5.5')
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
