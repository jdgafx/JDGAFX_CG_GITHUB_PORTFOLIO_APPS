import { describe, expect, it } from 'vitest'
import { answerDirection, isValueSort, validateQueryPlan } from '../../src/lib/queryPlan'
import type { QueryPlan } from '../../src/types'

const HEADERS = ['date', 'product', 'revenue', 'units', 'region']
const COLUMN_LIST = 'Available columns: date, product, revenue, units, region. Try naming the column you want in your question.'

const GOOD = {
  chartType: 'bar',
  groupBy: 'product',
  aggregate: { field: 'revenue', fn: 'sum' },
  title: 'Total revenue by product',
  explanation: 'Adds up revenue for each product.',
  notice: null,
}

function planOf(raw: unknown): QueryPlan {
  const result = validateQueryPlan(raw, HEADERS)
  if (!result.ok) throw new Error(`Expected a valid plan, got: ${result.error}`)
  return result.plan
}

function errorOf(raw: unknown): string {
  const result = validateQueryPlan(raw, HEADERS)
  if (result.ok) throw new Error('Expected the plan to be refused')
  return result.error
}

describe('validateQueryPlan accepts good plans', () => {
  it('returns the plan typed, without an empty notice', () => {
    expect(planOf(GOOD)).toEqual({
      chartType: 'bar',
      groupBy: 'product',
      aggregate: { field: 'revenue', fn: 'sum' },
      title: 'Total revenue by product',
      explanation: 'Adds up revenue for each product.',
    })
  })

  it('accepts every allowed chart type and calculation', () => {
    for (const chartType of ['bar', 'line', 'pie', 'area', 'scatter']) {
      expect(planOf({ ...GOOD, chartType }).chartType).toBe(chartType)
    }
    for (const fn of ['sum', 'avg', 'count', 'min', 'max']) {
      expect(planOf({ ...GOOD, aggregate: { field: 'revenue', fn } }).aggregate.fn).toBe(fn)
    }
  })

  it('pins a placeholder measure on a count to the group-by column', () => {
    expect(planOf({ ...GOOD, aggregate: { field: '*', fn: 'count' } }).aggregate).toEqual({ field: 'product', fn: 'count' })
  })

  it('keeps a numeric filter value as text', () => {
    expect(planOf({ ...GOOD, filter: { field: 'units', op: 'gte', value: 300 } }).filter).toEqual({
      field: 'units',
      op: 'gte',
      value: '300',
    })
  })

  it('keeps a notice sentence and drops a notice that says null', () => {
    expect(planOf({ ...GOOD, notice: 'There is no category column, so products are shown.' }).notice).toBe(
      'There is no category column, so products are shown.',
    )
    expect(planOf({ ...GOOD, notice: 'null' }).notice).toBeUndefined()
  })

  it('defaults a sort to descending and allows sorting by the value', () => {
    expect(planOf({ ...GOOD, sortBy: { field: 'value' } }).sortBy).toEqual({ field: 'value', dir: 'desc' })
  })
})

describe('validateQueryPlan refuses bad plans with plain messages', () => {
  it('refuses a reply that is not an object', () => {
    expect(errorOf('not a plan')).toBe('The AI returned an unreadable response. Try rephrasing your question.')
  })

  it('refuses a chart type outside the allowed list', () => {
    expect(errorOf({ ...GOOD, chartType: 'donut' })).toBe('The AI asked for an unsupported chart type ("donut").')
  })

  it('refuses a calculation outside the allowed list', () => {
    expect(errorOf({ ...GOOD, aggregate: { field: 'revenue', fn: 'median' } })).toBe(
      'The AI asked for an unsupported calculation ("median").',
    )
  })

  it('refuses a missing group-by column', () => {
    expect(errorOf({ ...GOOD, groupBy: '' })).toBe('The AI did not say which column to group by. Try rephrasing your question.')
  })

  it('refuses a group-by column the dataset does not have and lists the real ones', () => {
    expect(errorOf({ ...GOOD, groupBy: 'category' })).toBe(
      `The AI picked a group-by column ("category") that is not in this dataset. ${COLUMN_LIST}`,
    )
  })

  it('refuses a measured column the dataset does not have', () => {
    expect(errorOf({ ...GOOD, aggregate: { field: 'sales', fn: 'sum' } })).toBe(
      `The AI picked a measured column ("sales") that is not in this dataset. ${COLUMN_LIST}`,
    )
  })

  it('refuses a filter on a column the dataset does not have', () => {
    expect(errorOf({ ...GOOD, filter: { field: 'city', op: 'eq', value: 'Paris' } })).toBe(
      `The AI picked a filter column ("city") that is not in this dataset. ${COLUMN_LIST}`,
    )
  })

  it('refuses an unknown filter comparison and a filter without a value', () => {
    expect(errorOf({ ...GOOD, filter: { field: 'region', op: 'like', value: 'N' } })).toBe(
      'The AI asked for an unsupported filter comparison ("like").',
    )
    expect(errorOf({ ...GOOD, filter: { field: 'region', op: 'eq' } })).toBe(
      'The AI returned a filter without a value. Try rephrasing your question.',
    )
  })

  it('refuses a sort by a column the chart does not show', () => {
    expect(errorOf({ ...GOOD, sortBy: { field: 'units', dir: 'asc' } })).toBe(
      'The AI tried to sort by "units", which is not shown in this chart. Sort by "product" or "revenue" instead.',
    )
  })

  it('refuses a sort direction outside asc and desc', () => {
    expect(errorOf({ ...GOOD, sortBy: { field: 'revenue', dir: 'up' } })).toBe(
      'The AI asked for an unsupported sort direction ("up").',
    )
  })
})

describe('isValueSort', () => {
  const plan = planOf(GOOD)

  it('is true for the aggregated value and false for the group label', () => {
    expect(isValueSort(plan, 'revenue')).toBe(true)
    expect(isValueSort(plan, 'value')).toBe(true)
    expect(isValueSort(plan, 'product')).toBe(false)
  })
})

describe('answerDirection', () => {
  const plan: QueryPlan = {
    chartType: 'bar',
    groupBy: 'product',
    aggregate: { field: 'revenue', fn: 'sum' },
    title: 'T',
    explanation: '',
  }

  it('asks for the lowest group only when the measure is sorted ascending', () => {
    expect(answerDirection({ ...plan, sortBy: { field: 'revenue', dir: 'asc' } })).toBe('lowest')
    expect(answerDirection({ ...plan, sortBy: { field: 'count', dir: 'asc' } })).toBe('lowest')
  })

  it('asks for the highest group for a descending sort, a label sort or no sort', () => {
    expect(answerDirection({ ...plan, sortBy: { field: 'revenue', dir: 'desc' } })).toBe('highest')
    expect(answerDirection({ ...plan, sortBy: { field: 'product', dir: 'asc' } })).toBe('highest')
    expect(answerDirection(plan)).toBe('highest')
  })
})
