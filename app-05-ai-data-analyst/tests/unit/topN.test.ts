import { afterEach, describe, expect, it, vi } from 'vitest'
import { headlineFor } from '../../src/lib/answer'
import { planAndRun } from '../../src/lib/analysis'
import { parseEarthquakeCsv } from '../../src/lib/liveData/parse'
import { applyQuestionLimit, MAX_LIMIT } from '../../src/lib/queryPlan'
import { askedLimit } from '../../src/lib/rankedCount'
import { EARTHQUAKE_VOCABULARY } from '../../src/lib/vocabulary'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'
import type { AnalysisResult, ParsedData, QueryPlan } from '../../src/types'

// The plans below are replies the deployed model returned (recorded from the browser run of 2026-10-10 and from live probes
// the same day), replayed with no model call. The model left `limit` out of "Top 3 regions", and the browser only ever took
// a limit away, so all 74 regions were drawn. These tests run the whole planAndRun path on the recorded rows.
const week = parseEarthquakeCsv(USGS_WEEK_EXCERPT)
const SIGNAL = new AbortController().signal
const BY_REGION = { chartType: 'bar', groupBy: 'region', aggregate: { field: 'id', fn: 'count' } }

/** The reply for "Top 3 regions": no limit, no sort, and countColumn "rows" (the browser takes the total back). */
const TOP_3_NO_LIMIT = {
  ...BY_REGION,
  title: 'Top 3 Regions by Number of Earthquakes',
  explanation: 'Counts the earthquake records in each region and shows the three regions with the most events, ranked from highest to lowest.',
  countColumn: 'rows',
}
/** The reply for "What are the top 3 regions?": it carries the limit itself. */
const TOP_3_WITH_LIMIT = {
  ...BY_REGION,
  title: 'Top 3 Regions by Number of Earthquakes',
  explanation: 'Counts the earthquake records in each region and shows the three regions with the most records.',
  countColumn: 'region',
  sortBy: { field: 'id', dir: 'desc' },
  limit: 3,
}
/** The reply for "bottom 3 regions": the model counted rows and set neither a sort nor a limit. */
const BOTTOM_3_NO_LIMIT = {
  chartType: 'bar',
  groupBy: 'region',
  aggregate: { field: 'region', fn: 'count' },
  title: 'Bottom 3 Regions by Number of Earthquakes',
  explanation: 'Counts the earthquake records in each region and shows the three regions with the fewest records, sorted ascending.',
  countColumn: 'rows',
}
/** The reply for "first 5 magnitude types": a limit of 5 already, sorted by the group name. */
const FIRST_5_WITH_LIMIT = {
  chartType: 'bar',
  groupBy: 'magType',
  aggregate: { field: 'magType', fn: 'count' },
  title: 'First 5 Magnitude Types',
  explanation: 'Shows the first five magnitude types with the number of records for each.',
  countColumn: 'magType',
  sortBy: { field: 'magType', dir: 'asc' },
  limit: 5,
}

afterEach(() => vi.unstubAllGlobals())

async function run(question: string, plan: Record<string, unknown>, previous?: AnalysisResult, data: ParsedData = week) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: plan, trace: [], usage: {}, model: 'm', totalMs: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  const out = await planAndRun({ question, data, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY, ...(previous ? { previous } : {}) }, SIGNAL)
  if (out.kind !== 'done') throw new Error(`expected done, got ${out.kind}`)
  return out
}

/** The region counts counted straight from the recorded rows, largest first, ties in file order. */
function regionCounts(): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const row of week.rows) counts.set(row.region ?? '', (counts.get(row.region ?? '') ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

describe('"Top 3 regions" with a plan that has no limit', () => {
  it('keeps three groups, the three largest, and says so in the headline', async () => {
    const { result } = await run('Top 3 regions', TOP_3_NO_LIMIT)
    const all = regionCounts()
    expect(all.length).toBeGreaterThan(3)
    expect(result.queryPlan.limit).toBe(3)
    expect(result.queryPlan.sortBy).toEqual({ field: 'id', dir: 'desc' })
    expect(result.labels).toEqual(all.slice(0, 3).map(([label]) => label))
    expect(result.datasets[0]?.values).toEqual(all.slice(0, 3).map(([, count]) => count))
    expect(result.limited?.total).toBe(all.length)
    const top = all
      .slice(0, 3)
      .map(([label, count]) => `${label} (${count})`)
      .join(', ')
    expect(headlineFor(result).answer).toBe(`Top 3 of ${all.length} regions by number of earthquakes: ${top}.`)
  })

  it('does the same for a follow-up that asks for the top 5 and comes back without a limit', async () => {
    const first = await run('Which region had the most earthquakes?', { ...BY_REGION, title: 'Earthquakes by region', explanation: '' })
    const { result, changes } = await run('show the top 5', { ...BY_REGION, title: 'Top 5 Regions by Number of Earthquakes', explanation: '' }, first.result)
    expect(result.queryPlan.limit).toBe(5)
    expect(result.labels).toHaveLength(5)
    expect(changes.some((change) => change.kind === 'limit')).toBe(true)
  })

  it('draws every group when the question names no count', async () => {
    const { result } = await run('Which region had the most earthquakes?', { ...BY_REGION, title: 'Earthquakes by region', explanation: '' })
    expect(result.queryPlan.limit).toBeUndefined()
    expect(result.labels).toHaveLength(regionCounts().length)
  })
})

describe('the question that already worked keeps working', () => {
  it('"What are the top 3 regions?" gives the same three groups and headline when the model sets the limit', async () => {
    const withLimit = await run('What are the top 3 regions?', TOP_3_WITH_LIMIT)
    const without = await run('Top 3 regions', TOP_3_NO_LIMIT)
    expect(withLimit.result.labels).toEqual(without.result.labels)
    expect(headlineFor(withLimit.result).answer).toBe(headlineFor(without.result).answer)
    expect(withLimit.result.queryPlan.limit).toBe(3)
  })

  it('leaves a limit the model set alone, even when the sort is by the group name', async () => {
    const { result } = await run('first 5 magnitude types', FIRST_5_WITH_LIMIT)
    expect(result.queryPlan.limit).toBe(5)
    expect(result.queryPlan.sortBy).toEqual({ field: 'magType', dir: 'asc' })
  })
})

describe('"bottom N" and "last N" keep the lowest groups', () => {
  it('keeps the three smallest regions, ascending, and the headline says Bottom 3', async () => {
    const { result } = await run('bottom 3 regions', BOTTOM_3_NO_LIMIT)
    const all = regionCounts()
    const lowest = [...all].sort((a, b) => a[1] - b[1])
    expect(result.queryPlan.limit).toBe(3)
    expect(result.queryPlan.sortBy?.dir).toBe('asc')
    expect(result.datasets[0]?.values).toEqual(lowest.slice(0, 3).map(([, count]) => count))
    expect(headlineFor(result).answer).toMatch(new RegExp(`^Bottom 3 of ${all.length} regions by number of earthquakes: `))
  })

  it('reads "last 2 regions" as the two lowest', async () => {
    const { result } = await run('last 2 regions', { ...BOTTOM_3_NO_LIMIT, title: 'Last 2 regions' })
    expect(result.queryPlan.limit).toBe(2)
    expect(result.queryPlan.sortBy?.dir).toBe('asc')
    expect(result.labels).toHaveLength(2)
  })

  it('ranks a limit the model set with no sort, so the groups kept are the lowest and not whichever came first', async () => {
    // The live model answered "last 2 regions" with limit 2, no sort and a stand-in notice; it kept the first two in file order.
    const { result } = await run('last 2 regions', { ...BOTTOM_3_NO_LIMIT, title: 'Last 2 regions', limit: 2 })
    const lowest = Math.min(...regionCounts().map(([, count]) => count))
    expect(result.queryPlan.sortBy).toEqual({ field: 'count', dir: 'asc' })
    expect(result.datasets[0]?.values).toEqual([lowest, lowest])
    expect(headlineFor(result).answer).toMatch(/^Bottom 2 of \d+ regions /)
  })
})

describe('askedLimit', () => {
  it('reads digits and number words, and the end each word names', () => {
    expect(askedLimit('Top 3 regions')).toEqual({ count: 3, dir: 'desc' })
    expect(askedLimit('the top three regions')).toEqual({ count: 3, dir: 'desc' })
    expect(askedLimit('first 5 magnitude types')).toEqual({ count: 5, dir: 'desc' })
    expect(askedLimit('Bottom ten regions')).toEqual({ count: 10, dir: 'asc' })
    expect(askedLimit('last 2 months')).toBeNull()
    expect(askedLimit('last 4 regions')).toEqual({ count: 4, dir: 'asc' })
    expect(askedLimit('show the top-5')).toEqual({ count: 5, dir: 'desc' })
  })

  it('does not read a stretch of time as a number of groups', () => {
    expect(askedLimit('Which region had the most earthquakes in the last 7 days?')).toBeNull()
    expect(askedLimit('rain in the first 12 months')).toBeNull()
    expect(askedLimit('earthquakes in the last 24 hours by region')).toBeNull()
    expect(askedLimit('the last 2 weeks')).toBeNull()
  })

  it('returns nothing for no count or for both ends at once', () => {
    expect(askedLimit('Which region had the most earthquakes?')).toBeNull()
    expect(askedLimit('top 3 and bottom 3 regions')).toBeNull()
  })
})

describe('applyQuestionLimit leaves alone what a count cannot apply to', () => {
  const grouped: QueryPlan = { chartType: 'bar', groupBy: 'region', aggregate: { field: 'id', fn: 'count' }, title: 'T', explanation: '' }

  it('keeps a plan that has a limit and a sort, a total, or a line or area chart', () => {
    const limited = { ...grouped, limit: 7, sortBy: { field: 'region', dir: 'asc' as const } }
    expect(applyQuestionLimit(limited, 'top 3 regions')).toBe(limited)
    const total = { ...grouped, countColumn: 'rows' }
    expect(applyQuestionLimit(total, 'top 3 regions')).toBe(total)
    const line = { ...grouped, chartType: 'line' as const }
    expect(applyQuestionLimit(line, 'top 3 regions')).toBe(line)
    expect(applyQuestionLimit({ ...grouped, chartType: 'area' }, 'top 3 regions').limit).toBeUndefined()
  })

  it('ranks a model limit that has no sort, keeping the model count', () => {
    const unsorted = { ...grouped, limit: 7 }
    expect(applyQuestionLimit(unsorted, 'top 3 regions')).toEqual({ ...grouped, limit: 7, sortBy: { field: 'id', dir: 'desc' } })
    expect(applyQuestionLimit(unsorted, 'which region is first?')).toBe(unsorted)
  })

  it('replaces a sort by the group name, and keeps a value sort that already runs the right way', () => {
    const byName = { ...grouped, sortBy: { field: 'region', dir: 'asc' as const } }
    expect(applyQuestionLimit(byName, 'top 3 regions').sortBy).toEqual({ field: 'id', dir: 'desc' })
    const sorted = { ...grouped, sortBy: { field: 'id', dir: 'desc' as const } }
    expect(applyQuestionLimit(sorted, 'top 3 regions').sortBy).toBe(sorted.sortBy)
    expect(applyQuestionLimit(sorted, 'bottom 3 regions').sortBy).toEqual({ field: 'id', dir: 'asc' })
  })

  it('sets no limit for a count of zero or more than a plan may keep', () => {
    expect(applyQuestionLimit(grouped, 'top 0 regions')).toBe(grouped)
    expect(applyQuestionLimit(grouped, `top ${MAX_LIMIT + 1} regions`)).toBe(grouped)
    expect(applyQuestionLimit(grouped, `top ${MAX_LIMIT} regions`).limit).toBe(MAX_LIMIT)
  })

  it('sorts a count of the grouping column by "count"', () => {
    const counted = { ...grouped, aggregate: { field: 'region', fn: 'count' as const } }
    expect(applyQuestionLimit(counted, 'top 3').sortBy).toEqual({ field: 'count', dir: 'desc' })
  })
})
