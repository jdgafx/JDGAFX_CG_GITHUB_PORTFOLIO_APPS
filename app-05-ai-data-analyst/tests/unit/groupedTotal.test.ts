import { afterEach, describe, expect, it, vi } from 'vitest'
import { headlineFor } from '../../src/lib/answer'
import { planAndRun } from '../../src/lib/analysis'
import { OVERALL_LABEL } from '../../src/lib/dataEngine'
import { parseEarthquakeCsv } from '../../src/lib/liveData/parse'
import { applyCountColumn } from '../../src/lib/queryPlan'
import { asksForTotal, countsOtherThanRows, namedColumn, type QuestionNouns, unknownNoun } from '../../src/lib/questionNouns'
import { EARTHQUAKE_VOCABULARY, labelFor } from '../../src/lib/vocabulary'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'
import type { ParsedData, QueryPlan } from '../../src/types'

// A model that chose "rows" for countColumn on a question that counts groups. The grouping column it picked is
// a placeholder the validator accepts: the id column, or the first column when none is named.
const week = parseEarthquakeCsv(USGS_WEEK_EXCERPT)
const SIGNAL = new AbortController().signal
const NAMES: QuestionNouns = {
  rowNoun: EARTHQUAKE_VOCABULARY.rowNoun,
  nouns: week.headers.flatMap((header) => [header, labelFor(EARTHQUAKE_VOCABULARY, header)]),
  columns: week.headers.map((header) => ({ header, label: labelFor(EARTHQUAKE_VOCABULARY, header) })),
}
const OVERALL_MODEL: QueryPlan = {
  chartType: 'bar',
  groupBy: 'id',
  aggregate: { field: 'id', fn: 'count' },
  title: 'Earthquakes by region',
  explanation: '',
  countColumn: 'rows',
}

afterEach(() => vi.unstubAllGlobals())

function serve(plan: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: plan, trace: [], usage: {}, model: 'm', totalMs: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

async function runServed(question: string, plan: Record<string, unknown>) {
  serve(plan)
  const out = await planAndRun({ question, data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY }, SIGNAL)
  if (out.kind !== 'done') throw new Error(`expected done, got ${out.kind}`)
  return out.result
}

describe('a model total on a question that counts a group', () => {
  it.each(['id', 'time', 'mag', '*'])('groups "how many regions" by region, whatever column the model picked (%s)', async (groupBy) => {
    const result = await runServed('How many regions had earthquakes?', { ...OVERALL_MODEL, groupBy })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('region')
    expect(result.labels.length).toBe(9)
    expect(headlineFor(result).answer).toBe('9 regions.')
  })

  it('keeps the grouping the model chose for "per magnitude type", since a grouping names more than one column', async () => {
    const result = await runServed('How many earthquakes per magnitude type?', { ...OVERALL_MODEL, groupBy: 'magType' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('magType')
  })

  it('keeps a total for "how many strong earthquakes", since its head noun is the row noun', async () => {
    const result = await runServed('How many strong earthquakes were there?', { ...OVERALL_MODEL, groupBy: 'id' })
    expect(result.labels).toEqual([OVERALL_LABEL])
    expect(result.queryPlan.countColumn).toBe('rows')
    expect(headlineFor(result).answer).toBe('59 earthquakes in total.')
  })

  it('groups "which region had the most" by region when the model picked the id column', async () => {
    const result = await runServed('Which region had the most earthquakes?', { ...OVERALL_MODEL, groupBy: 'id' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('region')
    expect(result.labels.length).toBe(9)
  })

  it('groups "how many magnitude types" by the magnitude type column, not by a placeholder', async () => {
    const result = await runServed('How many magnitude types were there?', { ...OVERALL_MODEL, groupBy: 'id' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('magType')
    const types = new Set(week.rows.map((row) => row.magType)).size
    expect(result.labels.length).toBe(types)
    expect(headlineFor(result).answer).toBe(`${types} magnitude types.`)
  })

  it('groups "how many earthquake types" by the event type column the question counts', async () => {
    const result = await runServed('How many earthquake types were there?', { ...OVERALL_MODEL, groupBy: 'time' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('type')
    expect(result.labels.length).toBe(new Set(week.rows.map((row) => row.type)).size)
  })

  it('keeps the model grouping for a count of countries, which the data has no column for, and shows the notice the model served', async () => {
    const notice = 'The data has no column for countries, so the chart counts regions instead.'
    const result = await runServed('How many countries had earthquakes?', {
      ...OVERALL_MODEL,
      groupBy: 'region',
      aggregate: { field: 'id', fn: 'count' },
      missing: ['countries'],
      notice,
    })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.labels.length).toBe(9)
    const headline = headlineFor(result)
    expect(headline.substitute).toBe(true)
    expect(headline.notice).toBe(notice)
  })
})

describe('applyCountColumn on the words a question counts', () => {
  const total: QueryPlan = { ...OVERALL_MODEL, groupBy: 'region', countColumn: 'rows' }

  it('takes the total away from a count of an unknown noun, as well as a column or label', () => {
    for (const question of [
      'How many earthquake types were there?',
      'How many countries had earthquakes?',
      'In total, how many countries had earthquakes?',
      'In total, how many earthquake types were there?',
    ]) {
      expect(applyCountColumn(total, question, NAMES).countColumn, question).toBeUndefined()
    }
  })

  it('keeps the total for a count of the row noun, its plain words, or a noun that is not a group', () => {
    for (const question of [
      'How many earthquakes were there?',
      'How many quakes had magnitude 5 or greater?',
      'How many had magnitude 5 or greater?',
      'How many were above 4?',
      'How many from Alaska?',
      'How many strong earthquakes were there?',
      'How many Alaska earthquakes had magnitude 5 or greater?',
    ]) {
      expect(applyCountColumn(total, question, NAMES).countColumn, question).toBe('rows')
    }
  })

  it('keeps the total on a raw upload, where an unknown noun counts rows', () => {
    const raw: QuestionNouns = { rowNoun: 'rows', nouns: ['region', 'sales'] }
    const sales: QueryPlan = { ...total, groupBy: 'sales' }
    expect(applyCountColumn(sales, 'How many countries had sales?', raw).countColumn).toBe('rows')
  })

  it('names the column a question counts, and no column when two are named', () => {
    expect(namedColumn('How many earthquake types were there?', NAMES)).toBe('type')
    expect(namedColumn('How many magnitude types were there?', NAMES)).toBe('magType')
    expect(namedColumn('Which region had the most earthquakes?', NAMES)).toBe('region')
    expect(namedColumn('How many countries had earthquakes?', NAMES)).toBeNull()
    expect(namedColumn('Average magnitude by magType', NAMES)).toBeNull()
    expect(namedColumn('How many earthquakes per magnitude type?', NAMES)).toBeNull()
  })
})

// Counted from the recorded text, not from the parsed rows: mag is column 4 and no quoted field comes before it.
const rawMagAtLeast = (n: number) =>
  USGS_WEEK_EXCERPT.split('\n').slice(1).filter((line) => line.trim() !== '').filter((line) => Number(line.split(',')[4]) >= n).length

describe('explicit total wording does not make an unknown noun a total', () => {
  it('asks for groups, not a total, for "in total, how many countries" and "in total, how many earthquake types"', () => {
    for (const question of ['In total, how many countries had earthquakes?', 'In total, how many earthquake types were there?']) {
      expect(asksForTotal(question, NAMES), question).toBe(false)
    }
  })

  it('keeps a model total off a countries question, so the chart groups by the model grouping', async () => {
    const result = await runServed('In total, how many countries had earthquakes?', { ...OVERALL_MODEL, groupBy: 'region' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('region')
    expect(result.labels.length).toBe(9)
    expect(headlineFor(result).answer).toBe('9 regions.')
  })

  it('groups "in total, how many earthquake types" by the event type column, not as one total', async () => {
    const result = await runServed('In total, how many earthquake types were there?', { ...OVERALL_MODEL, groupBy: 'time' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('type')
    expect(result.labels.length).toBe(new Set(week.rows.map((row) => row.type)).size)
  })

  it('keeps "in total, how many earthquakes had magnitude 4.5 or greater" as one total, with the count from the raw text', async () => {
    const result = await runServed('In total, how many earthquakes had magnitude 4.5 or greater?', {
      ...OVERALL_MODEL,
      groupBy: 'id',
      filter: { field: 'mag', op: 'gte', value: '4.5' },
    })
    expect(result.labels).toEqual([OVERALL_LABEL])
    expect(result.queryPlan.countColumn).toBe('rows')
    expect(rawMagAtLeast(4.5)).toBe(20)
    expect(headlineFor(result).answer).toBe('20 earthquakes where magnitude is at least 4.5.')
  })
})

describe('the count of one or none reads in the singular or with zero', () => {
  const magTotal = (value: string) => ({ ...OVERALL_MODEL, filter: { field: 'mag', op: 'gte', value } })

  it('says "0 earthquakes" when no row passes the filter', async () => {
    const result = await runServed('How many earthquakes had magnitude 6.7 or greater?', magTotal('6.7'))
    expect(rawMagAtLeast(6.7)).toBe(0)
    expect(headlineFor(result).answer).toBe('0 earthquakes where magnitude is at least 6.7.')
  })

  it('says "1 earthquake" in the singular when one row passes the filter', async () => {
    const result = await runServed('How many earthquakes had magnitude 6.6 or greater?', magTotal('6.6'))
    expect(rawMagAtLeast(6.6)).toBe(1)
    expect(headlineFor(result).answer).toBe('1 earthquake where magnitude is at least 6.6.')
  })

  it('says "2 earthquakes" in the plural when two rows pass the filter', async () => {
    const result = await runServed('How many earthquakes had magnitude 5.3 or greater?', magTotal('5.3'))
    expect(rawMagAtLeast(5.3)).toBe(2)
    expect(headlineFor(result).answer).toBe('2 earthquakes where magnitude is at least 5.3.')
  })
})

describe('a question that counts a column name counts groups, even when the dataset calls its rows "items"', () => {
  const ITEMS: QuestionNouns = { rowNoun: 'rows', nouns: ['items', 'sales'] }
  // Two regions, three rows: the question "how many items" names the items column, so the headline counts the groups.
  const sales: ParsedData = {
    headers: ['region', 'items'],
    rows: [
      { region: 'Alaska', items: '3' },
      { region: 'Utah', items: '5' },
      { region: 'Utah', items: '1' },
    ],
  }

  it('reads "how many items were there?" as a count of groups, not of rows', () => {
    expect(countsOtherThanRows('How many items were there?', ITEMS)).toBe(true)
    expect(asksForTotal('How many items were there?', ITEMS)).toBe(false)
  })

  it('states the group count in the headline when the result carries the column names', async () => {
    serve({ chartType: 'bar', groupBy: 'region', aggregate: { field: 'items', fn: 'count' }, title: 'Items by region', explanation: '' })
    const out = await planAndRun({ question: 'How many items were there?', data: sales, dataset: 'Sales' }, SIGNAL)
    if (out.kind !== 'done') throw new Error(`expected done, got ${out.kind}`)
    expect(headlineFor(out.result).answer).toBe('2 regions.')
  })
})

describe('a threshold on a counted column does not make the column the counted noun', () => {
  const FIVE_OR_MORE = { field: 'mag', op: 'gte', value: '5' }

  it('keeps one total for "how many magnitude 5 or greater earthquakes", counted from the raw text', async () => {
    expect(rawMagAtLeast(5)).toBe(7)
    const result = await runServed('How many magnitude 5 or greater earthquakes were there?', { ...OVERALL_MODEL, groupBy: 'id', filter: FIVE_OR_MORE })
    expect(result.queryPlan.countColumn).toBe('rows')
    expect(result.labels).toEqual([OVERALL_LABEL])
    expect(headlineFor(result).answer).toBe('7 earthquakes where magnitude is at least 5.')
  })

  it('keeps the model total for "how many magnitude 5 or greater were there", where the threshold column is not a noun', async () => {
    const result = await runServed('How many magnitude 5 or greater were there?', { ...OVERALL_MODEL, groupBy: 'id', filter: FIVE_OR_MORE })
    expect(result.queryPlan.countColumn).toBe('rows')
    expect(headlineFor(result).answer).toBe('7 earthquakes where magnitude is at least 5.')
  })

  it('turns a grouped model plan into the same total, so the total does not depend on the model count column', async () => {
    const result = await runServed('How many magnitude 5 or greater earthquakes were there?', {
      ...OVERALL_MODEL,
      groupBy: 'region',
      filter: FIVE_OR_MORE,
    })
    expect(result.queryPlan.countColumn).toBe('rows')
    expect(headlineFor(result).answer).toBe('7 earthquakes where magnitude is at least 5.')
  })

  it('reads the counted noun as the head of the phrase, not the column in front of the threshold', () => {
    expect(asksForTotal('How many magnitude 5 or greater earthquakes were there?', NAMES)).toBe(true)
    expect(countsOtherThanRows('How many magnitude 5 or greater earthquakes were there?', NAMES)).toBe(false)
    expect(asksForTotal('How many magnitude types were there?', NAMES)).toBe(false)
  })
})

describe('a count of a noun the data has no column for is grouped by the default column, with a notice', () => {
  it.each([
    ['How many countries had earthquakes?', 'The data has no column for countries, so the chart groups by region instead.'],
    ['In total, how many countries had earthquakes?', 'The data has no column for countries, so the chart groups by region instead.'],
    ['Which country had the most earthquakes?', 'The data has no column for country, so the chart groups by region instead.'],
  ])('%s groups by region, not by the id column the model sent', async (question, notice) => {
    const result = await runServed(question, { ...OVERALL_MODEL, groupBy: 'id' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('region')
    expect(result.labels.length).toBe(9)
    const headline = headlineFor(result)
    expect(headline.substitute).toBe(true)
    expect(headline.notice).toBe(notice)
  })

  it('states the region count and leads with the notice for "how many countries"', async () => {
    const result = await runServed('How many countries had earthquakes?', { ...OVERALL_MODEL, groupBy: 'id' })
    expect(headlineFor(result).answer).toBe('9 regions.')
  })

  it('keeps the notice the model sent, and still groups by the default column', async () => {
    const result = await runServed('How many countries had earthquakes?', { ...OVERALL_MODEL, groupBy: 'id', missing: ['countries'], notice: 'Model notice.' })
    expect(result.queryPlan.groupBy).toBe('region')
    expect(headlineFor(result).notice).toBe('Model notice.')
  })

  it('regroups a taken-back total by the default column, since the groupBy of a total is only a placeholder', async () => {
    const result = await runServed('How many countries had earthquakes?', { ...OVERALL_MODEL, groupBy: 'mag' })
    expect(result.queryPlan.countColumn).toBeUndefined()
    expect(result.queryPlan.groupBy).toBe('region')
    expect(result.queryPlan.missing).toEqual(['countries'])
    expect(headlineFor(result).notice).toBe('The data has no column for countries, so the chart groups by region instead.')
    expect(headlineFor(result).substitute).toBe(true)
  })

  it('keeps a grouping that is not unique to each row when the model chose no total, since it is a real column, and still says the data has no countries', async () => {
    const result = await runServed('How many countries had earthquakes?', { ...OVERALL_MODEL, countColumn: null, groupBy: 'mag' })
    expect(result.queryPlan.groupBy).toBe('mag')
    expect(result.queryPlan.missing).toEqual(['countries'])
    expect(headlineFor(result).substitute).toBe(true)
  })

  it('names the noun a question counts that no column or row noun names', () => {
    expect(unknownNoun('How many countries had earthquakes?', NAMES)).toBe('countries')
    expect(unknownNoun('Which country had the most earthquakes?', NAMES)).toBe('country')
    expect(unknownNoun('How many regions had earthquakes?', NAMES)).toBeNull()
    expect(unknownNoun('Which earthquake had the highest magnitude?', NAMES)).toBeNull()
    expect(unknownNoun('How many earthquake types were there?', NAMES)).toBeNull()
  })
})
