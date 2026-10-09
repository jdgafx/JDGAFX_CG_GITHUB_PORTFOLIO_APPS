import { describe, expect, it } from 'vitest'
import { answerDirection, applyQuestionDirection, askedDirection, isValueSort, validateQueryPlan } from '../../src/lib/queryPlan'
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

  it('keeps a list of missing items, trimmed, and drops an empty or null list', () => {
    expect(planOf({ ...GOOD, missing: [' wind speed ', '', 'deaths'] }).missing).toEqual(['wind speed', 'deaths'])
    expect(planOf({ ...GOOD, missing: [] }).missing).toBeUndefined()
    expect(planOf({ ...GOOD, missing: null }).missing).toBeUndefined()
    expect(planOf(GOOD).missing).toBeUndefined()
  })

  it('rejects a missing list that is not a list of text', () => {
    const unreadable = 'The AI returned an unreadable list of missing items. Try rephrasing your question.'
    expect(validateQueryPlan({ ...GOOD, missing: 'wind speed' }, HEADERS)).toEqual({ ok: false, error: unreadable })
    expect(validateQueryPlan({ ...GOOD, missing: ['a', 3] }, HEADERS)).toEqual({ ok: false, error: unreadable })
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

describe('askedDirection', () => {
  it('reads the end of the ranking a question names', () => {
    for (const q of ['Which region had the fewest earthquakes?', 'Coldest night?', 'the LEAST rain', 'smallest total', 'bottom 3 products']) {
      expect(askedDirection(q)).toBe('lowest')
    }
    for (const q of ['Which region had the most earthquakes?', 'Highest revenue', 'top product', 'warmest month']) {
      expect(askedDirection(q)).toBe('highest')
    }
  })

  it('returns null for no ranking word, both ends, thresholds and aggregate names', () => {
    expect(askedDirection('Average max temperature by month')).toBeNull()
    expect(askedDirection('Lowest min temperature by month')).toBe('lowest')
    expect(askedDirection('Minimum temperature by month')).toBeNull()
    expect(askedDirection('most and least popular product')).toBeNull()
    expect(askedDirection('regions with at least 5 earthquakes')).toBeNull()
    expect(askedDirection('quakes of at most magnitude 3')).toBeNull()
  })
})

describe('applyQuestionDirection', () => {
  const plan: QueryPlan = {
    chartType: 'bar',
    groupBy: 'region',
    aggregate: { field: 'id', fn: 'count' },
    title: 'T',
    explanation: '',
  }
  const FEWEST = 'Which region had the fewest earthquakes?'

  it('sorts the measure ascending when the plan has no sort', () => {
    expect(applyQuestionDirection(plan, FEWEST).sortBy).toEqual({ field: 'id', dir: 'asc' })
  })

  it('replaces a sort by the group name', () => {
    const byName = { ...plan, sortBy: { field: 'region', dir: 'asc' as const } }
    expect(applyQuestionDirection(byName, FEWEST).sortBy).toEqual({ field: 'id', dir: 'asc' })
    expect(applyQuestionDirection(byName, 'Which region had the most earthquakes?').sortBy).toEqual({ field: 'id', dir: 'desc' })
  })

  it('lets the question win over the model sorting the measure the other way', () => {
    const descending = { ...plan, sortBy: { field: 'id', dir: 'desc' as const } }
    expect(applyQuestionDirection(descending, FEWEST).sortBy).toEqual({ field: 'id', dir: 'asc' })
    const ascending = { ...plan, sortBy: { field: 'id', dir: 'asc' as const } }
    expect(applyQuestionDirection(ascending, 'Which region had the most earthquakes?').sortBy).toEqual({ field: 'id', dir: 'desc' })
  })

  it('keeps a plan that already ranks the measure the way the question asks', () => {
    const ascending = { ...plan, sortBy: { field: 'count', dir: 'asc' as const } }
    expect(applyQuestionDirection(ascending, FEWEST)).toBe(ascending)
  })

  it('leaves line and area charts and questions without a ranking alone', () => {
    const line = { ...plan, chartType: 'line' as const }
    expect(applyQuestionDirection(line, 'lowest by month')).toBe(line)
    const byName = { ...plan, sortBy: { field: 'region', dir: 'asc' as const } }
    expect(applyQuestionDirection(byName, 'Count by region')).toBe(byName)
    expect(applyQuestionDirection(plan, 'Which region had the most earthquakes at least 5 km deep?').sortBy).toEqual({ field: 'id', dir: 'desc' })
  })
})
