import { describe, expect, it } from 'vitest'
import { followUpIdeas } from '../../src/lib/followUps'
import { EARTHQUAKE_VOCABULARY } from '../../src/lib/vocabulary'
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
    const line = { ...BASE, queryPlan: { ...BASE.queryPlan, groupBy: 'magType', chartType: 'line' as const } }
    const ideas = followUpIdeas(line, HEADERS)
    expect(ideas).toContain('Now by region')
    expect(ideas).not.toContain('Now by magnitude type')
    expect(ideas).toContain('As a bar chart')
  })

  it('offers no filter when the first group is blank', () => {
    expect(followUpIdeas({ ...BASE, labels: ['(blank)', 'A'] }, HEADERS)[0]).not.toMatch(/^Only/)
  })
})
