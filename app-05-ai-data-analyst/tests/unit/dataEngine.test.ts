import { describe, expect, it } from 'vitest'
import { executeQuery, parseCSV, parseNumericCell, topGroup } from '../../src/lib/dataEngine'
import { parseEarthquakeCsv, parseWeatherCsv } from '../../src/lib/liveData/parse'
import { OPEN_METEO_EXCERPT } from '../fixtures/openMeteo'
import { USGS_EXCERPT } from '../fixtures/usgs'
import { MAX_ROWS } from '../../src/lib/limits'
import type { AggregateFn, QueryPlan } from '../../src/types'

const quakes = parseEarthquakeCsv(USGS_EXCERPT)
const weather = parseWeatherCsv(OPEN_METEO_EXCERPT)

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
  it('reads quoted cells that contain commas', () => {
    const data = parseCSV('place,mag\n"2 km SSE of Nikiski, Alaska",1.8')
    expect(data.rows).toEqual([{ place: '2 km SSE of Nikiski, Alaska', mag: '1.8' }])
  })

  it('flags a file with more rows than the limit as truncated', () => {
    const csv = `n\n${Array.from({ length: MAX_ROWS + 1 }, (_, i) => i).join('\n')}`
    const data = parseCSV(csv)
    expect(data.rows).toHaveLength(MAX_ROWS)
    expect(data.truncated).toBe(true)
    expect(data.totalRows).toBe(MAX_ROWS + 1)
  })
})

describe('executeQuery on a recorded USGS excerpt', () => {
  it('counts earthquakes per region, with the CA code read as California', () => {
    const result = executeQuery(quakes, planWith('region', 'count', { sortBy: { field: 'count', dir: 'desc' } }))
    expect(result.labels.slice(0, 4)).toEqual(['Alaska', 'California', 'Hawaii', 'Nevada'])
    expect(result.datasets[0]?.values.slice(0, 4)).toEqual([3, 3, 2, 2])
    expect(result.labels).not.toContain('CA')
    expect(result.datasets[0]?.values.reduce((a, b) => a + b, 0)).toBe(16)
  })

  it('averages magnitude by magnitude type', () => {
    const plan = planWith('magType', 'avg', { aggregate: { field: 'mag', fn: 'avg' } })
    const result = executeQuery(quakes, plan)
    const byType = Object.fromEntries(result.labels.map((label, i) => [label, result.datasets[0]?.values[i]]))
    expect(byType.ml).toBeCloseTo(1.511, 6)
    expect(byType.md).toBeCloseTo(1.5625, 6)
    expect(byType.mb).toBeCloseTo(4.4, 6)
    expect(topGroup(result)?.label).toBe('mb')
  })

  it('counts rows by event type', () => {
    const result = executeQuery(quakes, planWith('type', 'count', { sortBy: { field: 'count', dir: 'desc' } }))
    expect(result.labels).toEqual(['earthquake', 'explosion', 'quarry blast'])
    expect(result.datasets[0]?.values).toEqual([12, 3, 1])
  })

  it('finds the strongest magnitude within one event type', () => {
    const plan = planWith('region', 'max', {
      aggregate: { field: 'mag', fn: 'max' },
      filter: { field: 'type', op: 'eq', value: 'EARTHQUAKE' },
    })
    expect(topGroup(executeQuery(quakes, plan))).toEqual({ label: 'Japan region', value: 4.6, tied: ['Japan region'] })
  })

  it('keeps only rows above a numeric threshold before grouping', () => {
    const plan = planWith('magType', 'count', { filter: { field: 'mag', op: 'gte', value: '2' } })
    const result = executeQuery(quakes, plan)
    expect(result.labels).toEqual(['md', 'mb', 'ml'])
    expect(result.datasets[0]?.values).toEqual([1, 2, 2])
  })

  it('picks the smallest group when asked for the lowest', () => {
    const plan = planWith('magType', 'avg', { aggregate: { field: 'mag', fn: 'avg' } })
    const result = executeQuery(quakes, plan)
    expect(topGroup(result, 'lowest')?.label).toBe('ml')
    expect(topGroup(result, 'lowest')?.value).toBeCloseTo(1.511, 6)
    expect(topGroup(result)?.label).toBe('mb')
  })

  it('lists every group that shares the top value, the first one leading', () => {
    const plan = planWith('region', 'count', { sortBy: { field: 'count', dir: 'asc' } })
    const top = topGroup(executeQuery(quakes, plan), 'lowest')
    expect(top).toEqual({
      label: 'Georgia',
      value: 1,
      tied: ['Georgia', 'Puerto Rico', 'Japan', 'Washington', 'Oregon', 'Japan region'],
    })
  })

  it('sorts by the group label when asked', () => {
    const result = executeQuery(quakes, planWith('type', 'count', { sortBy: { field: 'type', dir: 'desc' } }))
    expect(result.labels).toEqual(['quarry blast', 'explosion', 'earthquake'])
  })

  it('has no top group when a filter matches no rows', () => {
    const result = executeQuery(quakes, planWith('type', 'count', { filter: { field: 'region', op: 'eq', value: 'Mars' } }))
    expect(result.labels).toEqual([])
    expect(topGroup(result)).toBeNull()
  })
})

describe('executeQuery on a recorded Open-Meteo excerpt', () => {
  it('averages the daily high by month, in calendar order', () => {
    const plan = planWith('month', 'avg', { chartType: 'line', aggregate: { field: 'temp_max_c', fn: 'avg' } })
    const result = executeQuery(weather, plan)
    expect(result.labels).toEqual(['2025-10', '2025-11'])
    expect(result.datasets[0]?.values[0]).toBeCloseTo(17.1, 6)
    expect(result.datasets[0]?.values[1]).toBeCloseTo(14.6, 6)
  })

  it('totals rain by month', () => {
    const plan = planWith('month', 'sum', { aggregate: { field: 'precipitation_mm', fn: 'sum' } })
    const result = executeQuery(weather, plan)
    expect(result.labels).toEqual(['2025-10', '2025-11'])
    expect(result.datasets[0]?.values[0]).toBeCloseTo(54.0, 6)
    expect(result.datasets[0]?.values[1]).toBeCloseTo(0.1, 6)
  })

  it('finds the lowest overnight temperature in the whole period', () => {
    const plan = planWith('month', 'min', { aggregate: { field: 'temp_min_c', fn: 'min' } })
    const result = executeQuery(weather, plan)
    expect(result.datasets[0]?.values).toEqual([4.9, 4.0])
    expect(topGroup(result, 'lowest')).toEqual({ label: '2025-11', value: 4.0, tied: ['2025-11'] })
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
