import { describe, expect, it } from 'vitest'
import { fileSlug, resultToCsv } from '../../src/lib/export'
import { WEATHER_VOCABULARY } from '../../src/lib/vocabulary'
import type { AnalysisResult } from '../../src/types'

const RESULT: AnalysisResult = {
  labels: ['2025-10', 'Mexico, north', '=SUM(A1)', '-4', '-abc'],
  datasets: [{ name: 'precipitation_mm', values: [54.0000004, 0.1, 3, 12.5, 7] }],
  warnings: [],
  question: 'Total rain by month',
  dataset: 'Daily weather, Tokyo',
  vocab: WEATHER_VOCABULARY,
  queryPlan: {
    chartType: 'bar',
    groupBy: 'month',
    aggregate: { field: 'precipitation_mm', fn: 'sum' },
    title: 'Total rain by month',
    explanation: '',
  },
}

describe('resultToCsv', () => {
  it('writes a header in plain words and one row per group', () => {
    const lines = resultToCsv(RESULT).split('\r\n')
    expect(lines[0]).toBe('month,total rain (mm)')
    expect(lines[1]).toBe('2025-10,54')
    expect(lines[2]).toBe('"Mexico, north",0.1')
  })

  it('writes text that a spreadsheet would run as a formula as plain text, and keeps real negative numbers', () => {
    const lines = resultToCsv(RESULT).split('\r\n')
    expect(lines[3]).toBe("'=SUM(A1),3")
    expect(lines[4]).toBe('-4,12.5')
    expect(lines[5]).toBe("'-abc,7")
  })

  it('names the count measure after the rows of the dataset', () => {
    const count = { ...RESULT, queryPlan: { ...RESULT.queryPlan, aggregate: { field: 'date', fn: 'count' as const } } }
    expect(resultToCsv(count).split('\r\n')[0]).toBe('month,number of days')
  })
})

describe('fileSlug', () => {
  it('makes a short file name from a chart title', () => {
    expect(fileSlug('Total rain (mm) by month, 2025/26!')).toBe('total-rain-mm-by-month-2025-26')
    expect(fileSlug('???')).toBe('datapilot-result')
    expect(fileSlug('Average daily high temperature by month (stand-in for wind speed)')).toBe(
      'average-daily-high-temperature-by-month-stand-in-for-wind-speed',
    )
    expect(fileSlug(`${'word '.repeat(30)}`)).toBe(Array(16).fill('word').join('-'))
  })
})
