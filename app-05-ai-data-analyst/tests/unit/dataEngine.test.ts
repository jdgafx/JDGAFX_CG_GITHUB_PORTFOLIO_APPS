import { describe, expect, it } from 'vitest'
import { executeQuery, parseCSV, parseNumericCell, topGroup } from '../../src/lib/dataEngine'
import { SALES_CSV } from '../../src/lib/sampleData'
import type { AggregateFn, QueryPlan } from '../../src/types'

const sales = parseCSV(SALES_CSV)

function planWith(groupBy: string, fn: AggregateFn, extra: Partial<QueryPlan> = {}): QueryPlan {
  return {
    chartType: 'bar',
    title: 'Test',
    explanation: '',
    groupBy,
    aggregate: { field: 'revenue', fn },
    ...extra,
  }
}

describe('parseNumericCell', () => {
  it('reads currency, thousands separators, percent signs and stray spaces', () => {
    expect(parseNumericCell('$1,234.56')).toBe(1234.56)
    expect(parseNumericCell('45%')).toBe(45)
    expect(parseNumericCell(' 12 ')).toBe(12)
  })

  it('reads accounting negatives written in parentheses', () => {
    expect(parseNumericCell('(500)')).toBe(-500)
  })

  it('returns null for text, blanks and missing cells', () => {
    expect(parseNumericCell('n/a')).toBeNull()
    expect(parseNumericCell('')).toBeNull()
    expect(parseNumericCell(undefined)).toBeNull()
  })
})

describe('parseCSV', () => {
  it('reads the bundled sales sample as 50 rows under five headers', () => {
    expect(sales.headers).toEqual(['date', 'product', 'revenue', 'units', 'region'])
    expect(sales.rows).toHaveLength(50)
    expect(sales.truncated).toBe(false)
    expect(sales.totalRows).toBe(50)
  })
})

describe('executeQuery on the sales sample', () => {
  it('totals revenue by product, highest first', () => {
    const result = executeQuery(sales, planWith('product', 'sum', { sortBy: { field: 'revenue', dir: 'desc' } }))
    expect(result.labels).toEqual(['Gadget Y', 'Widget A', 'Gadget X', 'Widget C', 'Widget B'])
    expect(result.datasets[0]?.values).toEqual([270000, 190000, 188800, 121950, 114300])
  })

  it('totals revenue by region, highest first', () => {
    const result = executeQuery(sales, planWith('region', 'sum', { sortBy: { field: 'revenue', dir: 'desc' } }))
    expect(result.labels).toEqual(['North', 'East', 'South', 'West'])
    expect(result.datasets[0]?.values).toEqual([242550, 240750, 202950, 198800])
  })

  it('averages revenue per product', () => {
    expect(topGroup(executeQuery(sales, planWith('product', 'avg')))).toEqual({ label: 'Gadget Y', value: 27000 })
  })

  it('finds the largest and the smallest revenue per product', () => {
    expect(topGroup(executeQuery(sales, planWith('product', 'max')))).toEqual({ label: 'Gadget Y', value: 36000 })
    expect(topGroup(executeQuery(sales, planWith('product', 'min')))).toEqual({ label: 'Gadget Y', value: 19200 })
  })

  it('counts rows after a case-insensitive filter', () => {
    const plan = planWith('region', 'count', { filter: { field: 'region', op: 'eq', value: 'north' } })
    expect(executeQuery(sales, plan)).toMatchObject({ labels: ['North'], datasets: [{ values: [13] }] })
  })

  it('keeps only rows above a numeric threshold before grouping', () => {
    const plan = planWith('product', 'sum', { filter: { field: 'revenue', op: 'gt', value: '30000' } })
    const result = executeQuery(sales, plan)
    expect(result.labels).toEqual(['Gadget Y'])
    expect(result.datasets[0]?.values).toEqual([68400])
  })

  it('finds the top product within one region', () => {
    const plan = planWith('product', 'sum', {
      filter: { field: 'region', op: 'eq', value: 'North' },
      sortBy: { field: 'revenue', dir: 'desc' },
    })
    expect(topGroup(executeQuery(sales, plan))).toEqual({ label: 'Gadget Y', value: 84000 })
  })

  it('sorts by the group label when asked', () => {
    const result = executeQuery(sales, planWith('product', 'sum', { sortBy: { field: 'product', dir: 'asc' } }))
    expect(result.labels).toEqual(['Gadget X', 'Gadget Y', 'Widget A', 'Widget B', 'Widget C'])
  })

  it('has no top group when a filter matches no rows', () => {
    const result = executeQuery(sales, planWith('product', 'sum', { filter: { field: 'region', op: 'eq', value: 'Mars' } }))
    expect(result.labels).toEqual([])
    expect(topGroup(result)).toBeNull()
  })

  it('refuses a plan that names a column the data does not have', () => {
    expect(() => executeQuery(sales, planWith('category', 'sum'))).toThrow(/not in this dataset/)
  })
})

describe('executeQuery on small inputs', () => {
  it('orders a line chart by date when no sort is given', () => {
    const data = parseCSV('date,revenue\n2024-03-01,5\n2024-01-15,2\n2024-02-10,3')
    const result = executeQuery(data, planWith('date', 'sum', { chartType: 'line' }))
    expect(result.labels).toEqual(['2024-01-15', '2024-02-10', '2024-03-01'])
    expect(result.datasets[0]?.values).toEqual([2, 3, 5])
  })

  it('groups blank labels together under a named label', () => {
    const data = parseCSV('product,revenue\n,5\nWidget,3\n  ,2')
    const result = executeQuery(data, planWith('product', 'sum', { sortBy: { field: 'revenue', dir: 'desc' } }))
    expect(result.labels).toEqual(['(blank)', 'Widget'])
    expect(result.datasets[0]?.values).toEqual([7, 3])
  })

  it('ignores non-numeric cells and says how many it skipped', () => {
    const data = parseCSV('product,revenue\nA,5\nA,n/a\nB,2')
    const result = executeQuery(data, planWith('product', 'sum', { sortBy: { field: 'revenue', dir: 'desc' } }))
    expect(result.labels).toEqual(['A', 'B'])
    expect(result.datasets[0]?.values).toEqual([5, 2])
    expect(result.warnings).toEqual(['Column "revenue": 1 non-numeric cell ignored.'])
  })

  it('returns a header-only file as columns with no rows', () => {
    const data = parseCSV('region,revenue')
    expect(data.headers).toEqual(['region', 'revenue'])
    expect(data.rows).toEqual([])
  })
})
