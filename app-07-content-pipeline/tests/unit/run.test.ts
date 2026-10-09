import { describe, expect, it } from 'vitest'
import { STAGE_LABELS, type StageId, type Usage } from '../../netlify/shared/contract'
import type { CallRecord } from '../../src/lib/api'
import { buildTrace, formatCount, formatMs, formatUsd, stageViews, summarize } from '../../src/lib/run'

const MODEL = 'anthropic/claude-haiku-5.5'
const FIRST: Usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 }
const SECOND: Usage = { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600, cost: 0.0001 }

function record(stage: StageId, ms: number, usage: Usage | null = null, status: 'ok' | 'failed' = 'ok', model: string | null = MODEL): CallRecord {
  return {
    stage,
    row: { name: STAGE_LABELS[stage], status, ms, detail: 'detail', tokens: usage?.total_tokens, cost: usage?.cost },
    usage,
    model,
  }
}

describe('buildTrace', () => {
  it('sizes each bar against the slowest call in the run', () => {
    const lines = buildTrace([record('research', 1_200), record('outline', 3_000)], {}, null)
    expect(lines.map(line => line.name)).toEqual(['Research', 'Outline'])
    expect(lines.map(line => line.index)).toEqual([1, 2])
    expect(lines.map(line => line.share)).toEqual([40, 100])
  })

  it('adds a skipped line for each later stage after a failure', () => {
    const lines = buildTrace(
      [record('sources', 400), record('research', 900), record('outline', 800), record('draft', 2_000, null, 'failed')],
      { sources: 's', research: 'r', outline: 'o' },
      { kind: 'failed', stage: 'draft' },
    )
    expect(lines.map(line => line.status)).toEqual(['ok', 'ok', 'ok', 'failed', 'skipped', 'skipped'])
    expect(lines.slice(4).map(line => line.name)).toEqual(['Edit', 'Polish'])
    expect(lines[4]).toMatchObject({ index: 5, ms: 0, detail: 'Not run yet.', stage: 'edit' })
  })

  it('marks the stage that was stopped and leaves the rest as not run', () => {
    const lines = buildTrace([record('sources', 400), record('research', 900)], { sources: 's', research: 'r' }, { kind: 'stopped', stage: 'outline' })
    expect(lines[2]).toMatchObject({ name: 'Outline', status: 'skipped', detail: 'Stopped before this stage finished.' })
    expect(lines[3]).toMatchObject({ name: 'Draft', status: 'skipped', detail: 'Not run yet.' })
  })

  it('marks the Sources line as the lookup stage so the trace shows no tokens for it', () => {
    const [line] = buildTrace([record('sources', 700, null, 'ok', null)], {}, null)
    expect(line).toMatchObject({ stage: 'sources', name: 'Sources', ms: 700 })
  })

  it('carries tokens, cost and the served model onto each line', () => {
    const [line] = buildTrace([record('research', 900, FIRST)], {}, null)
    expect(line).toMatchObject({ tokens: 1200, cost: 0.0002, model: MODEL })
  })
})

describe('summarize', () => {
  it('adds up tokens and cost across the calls that reported them', () => {
    const totals = summarize([record('research', 900, FIRST), record('outline', 700, SECOND)])
    expect(totals).toMatchObject({
      calls: 2,
      modelCalls: 2,
      ms: 1_600,
      usageCalls: 2,
      promptTokens: 1_500,
      completionTokens: 300,
      totalTokens: 1_800,
      costCalls: 2,
      models: [MODEL],
    })
    expect(totals.cost).toBeCloseTo(0.0003, 10)
  })

  it('counts the Sources lookup as a call and its time, but not as a model call', () => {
    const totals = summarize([record('sources', 1_100, null, 'ok', null), record('research', 900, FIRST)])
    expect(totals).toMatchObject({ calls: 2, modelCalls: 1, ms: 2_000, usageCalls: 1, totalTokens: 1_200, models: [MODEL] })
  })

  it('reports null, not zero, when no call reported usage', () => {
    const totals = summarize([record('research', 900)])
    expect(totals).toMatchObject({ usageCalls: 0, promptTokens: null, totalTokens: null, costCalls: 0, cost: null })
    expect(totals.models).toEqual([MODEL])
  })

  it('reports tokens but no cost when the calls sent no cost', () => {
    const totals = summarize([record('research', 900, { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 })])
    expect(totals).toMatchObject({ totalTokens: 1_200, costCalls: 0, cost: null })
  })

  it('sums only the calls that reported a cost', () => {
    const totals = summarize([record('research', 900, FIRST), record('outline', 700)])
    expect(totals).toMatchObject({ calls: 2, costCalls: 1, cost: 0.0002 })
  })

  it('counts a failed call that the provider billed', () => {
    const totals = summarize([record('research', 900, FIRST), record('outline', 700, SECOND, 'failed')])
    expect(totals.totalTokens).toBe(1_800)
  })
})

describe('stageViews', () => {
  const states = (views: ReturnType<typeof stageViews>) => views.map(view => view.state)
  const SOURCE_PACK = '[1] Wikipedia: Unit testing\nURL: https://en.wikipedia.org/wiki/Unit_testing\nSummary: A method.'

  it('shows finished stages as done with their word count, and the rest as waiting before a run', () => {
    const views = stageViews({ sources: SOURCE_PACK, research: 'one two three' }, null, null)
    expect(states(views)).toEqual(['done', 'done', 'waiting', 'waiting', 'waiting', 'waiting'])
    expect(views[1]).toMatchObject({ stage: 'research', amount: 3, unit: 'words' })
  })

  it('counts the sources found, not words, for the Sources stage', () => {
    expect(stageViews({ sources: SOURCE_PACK }, null, null)[0]).toMatchObject({ stage: 'sources', amount: 1, unit: 'sources' })
    expect(stageViews({ sources: 'No live sources were found for this topic.' }, null, null)[0]).toMatchObject({ state: 'done', amount: 0 })
  })

  it('marks the running stage and leaves the stages after it waiting', () => {
    expect(states(stageViews({ sources: 's', research: 'r' }, 'outline', null))).toEqual(['done', 'done', 'running', 'waiting', 'waiting', 'waiting'])
  })

  it('marks a failed stage failed and skips the stages after it', () => {
    const views = stageViews({ sources: 's', research: 'r', outline: 'o' }, null, { kind: 'failed', stage: 'draft' })
    expect(states(views)).toEqual(['done', 'done', 'done', 'failed', 'skipped', 'skipped'])
  })

  it('skips the stopped stage and the stages after it, as the trace does', () => {
    const views = stageViews({ sources: 's', research: 'r' }, null, { kind: 'stopped', stage: 'outline' })
    expect(states(views)).toEqual(['done', 'done', 'skipped', 'skipped', 'skipped', 'skipped'])
  })
})

describe('formatting', () => {
  it('shows a cost to five decimal places and a latency in milliseconds', () => {
    expect(formatUsd(0.0002)).toBe('$0.00020')
    expect(formatMs(1234)).toBe('1,234 ms')
    expect(formatCount(1200)).toBe('1,200')
  })
})
