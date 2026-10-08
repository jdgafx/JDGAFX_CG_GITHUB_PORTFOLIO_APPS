import { describe, expect, it } from 'vitest'
import { STAGE_LABELS, type CallRecord, type StageId, type Usage } from '../../src/lib/api'
import {
  buildTrace, formatCount, formatMs, formatUsd, keepsFinishedStages, runKeyFor, stageViews, summarize, wordCount,
} from '../../src/lib/run'

const MODEL = 'anthropic/claude-haiku-4.5'
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
      [record('research', 900), record('outline', 800), record('draft', 2_000, null, 'failed')],
      { research: 'r', outline: 'o' },
      { kind: 'failed', stage: 'draft' },
    )
    expect(lines.map(line => line.status)).toEqual(['ok', 'ok', 'failed', 'skipped', 'skipped'])
    expect(lines.slice(3).map(line => line.name)).toEqual(['Edit', 'Polish'])
    expect(lines[3]).toMatchObject({ index: 4, ms: 0, detail: 'Not run yet.' })
  })

  it('marks the stage that was stopped and leaves the rest as not run', () => {
    const lines = buildTrace([record('research', 900)], { research: 'r' }, { kind: 'stopped', stage: 'outline' })
    expect(lines[1]).toMatchObject({ name: 'Outline', status: 'skipped', detail: 'Stopped before this stage finished.' })
    expect(lines[2]).toMatchObject({ name: 'Draft', status: 'skipped', detail: 'Not run yet.' })
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

describe('resume', () => {
  it('keeps finished stages only when a resume continues the same topic and format', () => {
    const key = runKeyFor('Why unit tests matter for small teams', 'Blog Post')
    expect(keepsFinishedStages(key, key, true)).toBe(true)
    expect(keepsFinishedStages(key, key, false)).toBe(false)
    expect(keepsFinishedStages(key, runKeyFor('Why unit tests matter for small teams', 'Newsletter'), true)).toBe(false)
    expect(keepsFinishedStages(key, runKeyFor('A different topic', 'Blog Post'), true)).toBe(false)
    expect(keepsFinishedStages('', key, true)).toBe(false)
  })
})

describe('stageViews', () => {
  const states = (views: ReturnType<typeof stageViews>) => views.map(view => view.state)

  it('shows finished stages as done with their word count, and the rest as waiting before a run', () => {
    const views = stageViews({ research: 'one two three' }, null, null)
    expect(states(views)).toEqual(['done', 'waiting', 'waiting', 'waiting', 'waiting'])
    expect(views[0]).toMatchObject({ stage: 'research', words: 3 })
  })

  it('marks the running stage and leaves the stages after it waiting', () => {
    expect(states(stageViews({ research: 'r' }, 'outline', null))).toEqual(['done', 'running', 'waiting', 'waiting', 'waiting'])
  })

  it('marks a failed stage failed and skips the stages after it', () => {
    const views = stageViews({ research: 'r', outline: 'o' }, null, { kind: 'failed', stage: 'draft' })
    expect(states(views)).toEqual(['done', 'done', 'failed', 'skipped', 'skipped'])
  })

  it('skips the stopped stage and the stages after it, as the trace does', () => {
    const views = stageViews({ research: 'r' }, null, { kind: 'stopped', stage: 'outline' })
    expect(states(views)).toEqual(['done', 'skipped', 'skipped', 'skipped', 'skipped'])
  })
})

describe('formatting', () => {
  it('shows a cost to five decimal places and a latency in milliseconds', () => {
    expect(formatUsd(0.0002)).toBe('$0.00020')
    expect(formatMs(1234)).toBe('1,234 ms')
    expect(formatCount(1200)).toBe('1,200')
  })

  it('counts words in a stage output', () => {
    expect(wordCount('  one two\nthree ')).toBe(3)
  })
})
