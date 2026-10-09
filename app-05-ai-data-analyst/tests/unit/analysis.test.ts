import { afterEach, describe, expect, it, vi } from 'vitest'
import { planAndRun } from '../../src/lib/analysis'
import { parseEarthquakeCsv } from '../../src/lib/liveData/parse'
import { EARTHQUAKE_VOCABULARY } from '../../src/lib/vocabulary'
import { USGS_EXCERPT } from '../fixtures/usgs'
import type { QueryPlan } from '../../src/types'

const data = parseEarthquakeCsv(USGS_EXCERPT)
const SIGNAL = new AbortController().signal

const ROOT: QueryPlan = {
  chartType: 'bar',
  groupBy: 'region',
  aggregate: { field: 'id', fn: 'count' },
  sortBy: { field: 'id', dir: 'desc' },
  title: 'Earthquakes by region',
  explanation: '',
}

function serve(...plans: Array<Record<string, unknown>>) {
  const mock = vi.fn()
  for (const plan of plans) {
    mock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: plan,
          trace: [{ name: 'Model call', status: 'ok', ms: 5, detail: 'Served.' }],
          usage: {},
          model: 'anthropic/claude-haiku-5.5',
          totalMs: 7,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => vi.unstubAllGlobals())

async function first() {
  serve(ROOT as unknown as Record<string, unknown>)
  const out = await planAndRun(
    { question: 'Which region had the most earthquakes?', data, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY },
    SIGNAL,
  )
  if (out.kind !== 'done') throw new Error('Expected a finished first step')
  return out
}

describe('planAndRun', () => {
  it('runs a first question on every row and records the run steps', async () => {
    const out = await first()
    expect(out.changes).toEqual([])
    expect(out.result.labels.slice(0, 2)).toEqual(['Alaska', 'California'])
    expect(out.result.datasets[0]?.values.slice(0, 2)).toEqual([3, 3])
    expect(out.run.trace.map((step) => step.name)).toEqual(['Model call', 'Run plan on the rows'])
    expect(out.run.trace[1]?.detail).toBe('10 groups. Highest: Alaska and 1 more tie.')
  })

  it('sends the previous plan with a follow-up and shows what the new plan changed', async () => {
    const before = await first()
    const refined = { ...ROOT, filter: { field: 'region', op: 'eq', value: 'Alaska' }, groupBy: 'magType' }
    const mock = serve(refined)
    const out = await planAndRun(
      { question: 'only Alaska, by magnitude type', data, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY, previous: before.result },
      SIGNAL,
    )
    const sent = JSON.parse(String(mock.mock.calls[0]?.[1]?.body)) as { previous: { question: string; plan: QueryPlan } }
    expect(sent.previous.question).toBe('Which region had the most earthquakes?')
    expect(sent.previous.plan.groupBy).toBe('region')
    if (out.kind !== 'done') throw new Error('Expected a finished follow-up')
    expect(out.changes.map((change) => change.text)).toEqual([
      'Filter added: region is Alaska',
      'Grouped by magnitude type instead of region',
    ])
    // The excerpt has three Alaska quakes, all ml. Other regions' magnitude types are filtered out.
    expect(out.result.labels).toEqual(['ml'])
    expect(out.result.datasets[0]?.values).toEqual([3])
  })

  it('keeps the previous result and carries the reason when the follow-up cannot be applied', async () => {
    const before = await first()
    serve({ ...ROOT, cannotApply: 'The data covers 7 days, so there is no earlier week to compare with.' })
    const out = await planAndRun(
      { question: 'compare with last week', data, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY, previous: before.result },
      SIGNAL,
    )
    expect(out.kind).toBe('not-applied')
    if (out.kind !== 'not-applied') return
    expect(out.reason).toContain('no earlier week')
    expect(out.result).toBe(before.result)
    expect(out.run.trace.at(-1)).toMatchObject({ name: 'Run plan on the rows', status: 'skipped' })
  })

  it('refuses a plan that names a column the rows do not have, and runs nothing', async () => {
    serve({ ...ROOT, groupBy: 'continent' })
    const out = await planAndRun({ question: 'by continent', data, dataset: 'Earthquakes' }, SIGNAL)
    expect(out.kind).toBe('invalid')
    if (out.kind === 'invalid') {
      expect(out.run.outcome).toBe('failed')
      expect(out.run.trace.at(-1)).toMatchObject({ name: 'Check plan in the browser', status: 'failed' })
    }
  })

  it('makes the ranking follow the words of the follow-up', async () => {
    const before = await first()
    serve({ ...ROOT, sortBy: { field: 'id', dir: 'desc' }, limit: 3 })
    const out = await planAndRun(
      { question: 'show the bottom 3', data, dataset: 'Earthquakes', vocab: EARTHQUAKE_VOCABULARY, previous: before.result },
      SIGNAL,
    )
    if (out.kind !== 'done') throw new Error('Expected a finished follow-up')
    expect(out.result.queryPlan.sortBy).toEqual({ field: 'id', dir: 'asc' })
    expect(out.result.datasets[0]?.values).toEqual([1, 1, 1])
    expect(out.changes.map((change) => change.text)).toEqual(['Sort changed: highest first to lowest first', 'Limit added: bottom 3'])
  })
})
