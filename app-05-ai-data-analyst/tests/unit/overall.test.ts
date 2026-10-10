import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeResult, describePlan, headlineFor } from '../../src/lib/answer'
import { planAndRun } from '../../src/lib/analysis'
import { executeQuery, OVERALL_LABEL, topGroup } from '../../src/lib/dataEngine'
import { parseEarthquakeCsv } from '../../src/lib/liveData/parse'
import { applyCountColumn, applyQuestionDirection, applyQuestionTotal, validateQueryPlan } from '../../src/lib/queryPlan'
import { asksForTotal, countsOtherThanRows, type QuestionNouns } from '../../src/lib/questionNouns'
import { EARTHQUAKE_VOCABULARY, labelFor, RAW_VOCABULARY } from '../../src/lib/vocabulary'
import { USGS_EXCERPT } from '../fixtures/usgs'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'
import type { AggregateFn, AnalysisResult, ParsedData, QueryPlan } from '../../src/types'

const data = parseEarthquakeCsv(USGS_EXCERPT)
const week = parseEarthquakeCsv(USGS_WEEK_EXCERPT)
const SIGNAL = new AbortController().signal
const magAtLeast = (n: number) => data.rows.filter((row) => Number(row.mag) >= n).length
// Counted from the recorded text itself, not from the parsed rows. In this CSV mag is column 5 and
// no quoted field comes before it, so a plain split is exact.
const rawWeekMagAtLeast = (n: number) =>
  USGS_WEEK_EXCERPT.split('\n').slice(1).filter((line) => line.trim() !== '').filter((line) => Number(line.split(',')[4]) >= n).length
const TOTAL_QUESTION = 'In total, how many earthquakes had magnitude 4.5 or greater?'
// The same nouns analysis.ts builds for this dataset: the row noun, and every column name and its label.
const QUAKE_NAMES: QuestionNouns = {
  rowNoun: EARTHQUAKE_VOCABULARY.rowNoun,
  nouns: week.headers.flatMap((header) => [header, labelFor(EARTHQUAKE_VOCABULARY, header)]),
}
// The recorded excerpt (59 rows) names nine distinct regions after the place string is split.
const WEEK_REGIONS = 9

// What the model returned in the failing run: the total question grouped by region.
const GROUPED: QueryPlan = {
  chartType: 'bar',
  groupBy: 'region',
  aggregate: { field: 'id', fn: 'count' },
  filter: { field: 'mag', op: 'gte', value: '4.5' },
  sortBy: { field: 'id', dir: 'desc' },
  title: 'Earthquakes by region',
  explanation: '',
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

describe('asksForTotal', () => {
  it('reads total-style questions as one number', () => {
    for (const q of [
      'In total, how many earthquakes had magnitude 4.5 or greater?',
      'In total, how many earthquakes had magnitude 5 or greater?',
      'How many earthquakes were there in total?',
      'How many earthquakes have magnitude at least 4?',
      'What is the total number of earthquakes with depth over 100?',
      'How many earthquakes altogether?',
    ]) expect(asksForTotal(q, QUAKE_NAMES), q).toBe(true)
  })

  it('leaves grouped and ranked questions alone', () => {
    for (const q of [
      'Which region had the most earthquakes?',
      'How many earthquakes by magnitude type?',
      'Average magnitude by magType',
      'Count by type',
      'Total rain by month',
      'How many earthquakes per region?',
      'Top 5 regions by earthquakes',
    ]) expect(asksForTotal(q, QUAKE_NAMES), q).toBe(false)
  })

  it('does not read "how many <group noun>" as a row total, whatever the noun is', () => {
    // Each of these counts groups (regions, countries, places, magnitude types), not earthquakes.
    for (const q of [
      'How many regions had earthquakes?',
      'How many countries had earthquakes?',
      'How many places had earthquakes?',
      'How many magnitude types were there?',
      'In total, how many magnitude types were there?',
    ]) expect(asksForTotal(q, QUAKE_NAMES), q).toBe(false)
  })

  it('reads a count of an unknown noun as a total only on a raw upload, where no row noun is known', () => {
    expect(asksForTotal('How many orders were over 100?', { rowNoun: 'rows', nouns: ['product', 'revenue'] })).toBe(true)
    expect(asksForTotal('How many countries had sales?', { rowNoun: 'rows', nouns: ['region', 'sales'] })).toBe(true)
    expect(asksForTotal('How many regions had sales?', { rowNoun: 'rows', nouns: ['region', 'sales'] })).toBe(false)
  })
})

describe('applyQuestionTotal', () => {
  it('turns the grouped plan for a total question into an ungrouped one, and keeps the filter', () => {
    const plan = applyQuestionTotal(GROUPED, 'In total, how many earthquakes had magnitude 4.5 or greater?')
    expect(plan.countColumn).toBe('rows')
    expect(plan.sortBy).toBeUndefined()
    expect(plan.filter).toEqual(GROUPED.filter)
  })

  it('does not touch a grouped question', () => {
    expect(applyQuestionTotal(GROUPED, 'Which region had the most earthquakes?')).toBe(GROUPED)
  })

  it('makes a follow-up that asks for one number a total, and drops the threshold, limit and sort on the way', () => {
    const followUp = applyQuestionTotal(
      { ...GROUPED, having: { op: 'gt', value: 5 }, limit: 5 },
      'In total, how many had magnitude 5 or greater?',
      QUAKE_NAMES,
    )
    expect(followUp.countColumn).toBe('rows')
    expect(followUp.limit).toBeUndefined()
    expect(followUp.having).toBeUndefined()
    expect(followUp.sortBy).toBeUndefined()
  })
})

describe('the dataset words for its rows', () => {
  it('reads "how many quakes" as a count of the rows, the same as "how many earthquakes"', () => {
    const question = 'How many quakes had magnitude 4.5 or greater?'
    expect(asksForTotal(question, QUAKE_NAMES), question).toBe(true)
    expect(countsOtherThanRows(question, QUAKE_NAMES), question).toBe(false)
  })

  it('keeps "how many earthquake types" and "how many event types" grouped, not read as rows', () => {
    for (const question of ['How many earthquake types were there?', 'How many event types were there?']) {
      expect(asksForTotal(question, QUAKE_NAMES), question).toBe(false)
      expect(countsOtherThanRows(question, QUAKE_NAMES), question).toBe(true)
    }
  })

  it('takes the row synonyms as an addition to the row noun, so a dataset with another row noun still counts its own', () => {
    const weather: QuestionNouns = { rowNoun: 'days', nouns: ['temperature'] }
    expect(asksForTotal('How many days were above 30?', weather)).toBe(true)
    expect(asksForTotal('How many records were above 30?', weather)).toBe(true)
  })
})

describe('applyCountColumn', () => {
  it('takes the total away from a question that counts a group or names a grouping', () => {
    const total: QueryPlan = { ...GROUPED, countColumn: 'rows' }
    expect(applyCountColumn(total, 'How many regions had earthquakes?', QUAKE_NAMES).countColumn).toBeUndefined()
    expect(applyCountColumn(total, 'Which region had the most earthquakes?', QUAKE_NAMES).countColumn).toBeUndefined()
  })

  it('keeps the total for a plain refinement that only narrows the rows', () => {
    const total: QueryPlan = { ...GROUPED, countColumn: 'rows' }
    delete total.sortBy
    expect(applyCountColumn(total, 'only Alaska', QUAKE_NAMES)).toEqual(total)
    expect(applyCountColumn(total, 'In total, how many earthquakes had magnitude 4.5 or greater?', QUAKE_NAMES)).toEqual(total)
  })
})

describe('an overall plan on the rows', () => {
  const overall: QueryPlan = { ...GROUPED, countColumn: 'rows', sortBy: undefined }
  delete overall.sortBy

  it('counts every matching row once, equal to an independent count of the recorded data', () => {
    for (const n of [0, 1, 2.5, 4.5]) {
      const out = executeQuery(data, { ...overall, filter: { field: 'mag', op: 'gte', value: String(n) } })
      expect(out.labels).toEqual([OVERALL_LABEL])
      expect(out.datasets[0]?.values).toEqual([magAtLeast(n)])
    }
    expect(magAtLeast(0)).toBeGreaterThan(magAtLeast(4.5))
  })

  it('keeps one group with 0 when no row matches, for a count and for a sum', () => {
    const none = { field: 'mag', op: 'gt' as const, value: '99' }
    expect(executeQuery(data, { ...overall, filter: none }).datasets[0]?.values).toEqual([0])
    const sum = { ...overall, aggregate: { field: 'mag', fn: 'sum' as const }, filter: none }
    expect(executeQuery(data, sum).datasets[0]?.values).toEqual([0])
    expect(describeResult(sum, null, executeQuery(data, sum), { vocab: EARTHQUAKE_VOCABULARY }).answer).toBe(
      'The total magnitude where magnitude is greater than 99 is 0.',
    )
  })

  it('says there is no average, minimum or maximum over zero rows, rather than printing 0', () => {
    const none = { field: 'mag', op: 'gt' as const, value: '99' }
    const cases: Array<[AggregateFn, string]> = [
      ['avg', 'The average magnitude where magnitude is greater than 99 cannot be worked out, because no matching row has a number in magnitude.'],
      ['min', 'The minimum magnitude where magnitude is greater than 99 cannot be worked out, because no matching row has a number in magnitude.'],
      ['max', 'The maximum magnitude where magnitude is greater than 99 cannot be worked out, because no matching row has a number in magnitude.'],
    ]
    for (const [fn, sentence] of cases) {
      const plan: QueryPlan = { ...overall, aggregate: { field: 'mag', fn }, filter: none }
      const engine = executeQuery(data, plan)
      expect(engine.labels, fn).toEqual([])
      expect(describeResult(plan, null, engine, { vocab: EARTHQUAKE_VOCABULARY }).answer, fn).toBe(sentence)
    }
  })

  it('leaves out a group whose cells hold no number, rather than showing its average as 0', () => {
    const cells: ParsedData = {
      headers: ['region', 'mag'],
      rows: [
        { region: 'Peru', mag: '' },
        { region: 'Chile', mag: '2' },
        { region: 'Chile', mag: '4' },
      ],
      truncated: false,
      totalRows: 3,
      parseErrorRowCount: 0,
    }
    const plan: QueryPlan = { chartType: 'bar', groupBy: 'region', aggregate: { field: 'mag', fn: 'avg' }, title: 'Average', explanation: '' }
    const engine = executeQuery(cells, plan)
    expect(engine.labels).toEqual(['Chile'])
    expect(engine.datasets[0]?.values).toEqual([3])
  })

  it('states the total, not a top group, in the headline', () => {
    const plan: QueryPlan = { ...overall, filter: { field: 'mag', op: 'gte', value: '2.5' } }
    const engine = executeQuery(data, plan)
    const headline = describeResult(plan, null, engine, { vocab: EARTHQUAKE_VOCABULARY })
    expect(headline.answer).toBe(`${magAtLeast(2.5)} earthquakes where magnitude is at least 2.5.`)
    expect(describePlan(plan, EARTHQUAKE_VOCABULARY).groupBy).toBe('None, one total')
  })

  it('accepts overall with a missing group column and forces a bar', () => {
    const checked = validateQueryPlan({ ...overall, groupBy: undefined, chartType: 'line', countColumn: 'rows' }, data.headers)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.plan).toMatchObject({ countColumn: 'rows', chartType: 'bar' })
  })
})

describe('planAndRun on a total question the model grouped by region', () => {
  it('answers with the count over all rows', async () => {
    serve(GROUPED as unknown as Record<string, unknown>)
    const out = await planAndRun(
      { question: 'In total, how many earthquakes had magnitude 4.5 or greater?', data, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY },
      SIGNAL,
    )
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.labels).toEqual([OVERALL_LABEL])
    expect(out.result.datasets[0]?.values).toEqual([magAtLeast(4.5)])
    expect(out.result.queryPlan.countColumn).toBe('rows')
  })

  it('still groups a ranked question', async () => {
    serve({ ...GROUPED, filter: undefined } as unknown as Record<string, unknown>)
    const out = await planAndRun(
      { question: 'Which region had the most earthquakes?', data, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY },
      SIGNAL,
    )
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.queryPlan.countColumn).toBeUndefined()
    expect(out.result.labels.length).toBeGreaterThan(1)
  })
})

describe('the total on a recorded week of the live feed', () => {
  it('counts the recorded rows from the text, and the excerpt holds 20 at magnitude 4.5 or more', () => {
    expect(rawWeekMagAtLeast(4.5)).toBe(20)
    expect(week.rows.length).toBe(59)
    expect(week.rows.filter((row) => Number(row.mag) >= 4.5).length).toBe(rawWeekMagAtLeast(4.5))
  })

  it('answers a grouped total question with the one count over all rows, and says so in the headline', async () => {
    serve(GROUPED as unknown as Record<string, unknown>)
    const out = await planAndRun({ question: TOTAL_QUESTION, data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY }, SIGNAL)
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.labels).toEqual([OVERALL_LABEL])
    expect(out.result.datasets[0]?.values).toEqual([20])
    expect(headlineFor(out.result).answer).toBe('20 earthquakes where magnitude is at least 4.5.')
  })

  it('keeps the total when the model also sets a threshold that would empty the single group', async () => {
    serve({ ...GROUPED, countColumn: 'rows', having: { op: 'gt', value: 50 } } as unknown as Record<string, unknown>)
    const out = await planAndRun({ question: TOTAL_QUESTION, data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY }, SIGNAL)
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.queryPlan.having).toBeUndefined()
    expect(headlineFor(out.result).answer).toBe('20 earthquakes where magnitude is at least 4.5.')
  })

  it('keeps a question that counts the regions grouped, and states the count of regions in the headline', async () => {
    const question = 'How many regions had earthquakes?'
    expect(applyQuestionTotal(GROUPED, question, QUAKE_NAMES)).toBe(GROUPED)

    serve({ ...GROUPED, filter: undefined } as unknown as Record<string, unknown>)
    const out = await planAndRun({ question, data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY }, SIGNAL)
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.queryPlan.countColumn).toBeUndefined()
    expect(new Set(week.rows.map((row) => row.region)).size).toBe(WEEK_REGIONS)
    expect(out.result.labels.length).toBe(WEEK_REGIONS)
    expect(headlineFor(out.result).answer).toBe(`${WEEK_REGIONS} regions.`)
  })

  it('states the count of groups for a count of countries the data has no column for, not a row total', async () => {
    const question = 'How many countries had earthquakes?'
    serve({ ...GROUPED, filter: undefined } as unknown as Record<string, unknown>)
    const out = await planAndRun({ question, data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY }, SIGNAL)
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.queryPlan.countColumn).toBeUndefined()
    expect(headlineFor(out.result).answer).toBe('9 regions.')
  })

  it('states the count of groups with the row condition when the question has one', async () => {
    serve({ ...GROUPED, groupBy: 'magType', aggregate: { field: 'id', fn: 'count' } } as unknown as Record<string, unknown>)
    const out = await planAndRun(
      { question: 'How many magnitude types had earthquakes with magnitude 4.5 or greater?', data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY },
      SIGNAL,
    )
    if (out.kind !== 'done') throw new Error('expected done')
    const types = new Set(week.rows.filter((row) => Number(row.mag) >= 4.5).map((row) => row.magType)).size
    expect(out.result.labels.length).toBe(types)
    expect(headlineFor(out.result).answer).toBe(`${types} magnitude types where magnitude is at least 4.5.`)
  })

  it('still reads a total over the rows when the question names the row noun, and not a group noun', () => {
    expect(asksForTotal('How many earthquakes were there in total?', QUAKE_NAMES)).toBe(true)
    expect(asksForTotal(TOTAL_QUESTION, QUAKE_NAMES)).toBe(true)
    expect(asksForTotal('How many magnitude types were there in total?', QUAKE_NAMES)).toBe(false)
  })
})

describe('an overall plan from the model', () => {
  it('drops a threshold, a limit and a sort, since one total has no groups to act on', () => {
    const checked = validateQueryPlan(
      { ...GROUPED, countColumn: 'rows', having: { op: 'gt', value: 5 }, limit: 3, sortBy: { field: 'id', dir: 'desc' } },
      data.headers,
    )
    if (!checked.ok) throw new Error(checked.error)
    expect(checked.plan.countColumn).toBe('rows')
    expect(checked.plan.having).toBeUndefined()
    expect(checked.plan.limit).toBeUndefined()
    expect(checked.plan.sortBy).toBeUndefined()
  })

  it('is not given a sort by a "lowest" question', () => {
    const overall: QueryPlan = { ...GROUPED, countColumn: 'rows' }
    delete overall.sortBy
    expect(applyQuestionDirection(overall, 'In total, how many earthquakes had the lowest magnitude?')).toEqual(overall)
  })
})

describe('a count word inside a grouped question', () => {
  // A raw upload: "how many" counts the rows here, and "per region" names a grouping, so the top group leads.
  const sales: ParsedData = {
    headers: ['region', 'sales'],
    rows: [
      { region: 'North', sales: '100' },
      { region: 'North', sales: '200' },
      { region: 'South', sales: '50' },
    ],
    truncated: false,
    totalRows: 3,
    parseErrorRowCount: 0,
  }

  it('keeps the top group in the headline when the question names a grouping', () => {
    const plan: QueryPlan = { chartType: 'bar', groupBy: 'region', aggregate: { field: 'sales', fn: 'sum' }, title: 'Sales', explanation: '' }
    const engine = executeQuery(sales, plan)
    expect(engine.labels).toEqual(['North', 'South'])
    const headline = describeResult(plan, topGroup(engine), engine, { vocab: RAW_VOCABULARY, question: 'How many sales per region?' })
    expect(headline.answer).toBe('North has the highest total sales: 300.')
  })
})

describe('the question words in a live week, end to end through planAndRun', () => {
  it('answers "how many quakes" with the count over all rows, not the count of regions', async () => {
    serve(GROUPED as unknown as Record<string, unknown>)
    const out = await planAndRun(
      { question: 'How many quakes had magnitude 4.5 or greater?', data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY },
      SIGNAL,
    )
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.labels).toEqual([OVERALL_LABEL])
    expect(out.result.datasets[0]?.values).toEqual([20])
    expect(headlineFor(out.result).answer).toBe('20 earthquakes where magnitude is at least 4.5.')
  })

  it('takes a model total off "how many regions" and "which region", and counts the groups', async () => {
    for (const question of ['How many regions had earthquakes?', 'Which region had the most earthquakes?']) {
      serve({ ...GROUPED, countColumn: 'rows', filter: undefined } as unknown as Record<string, unknown>)
      const out = await planAndRun({ question, data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY }, SIGNAL)
      if (out.kind !== 'done') throw new Error('expected done')
      expect(out.result.queryPlan.countColumn, question).toBeUndefined()
      expect(out.result.labels.length, question).toBe(WEEK_REGIONS)
    }
  })

  it('answers a follow-up "in total, how many" with one count, though the previous plan was grouped', async () => {
    const previous: AnalysisResult = {
      ...executeQuery(week, { ...GROUPED, filter: undefined }),
      queryPlan: { ...GROUPED, filter: undefined },
      question: 'Which region had the most earthquakes?',
      dataset: 'Earthquakes',
      vocab: EARTHQUAKE_VOCABULARY,
    }
    serve(GROUPED as unknown as Record<string, unknown>)
    const out = await planAndRun(
      { question: 'In total, how many had magnitude 4.5 or greater?', data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY, previous },
      SIGNAL,
    )
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.queryPlan.countColumn).toBe('rows')
    expect(out.result.labels).toEqual([OVERALL_LABEL])
    expect(out.result.datasets[0]?.values).toEqual([20])
  })

  it('answers a follow-up total when the previous plan had a limit, and drops that limit', async () => {
    const previous: AnalysisResult = {
      ...executeQuery(week, { ...GROUPED, filter: undefined, limit: 5 }),
      queryPlan: { ...GROUPED, filter: undefined, limit: 5 },
      question: 'What are the top 5 regions for earthquakes?',
      dataset: 'Earthquakes',
      vocab: EARTHQUAKE_VOCABULARY,
    }
    serve({ ...GROUPED, limit: 5 } as unknown as Record<string, unknown>)
    const out = await planAndRun(
      { question: 'In total, how many earthquakes had magnitude 4.5 or greater?', data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY, previous },
      SIGNAL,
    )
    if (out.kind !== 'done') throw new Error('expected done')
    expect(out.result.queryPlan.limit).toBeUndefined()
    expect(out.result.labels).toEqual([OVERALL_LABEL])
    expect(out.result.datasets[0]?.values).toEqual([20])
  })
})

describe('the follow-up that goes to the server', () => {
  it('sends the previous total as countColumn "rows", so the server keeps the total on a refinement', async () => {
    const total: QueryPlan = { ...GROUPED, countColumn: 'rows', filter: undefined }
    const previous: AnalysisResult = {
      ...executeQuery(week, total),
      queryPlan: total,
      question: 'In total, how many earthquakes had magnitude 4.5 or greater?',
      dataset: 'Earthquakes',
      vocab: EARTHQUAKE_VOCABULARY,
    }
    serve(GROUPED as unknown as Record<string, unknown>)
    await planAndRun({ question: 'Only Alaska', data: week, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY, previous }, SIGNAL)
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as { previous?: { plan: QueryPlan } }
    // This is a guard on the wire: the flag is already sent by planAndRun, and this test fails if it stops.
    expect(sent.previous?.plan.countColumn).toBe('rows')
  })
})
