import { afterEach, describe, expect, it, vi } from 'vitest'
import { headlineFor } from '../../src/lib/answer'
import { planAndRun } from '../../src/lib/analysis'
import { OVERALL_LABEL } from '../../src/lib/dataEngine'
import { parseEarthquakeCsv } from '../../src/lib/liveData/parse'
import { validateQueryPlan } from '../../src/lib/queryPlan'
import { asksForTotal, resolveCountColumn, unknownNoun, type QuestionNouns } from '../../src/lib/questionNouns'
import { EARTHQUAKE_VOCABULARY, labelFor } from '../../src/lib/vocabulary'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'
import type { ParsedData } from '../../src/types'

// The plans below are the ones the deployed model returned for these questions (replayed from the recorded replies,
// with no model call). Each one produced a wrong headline before the count column and the noun check.
const week = parseEarthquakeCsv(USGS_WEEK_EXCERPT)
const SIGNAL = new AbortController().signal
const NAMES: QuestionNouns = {
  rowNoun: EARTHQUAKE_VOCABULARY.rowNoun,
  nouns: week.headers.flatMap((header) => [header, labelFor(EARTHQUAKE_VOCABULARY, header)]),
  columns: week.headers.map((header) => ({ header, label: labelFor(EARTHQUAKE_VOCABULARY, header) })),
}
const BASE = { chartType: 'bar', title: 'T', explanation: 'E' }
const MAG_FILTER = { field: 'mag', op: 'gte', value: '4.5' }
const BY_REGION_COUNT = { ...BASE, groupBy: 'region', aggregate: { field: 'id', fn: 'count' }, sortBy: { field: 'region', dir: 'asc' } }

afterEach(() => vi.unstubAllGlobals())

async function run(question: string, plan: Record<string, unknown>, data: ParsedData = week) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: plan, trace: [], usage: {}, model: 'm', totalMs: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  const out = await planAndRun({ question, data, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY }, SIGNAL)
  if (out.kind !== 'done') throw new Error(`expected done, got ${out.kind}`)
  return out.result
}

const magAtLeast = week.rows.filter((row) => Number(row.mag) >= 4.5).length

describe('a magnitude threshold written "4.5+" counts the earthquakes, not the magnitudes (t2, p2)', () => {
  const plan = { ...BASE, groupBy: 'region', aggregate: { field: 'mag', fn: 'count' }, filter: MAG_FILTER, sortBy: null, limit: null }

  it.each([
    'How many magnitude 4.5+ earthquakes were there in total?',
    'How many magnitude 4.5+ quakes were there?',
  ])('%s', async (question) => {
    expect(asksForTotal(question, NAMES)).toBe(true)
    const result = await run(question, { ...plan, overall: true })
    expect(result.labels).toEqual([OVERALL_LABEL])
    expect(headlineFor(result).answer).toBe(`${magAtLeast} earthquakes where magnitude is at least 4.5.`)
  })
})

describe('a verb ends the counted phrase, so a noun the data lacks is not read as the rows (n6, n8, n9)', () => {
  const regions = new Set(week.rows.map((row) => row.region)).size

  it.each([
    ['In total, how many states recorded earthquakes?', 'states', 'The dataset has no state column, so the region column was used as the closest available grouping for states.'],
    ['How many countries experienced earthquakes?', 'countries', 'The dataset has no country column, so the region column was used as the closest available grouping.'],
    ['How many US states reported earthquakes?', 'states', 'The dataset has no state column, so the region column was used instead and regions may not match US states.'],
  ])('%s', async (question, noun, notice) => {
    expect(unknownNoun(question, NAMES)).toBe(noun)
    expect(asksForTotal(question, NAMES)).toBe(false)
    const result = await run(question, { ...BY_REGION_COUNT, missing: [noun], notice, overall: null })
    const headline = headlineFor(result)
    expect(headline.answer).toBe(`${regions} regions.`)
    expect(headline.answer).not.toMatch(/in total/)
    expect(headline.notice).toBe(notice)
    expect(headline.substitute).toBe(true)
  })

  it('keeps a speed or a feed in the counted phrase, which only look like verbs', () => {
    expect(unknownNoun('How many wind speed readings were there?', NAMES)).toBe('readings')
  })
})

describe('a noun the data lacks gets a missing-noun notice and no invented filter (t6)', () => {
  const tremors = {
    ...BASE,
    groupBy: 'type',
    aggregate: { field: 'id', fn: 'count' },
    filter: { field: 'type', op: 'eq', value: 'tremor' },
    overall: true,
  }

  it('drops the filter the model made up from the noun, when the model sent no count column', async () => {
    const result = await run('In total, how many tremors were recorded?', tremors)
    expect(result.queryPlan.filter).toBeUndefined()
    expect(result.queryPlan.missing).toEqual(['tremors'])
    const headline = headlineFor(result)
    expect(headline.notice).toBe('The data has no column for tremors, so the chart groups by event type instead.')
    expect(headline.answer).toBe(`${new Set(week.rows.map((row) => row.type)).size} event types.`)
  })

  it('does the same when the model names the noun in the count column, and replaces a notice that describes the dropped filter', async () => {
    const notice = 'The count filters the type column for tremor records.'
    const result = await run('In total, how many tremors were recorded?', { ...tremors, countColumn: 'tremors', notice })
    expect(result.queryPlan.filter).toBeUndefined()
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(headlineFor(result).notice).toBe('The data has no column for tremors, so the chart groups by event type instead.')
  })

  it('drops a filter the model made up even when it chose rows', async () => {
    const result = await run('In total, how many tremors were recorded?', { ...tremors, countColumn: 'rows' })
    expect(result.queryPlan.filter).toBeUndefined()
    expect(result.queryPlan.missing).toEqual(['tremors'])
  })

  it('keeps a filter the question states', async () => {
    const result = await run('How many earthquakes in total had magnitude 4.5 or greater?', { ...tremors, countColumn: 'rows', filter: MAG_FILTER })
    expect(result.queryPlan.filter).toEqual(MAG_FILTER)
    expect(result.queryPlan.missing).toBeUndefined()
  })
})

describe('a count of a noun the data lacks always gets a notice, but "kinds" is the type column', () => {
  it('adds a notice and missing to a bare count of countries grouped by region, with no model notice', async () => {
    const result = await run('How many countries had earthquakes?', BY_REGION_COUNT)
    const headline = headlineFor(result)
    expect(result.queryPlan.missing).toEqual(['countries'])
    expect(headline.notice).toBe('The data has no column for countries, so the chart groups by region instead.')
    expect(headline.answer).toBe(`${new Set(week.rows.map((row) => row.region)).size} regions.`)
  })

  it('leaves a plan alone when the model already listed what is missing', async () => {
    const notice = 'There is no country column.'
    const result = await run('How many countries had earthquakes?', { ...BY_REGION_COUNT, missing: ['countries'], notice })
    expect(headlineFor(result).notice).toBe(notice)
  })

  it('gives "how many kinds of events were recorded" no notice, since kinds are the event types', async () => {
    const question = 'How many kinds of events were recorded?'
    expect(unknownNoun(question, NAMES)).toBeNull()
    const result = await run(question, { ...BASE, groupBy: 'type', aggregate: { field: 'type', fn: 'count' }, sortBy: { field: 'type', dir: 'desc' } })
    const headline = headlineFor(result)
    expect(result.queryPlan.missing).toBeUndefined()
    expect(headline.notice).toBeNull()
    expect(headline.answer).toBe(`${new Set(week.rows.map((row) => row.type)).size} event types.`)
  })
})

describe('resolveCountColumn checks the model choice against the columns and the row words', () => {
  it.each([
    ['rows', { kind: 'rows' }],
    ['earthquakes', { kind: 'rows' }],
    ['quakes', { kind: 'rows' }],
    ['region', { kind: 'column', header: 'region' }],
    ['regions', { kind: 'column', header: 'region' }],
    ['magType', { kind: 'column', header: 'magType' }],
    ['earthquake types', { kind: 'column', header: 'type' }],
    ['event type', { kind: 'column', header: 'type' }],
    ['kinds', { kind: 'column', header: 'type' }],
    ['tremors', { kind: 'unknown', noun: 'tremors' }],
    ['countries', { kind: 'unknown', noun: 'countries' }],
  ])('%s', (value, expected) => {
    expect(resolveCountColumn(value, NAMES)).toEqual(expected)
  })
})

describe('the count column the model chose, applied to the plan', () => {
  it('counts the groups of the column it names, whatever grouping column it picked', async () => {
    const result = await run('How many regions had earthquakes?', { ...BASE, groupBy: 'id', aggregate: { field: 'id', fn: 'count' }, countColumn: 'region' })
    expect(result.queryPlan.countColumn).toBe('region')
    expect(result.queryPlan.groupBy).toBe('region')
    expect(headlineFor(result).answer).toBe(`${new Set(week.rows.map((row) => row.region)).size} regions.`)
  })

  it('counts the rows for a word for the rows, with the filter kept', async () => {
    const result = await run('How many quakes had magnitude 4.5 or greater?', {
      ...BASE,
      groupBy: 'region',
      aggregate: { field: 'mag', fn: 'count' },
      filter: MAG_FILTER,
      countColumn: 'quakes',
    })
    expect(result.queryPlan.countColumn).toBe('rows')
    expect(headlineFor(result).answer).toBe(`${magAtLeast} earthquakes where magnitude is at least 4.5.`)
  })

  it('still says the data has no cities when the model maps them to the place column without a notice (live n3)', async () => {
    const result = await run('How many cities had earthquakes?', {
      ...BASE,
      groupBy: 'place',
      aggregate: { field: 'id', fn: 'count' },
      countColumn: 'place',
      sortBy: { field: 'id', dir: 'desc' },
    })
    const headline = headlineFor(result)
    expect(result.queryPlan.groupBy).toBe('place')
    expect(result.queryPlan.missing).toEqual(['cities'])
    expect(headline.notice).toBe('The data has no column for cities, so the chart groups by place instead.')
    expect(headline.answer).toMatch(/^\d+ places\.$/)
  })

  it('ranks the fewest by the count when the model counts the grouping column itself (live r4)', async () => {
    const result = await run('Which event type had the fewest events?', {
      ...BASE,
      groupBy: 'type',
      aggregate: { field: 'type', fn: 'count' },
      countColumn: 'type',
      sortBy: { field: 'type', dir: 'asc' },
    })
    const counts = new Map<string, number>()
    for (const row of week.rows) counts.set(row.type ?? '', (counts.get(row.type ?? '') ?? 0) + 1)
    const fewest = Math.min(...counts.values())
    expect(headlineFor(result).answer).toMatch(new RegExp(`has the lowest number of earthquakes: ${fewest}\\.$`))
  })

  it('does not make a total of a ranking, whatever the model chose', async () => {
    const result = await run('Which region had the most earthquakes?', { ...BY_REGION_COUNT, countColumn: 'rows' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.labels.length).toBeGreaterThan(1)
  })

  it('reads the question when the count column is null, as for a model that sent none', async () => {
    const result = await run('How many earthquakes were there in total?', { ...BASE, groupBy: 'region', aggregate: { field: 'id', fn: 'count' }, countColumn: null })
    expect(result.queryPlan.countColumn).toBe('rows')
    expect(headlineFor(result).answer).toBe(`${week.rows.length} earthquakes in total.`)
  })
})

describe('validateQueryPlan and the count column', () => {
  const plan = { ...BASE, groupBy: 'region', aggregate: { field: 'id', fn: 'count' } }

  it('keeps the count column the model chose, and ignores a null one and the old overall flag', () => {
    expect(validateQueryPlan({ ...plan, countColumn: 'region' }, week.headers)).toMatchObject({ ok: true, plan: { countColumn: 'region' } })
    const none = validateQueryPlan({ ...plan, countColumn: null, overall: true }, week.headers)
    expect(none.ok && none.plan.countColumn).toBeFalsy()
    expect(none.ok && 'overall' in none.plan).toBe(false)
  })

  it('makes "rows" one bar and accepts a missing group column', () => {
    const checked = validateQueryPlan({ ...plan, groupBy: undefined, chartType: 'line', countColumn: 'rows', limit: 3, sortBy: null }, week.headers)
    expect(checked.ok && checked.plan).toMatchObject({ countColumn: 'rows', chartType: 'bar' })
    expect(checked.ok && checked.plan.limit).toBeUndefined()
  })
})

// The row counts of the live all-week feed the question was tried on: 1,971 rows, with these places among them.
const PLACES: Array<[string, number]> = [['Alaska', 629], ['California', 593], ['Texas', 105], ['Hawaii', 96], ['Japan', 10], ['Panama', 538]]
const feed: ParsedData = {
  headers: ['id', 'region', 'type', 'mag'],
  // Four of the Alaska rows are quarry blasts, so a made-up "type is earthquake" test would count 625, not 629.
  rows: PLACES.flatMap(([region, count]) =>
    Array.from({ length: count }, (_, i) => ({ id: `${region}${i}`, region, type: region === 'Alaska' && i < 4 ? 'quarry blast' : 'earthquake', mag: '2.5' })),
  ),
}
const regionIs = (value: string) => ({ field: 'region', op: 'eq', value })
const feedPlan = (filter: Record<string, string>, countColumn: string | null = 'rows') => ({
  ...BASE,
  groupBy: 'region',
  aggregate: { field: 'id', fn: 'count' },
  filter,
  countColumn,
})

describe('a place name in the question is a value the rows hold, not a noun the data lacks', () => {
  it('has the row counts the question is checked against', () => {
    expect(feed.rows.length).toBe(1971)
  })

  it.each([
    ['How many earthquakes were recorded in Hawaii?', 'Hawaii', 96],
    ['How many earthquakes were recorded in Alaska?', 'Alaska', 629],
    ['How many earthquakes hit Japan this week?', 'Japan', 10],
    ['How many earthquakes struck Hawaii this week?', 'Hawaii', 96],
  ])('%s', async (question, place, count) => {
    const result = await run(question, feedPlan(regionIs(place)), feed)
    expect(result.queryPlan.filter).toEqual(regionIs(place))
    expect(result.queryPlan.missing).toBeUndefined()
    expect(result.labels).toEqual([OVERALL_LABEL])
    const headline = headlineFor(result)
    expect(headline.notice).toBeNull()
    expect(headline.answer).toBe(`${count} earthquakes where region is ${place}.`)
  })

  it('keeps the place filter when the model sent no count column', async () => {
    const result = await run('How many earthquakes hit Japan this week?', feedPlan(regionIs('Japan'), null), feed)
    expect(result.queryPlan.filter).toEqual(regionIs('Japan'))
    expect(result.queryPlan.missing).toBeUndefined()
    expect(headlineFor(result).notice).toBeNull()
    expect(headlineFor(result).answer).toBe('10 earthquakes where region is Japan.')
  })

  it('counts the rows for a place with a verb the word list does not know, when the model sent no count column', async () => {
    const result = await run('How many earthquakes struck California this week?', feedPlan(regionIs('California'), null), feed)
    expect(result.labels).toEqual([OVERALL_LABEL])
    expect(headlineFor(result).answer).toBe('593 earthquakes where region is California.')
  })

  it('drops a missing item that is the place the filter finds, as the live model listed "Japan"', async () => {
    const live = {
      ...feedPlan({ field: 'region', op: 'contains', value: 'Japan' }, null),
      missing: ['Japan'],
      notice: 'The dataset has no country column; the region column was filtered for the text Japan.',
    }
    const result = await run('How many earthquakes hit Japan this week?', live, feed)
    const headline = headlineFor(result)
    expect(result.queryPlan.missing).toBeUndefined()
    expect(headline.substitute).toBe(false)
    expect(headline.answer).toBe('10 earthquakes where region contains Japan.')
  })

  it('does not read "this week" as a noun the data lacks', () => {
    expect(unknownNoun('How many earthquakes were recorded this week?', NAMES)).toBeNull()
    expect(unknownNoun('How many earthquakes hit Japan this week?', NAMES)).toBe('japan')
    expect(asksForTotal('How many earthquakes were recorded this week?', NAMES)).toBe(true)
  })

  it('drops a filter for a value that matches no row, as for "tremors"', async () => {
    const tremor = { field: 'type', op: 'eq', value: 'tremor' }
    for (const countColumn of ['rows', null]) {
      const result = await run('In total, how many tremors were recorded?', feedPlan(tremor, countColumn), feed)
      expect(result.queryPlan.filter, String(countColumn)).toBeUndefined()
      expect(result.queryPlan.missing, String(countColumn)).toEqual(['tremors'])
    }
  })
})

describe('a place that finds no row is still the place the question stated', () => {
  const iran = regionIs('Iran')

  it.each(['rows', null])('"How many earthquakes hit Iran this week?" is 0 earthquakes, with count column %s', async (countColumn) => {
    const result = await run('How many earthquakes hit Iran this week?', feedPlan(iran, countColumn), feed)
    expect(result.queryPlan.filter).toEqual(iran)
    expect(result.queryPlan.missing).toBeUndefined()
    const headline = headlineFor(result)
    expect(headline.notice).toBeNull()
    expect(headline.answer).toBe('0 earthquakes where region is Iran.')
  })

  it('drops the missing item the model made for Iran', async () => {
    const live = { ...feedPlan(iran, 'rows'), missing: ['Iran'], notice: 'The dataset has no country column.' }
    const result = await run('How many earthquakes hit Iran this week?', live, feed)
    expect(headlineFor(result).substitute).toBe(false)
    expect(headlineFor(result).answer).toBe('0 earthquakes where region is Iran.')
  })
})

describe('a filter that only restates the row noun is not applied', () => {
  const typeIs = (value: string) => ({ field: 'type', op: 'eq', value })

  it('counts every row for "how many earthquakes were there in total" (live cc6)', async () => {
    const result = await run('How many earthquakes were there in total?', { ...BASE, groupBy: 'type', aggregate: { field: 'id', fn: 'count' }, filter: typeIs('earthquake'), countColumn: 'rows' }, feed)
    expect(result.queryPlan.filter).toBeUndefined()
    expect(headlineFor(result).answer).toBe('1,971 earthquakes in total.')
  })

  it('gives Alaska 629 for the top regions, not 625 (live r5)', async () => {
    const result = await run(
      'What are the top 3 regions by number of earthquakes?',
      { ...BASE, groupBy: 'region', aggregate: { field: 'id', fn: 'count' }, filter: typeIs('earthquake'), countColumn: 'region', sortBy: { field: 'id', dir: 'desc' }, limit: 3 },
      feed,
    )
    expect(result.queryPlan.filter).toBeUndefined()
    expect(headlineFor(result).answer).toBe('Top 3 of 6 regions by number of earthquakes: Alaska (629), California (593), Panama (538).')
  })

  it('leaves the clause out of the magnitude and depth headlines (live a, t4)', async () => {
    for (const [question, filter, words] of [
      ['In total, how many earthquakes had magnitude 4.5 or greater?', MAG_FILTER, 'magnitude is at least 4.5'],
      ['How many earthquakes in total were deeper than 100 km?', { field: 'depth', op: 'gt', value: '100' }, 'depth is greater than 100 km'],
    ] as const) {
      const result = await run(question, { ...BASE, groupBy: 'region', aggregate: { field: 'id', fn: 'count' }, filter, moreFilters: [typeIs('earthquake')], countColumn: 'rows' })
      expect(headlineFor(result).answer, question).toMatch(new RegExp(`^\\d+ earthquakes where ${words}\\.$`))
    }
  })

  it('keeps the test when the question names another kind of event', async () => {
    const result = await run('How many quarry blast events were recorded?', { ...BASE, groupBy: 'type', aggregate: { field: 'id', fn: 'count' }, filter: typeIs('quarry blast'), countColumn: 'rows' }, feed)
    expect(result.queryPlan.filter).toEqual(typeIs('quarry blast'))
    expect(headlineFor(result).answer).toBe('4 earthquakes where event type is quarry blast.')
  })

  it('names the test a ranking applied in its headline', async () => {
    const result = await run('Which region had the most earthquakes of magnitude 4.5 or greater?', {
      ...BASE,
      groupBy: 'region',
      aggregate: { field: 'id', fn: 'count' },
      filter: MAG_FILTER,
      sortBy: { field: 'id', dir: 'desc' },
    })
    expect(headlineFor(result).answer).toMatch(/ has the highest number of earthquakes where magnitude is at least 4\.5: \d+\.$/)
  })
})

describe('the row-noun filter guards', () => {
  const typeIs = (value: string) => ({ field: 'type', op: 'eq', value })
  const plan = (filter: Record<string, string>, countColumn: string | null) => ({
    ...BASE,
    groupBy: 'type',
    aggregate: { field: 'id', fn: 'count' },
    filter,
    countColumn,
  })

  it.each([
    'How many events were earthquakes?',
    'How many events had event type earthquake?',
  ])('keeps "type is earthquake" when the question does not count the row noun itself: %s', async (question) => {
    const result = await run(question, plan(typeIs('earthquake'), 'rows'), feed)
    expect(result.queryPlan.filter).toEqual(typeIs('earthquake'))
    expect(headlineFor(result).answer).toBe('1,967 earthquakes where event type is earthquake.')
  })

  it('still drops it when the question counts "quakes"', async () => {
    const result = await run('How many quakes were there in total?', plan(typeIs('earthquake'), 'rows'), feed)
    expect(result.queryPlan.filter).toBeUndefined()
    expect(headlineFor(result).answer).toBe('1,971 earthquakes in total.')
  })

  it.each(['rows', null])('"earthquake aftershocks" is a noun the data lacks, not 0 earthquakes (count column %s)', async (countColumn) => {
    const result = await run('How many earthquake aftershocks were there?', plan(typeIs('aftershock'), countColumn), feed)
    expect(result.queryPlan.filter).toBeUndefined()
    expect(result.queryPlan.missing).toEqual(['aftershocks'])
    const headline = headlineFor(result)
    expect(headline.notice).toMatch(/^The data has no column for aftershocks/)
    expect(headline.answer).not.toMatch(/^0 earthquakes/)
  })

  it('keeps "earthquakes hit Iran" at a gap of two words', async () => {
    const result = await run('How many earthquakes hit Iran this week?', plan(regionIs('Iran'), 'rows'), feed)
    expect(result.queryPlan.filter).toEqual(regionIs('Iran'))
    expect(headlineFor(result).answer).toBe('0 earthquakes where region is Iran.')
  })
})
