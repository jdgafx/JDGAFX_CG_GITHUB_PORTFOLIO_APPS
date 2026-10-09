import { describe, expect, it } from 'vitest'
import { followUpIdeas } from '../../src/lib/followUps'
import { EARTHQUAKE_VOCABULARY, WEATHER_VOCABULARY } from '../../src/lib/vocabulary'
import type { AnalysisResult } from '../../src/types'

const HEADERS = ['time', 'mag', 'magType', 'place', 'region', 'type']

const BASE: AnalysisResult = {
  labels: ['Alaska', 'Nevada', 'Fiji', 'Chile', 'Utah', 'Texas', 'Peru'],
  datasets: [{ name: 'id', values: [600, 120, 90, 80, 70, 60, 50] }],
  warnings: [],
  question: 'Which region had the most earthquakes?',
  dataset: 'Earthquakes, past 7 days',
  vocab: EARTHQUAKE_VOCABULARY,
  queryPlan: { chartType: 'bar', groupBy: 'region', aggregate: { field: 'id', fn: 'count' }, title: 't', explanation: '' },
}

describe('followUpIdeas', () => {
  it('offers a filter on the leading group, a limit, a new grouping and the other chart', () => {
    expect(followUpIdeas(BASE, HEADERS)).toEqual(['Only Alaska', 'Show the top 5', 'Now by magnitude type', 'As a line chart'])
  })

  it('says bottom when the plan ranks the lowest first, and drops the limit once one is set', () => {
    const lowest = { ...BASE, queryPlan: { ...BASE.queryPlan, sortBy: { field: 'id', dir: 'asc' as const } } }
    expect(followUpIdeas(lowest, HEADERS)).toContain('Show the bottom 5')
    const limited = { ...BASE, queryPlan: { ...BASE.queryPlan, limit: 5 } }
    expect(followUpIdeas(limited, HEADERS).some((idea) => idea.startsWith('Show the'))).toBe(false)
  })

  it('does not offer the grouping it already has, and offers a bar chart after a line chart', () => {
    const line = { ...BASE, labels: ['2026-01', '2026-02', '2026-03'], queryPlan: { ...BASE.queryPlan, groupBy: 'magType', chartType: 'line' as const } }
    const ideas = followUpIdeas(line, HEADERS)
    expect(ideas).toContain('Now by region')
    expect(ideas).not.toContain('Now by magnitude type')
    expect(ideas).toContain('As a bar chart')
  })

  it('offers no filter when the first group is blank', () => {
    expect(followUpIdeas({ ...BASE, labels: ['(blank)', 'A'] }, HEADERS)[0]).not.toMatch(/^Only/)
  })
})

describe('followUpIdeas: dataset words and pies', () => {
  const WEATHER: AnalysisResult = {
    labels: ['2025-10', '2025-11', '2025-12'],
    datasets: [{ name: 'precipitation_mm', values: [160, 23, 42] }],
    warnings: [],
    question: 'Total rain by month',
    dataset: 'Daily weather, Tokyo',
    vocab: WEATHER_VOCABULARY,
    queryPlan: { chartType: 'pie', groupBy: 'month', aggregate: { field: 'precipitation_mm', fn: 'sum' }, title: 't', explanation: '' },
  }

  it('offers a month the way people say it', () => {
    expect(followUpIdeas(WEATHER, ['date', 'month'])[0]).toBe('Only October 2025')
  })

  it('offers the bar chart on a calm pie, but not on a crowded pie that already offers it', () => {
    expect(followUpIdeas(WEATHER, ['date', 'month'])).toContain('As a bar chart')
    const many = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
    const crowded = { ...WEATHER, labels: many, datasets: [{ name: 'p', values: many.map((_, i) => 12 - i) }] }
    expect(followUpIdeas(crowded, ['date', 'month'])).not.toContain('As a bar chart')
  })
})

describe('followUpIdeas: a line over unordered names', () => {
  it('does not offer the bar chart twice, because the chart already offers it', () => {
    const line = { ...BASE, queryPlan: { ...BASE.queryPlan, chartType: 'line' as const } }
    expect(followUpIdeas(line, HEADERS)).not.toContain('As a bar chart')
  })
})
