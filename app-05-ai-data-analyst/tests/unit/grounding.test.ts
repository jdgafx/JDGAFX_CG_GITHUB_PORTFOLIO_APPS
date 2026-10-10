import { afterEach, describe, expect, it, vi } from 'vitest'
import { planAndRun } from '../../src/lib/analysis'
import { parseCSV } from '../../src/lib/dataEngine'
import { unansweredMessage } from '../../src/lib/grounding'
import { parseEarthquakeCsv, parseWeatherCsv } from '../../src/lib/liveData/parse'
import type { QuestionNouns } from '../../src/lib/questionNouns'
import { EARTHQUAKE_VOCABULARY, labelFor, RAW_VOCABULARY, WEATHER_VOCABULARY } from '../../src/lib/vocabulary'
import { USGS_WEEK_EXCERPT } from '../fixtures/usgsWeek'
import { OPEN_METEO_EXCERPT } from '../fixtures/openMeteo'
import { CONTRADICTORY, OFF_SUBJECT, ON_SUBJECT, type RecordedReply } from '../fixtures/modelReplies'
import type { AnalysisResult, ParsedData, Vocabulary } from '../../src/types'

// Whether a question is about the data is the model's call: it reads the column names and sample rows and sets aboutData.
// The browser holds no word list for it. The plans are replies the deployed model returned on 2026-10-10 (live runs on the
// live feeds, no model call here): eight questions it flagged as off the subject, and thirteen real questions in loose
// wording ("How hot was it?", "Show me everything") that a list of data words had refused.
const FRUIT = 'store,fruit,units,price\nNorth,apple,10,1.5\nNorth,banana,4,0.5\nSouth,apple,7,1.5\nSouth,cherry,30,3\nEast,banana,12,0.5\nEast,apple,3,1.5\nWest,cherry,5,3\nWest,banana,"1,000",0.5\n'
const DATASETS: Record<RecordedReply['dataset'], { data: ParsedData; vocab: Vocabulary }> = {
  quakes: { data: parseEarthquakeCsv(USGS_WEEK_EXCERPT), vocab: EARTHQUAKE_VOCABULARY },
  weather: { data: parseWeatherCsv(OPEN_METEO_EXCERPT), vocab: WEATHER_VOCABULARY },
  fruit: { data: parseCSV(FRUIT), vocab: RAW_VOCABULARY },
}
const SIGNAL = new AbortController().signal
const MODEL_STEP = { name: 'Model call', status: 'ok', ms: 1400, detail: 'Served by the model.', tokens: 3500, cost: 0.0004 }

afterEach(() => vi.unstubAllGlobals())

function run(reply: RecordedReply, overrides: { question?: string; plan?: Record<string, unknown>; previous?: AnalysisResult } = {}) {
  const plan = overrides.plan ?? reply.plan
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: plan, trace: [MODEL_STEP], usage: { total_tokens: 3500, cost: 0.0004 }, model: 'm', totalMs: 1400 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  const { data, vocab } = DATASETS[reply.dataset]
  return planAndRun(
    { question: overrides.question ?? reply.question, data, dataset: reply.dataset, vocab, ...(overrides.previous ? { previous: overrides.previous } : {}) },
    SIGNAL,
  )
}

describe('a new question the model reports as off the subject', () => {
  it.each(OFF_SUBJECT.map((reply) => [`${reply.dataset}: ${reply.question}`, reply] as const))('%s is answered with the reason and no number', async (_name, reply) => {
    expect(reply.plan.aboutData).toBe(false)
    expect(reply.plan.missing).toBeUndefined()
    const out = await run(reply)
    expect(out.kind).toBe('unanswered')
    if (out.kind !== 'unanswered') return
    expect(out.message).toMatch(/^The data does not answer this question\./)
    expect(out.message).toContain('Try naming a column, such as ')
    expect(out.message).not.toMatch(/\d/)
    // The model call stays in the run with its tokens and cost; the plan was not run.
    expect(out.run.trace[0]).toEqual(MODEL_STEP)
    expect(out.run.trace.at(-1)).toMatchObject({ name: 'Run plan on the rows', status: 'skipped' })
    expect(out.run.outcome).toBe('done')
  })

  it('is decided by the model\'s flag, not by the question\'s words', async () => {
    const real = ON_SUBJECT.find((reply) => reply.question === 'How hot was it?')
    const nonsense = OFF_SUBJECT.find((reply) => reply.question === 'asdf qwerty' && reply.dataset === 'quakes')
    if (!real || !nonsense) throw new Error('fixture missing')
    expect((await run(real, { plan: { ...real.plan, aboutData: false } })).kind).toBe('unanswered')
    // The same nonsense words with no flag in the reply (a model that forgot the field) are not held back: the page never invents a refusal.
    const unflagged = { ...nonsense.plan }
    delete unflagged.aboutData
    expect((await run(nonsense, { plan: unflagged })).kind).toBe('done')
  })

  it('does not hold back a follow-up, which refines a plan that is already on screen', async () => {
    const base = ON_SUBJECT.find((reply) => reply.dataset === 'quakes' && reply.question === 'Show me everything')
    if (!base) throw new Error('fixture missing')
    const first = await run(base)
    if (first.kind !== 'done') throw new Error('expected done')
    const out = await run(base, { question: 'make it smaller', plan: { ...base.plan, aboutData: false }, previous: first.result })
    expect(out.kind).toBe('done')
  })
})

describe('a real question still answers', () => {
  it.each(ON_SUBJECT.map((reply) => [`${reply.dataset}: ${reply.question}`, reply] as const))('%s', async (_name, reply) => {
    const out = await run(reply)
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.result.queryPlan.aboutData).toBeUndefined()
  })

  it('answers a question whose reply says off the subject and also lists what the data lacks, with the stand-in notice', async () => {
    expect(CONTRADICTORY.plan.aboutData).toBe(false)
    expect(CONTRADICTORY.plan.missing).toEqual(expect.arrayContaining(['coast']))
    const out = await run(CONTRADICTORY)
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.result.queryPlan.missing).toContain('coast')
  })
})

describe('unansweredMessage', () => {
  const week = DATASETS.quakes.data
  const columns = week.headers.map((header) => ({ header, label: labelFor(EARTHQUAKE_VOCABULARY, header) }))
  const names: QuestionNouns = { rowNoun: EARTHQUAKE_VOCABULARY.rowNoun, nouns: columns.flatMap((c) => [c.header, c.label]), columns }

  it('points at real columns in its message, and at none when the data has none', () => {
    expect(unansweredMessage(names, EARTHQUAKE_VOCABULARY)).toContain('such as region, time or magnitude.')
    expect(unansweredMessage({ rowNoun: 'rows', nouns: [] }, { rowNoun: 'rows', singularRowNoun: 'row', labels: {}, units: {} })).not.toContain('Try naming')
  })
})
