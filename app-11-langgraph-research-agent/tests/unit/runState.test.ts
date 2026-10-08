import { describe, expect, it } from 'vitest'
import type { ResultFrame } from '../../netlify/shared/events'
import { applyFrame, emptyRun, startRun, statusText } from '../../src/lib/runState'

describe('run view', () => {
  it('starts ready, then says it is starting, then names the running node', () => {
    expect(statusText(emptyRun())).toBe('Ready')
    let view = startRun()
    expect(statusText(view)).toBe('Starting the run')
    view = applyFrame(view, { type: 'node_start', node: 'plan', visit: 1, ms: 3 })
    expect(view.marks.plan).toBe('active')
    expect(statusText(view)).toBe('Running: plan')
  })

  it('turns a finished visit into a trace row with its model, tokens and cost', () => {
    let view = applyFrame(startRun(), { type: 'node_start', node: 'plan', visit: 1, ms: 3 })
    view = applyFrame(view, {
      type: 'node_end',
      node: 'plan',
      visit: 1,
      ms: 812,
      status: 'ok',
      detail: 'Planned searches: Expo 98',
      model: 'xiaomi/mimo-v2.6-flash',
      servedModel: 'xiaomi/mimo-v2.6-flash',
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      cost: 0.00002,
      costSource: 'usage',
    })
    expect(view.marks.plan).toBe('ok')
    expect(view.active).toBeNull()
    expect(view.trace).toEqual([
      {
        key: 'plan-1',
        node: 'plan',
        visit: 1,
        status: 'ok',
        ms: 812,
        detail: 'Planned searches: Expo 98',
        model: 'xiaomi/mimo-v2.6-flash',
        servedModel: 'xiaomi/mimo-v2.6-flash',
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
        cost: 0.00002,
        costSource: 'usage',
      },
    ])
  })

  it('keeps one row per visit, so a repeated node shows each visit', () => {
    let view = startRun()
    view = applyFrame(view, { type: 'node_start', node: 'agent', visit: 1, ms: 0 })
    view = applyFrame(view, { type: 'node_end', node: 'agent', visit: 1, ms: 5, status: 'ok', detail: 'Asked.' })
    view = applyFrame(view, { type: 'node_start', node: 'agent', visit: 2, ms: 9 })
    view = applyFrame(view, { type: 'node_end', node: 'agent', visit: 2, ms: 4, status: 'skipped', detail: 'Budget spent.' })
    expect(view.trace.map((row) => [row.key, row.status])).toEqual([
      ['agent-1', 'ok'],
      ['agent-2', 'skipped'],
    ])
  })

  it('records the latest label taken on each conditional edge', () => {
    let view = applyFrame(startRun(), { type: 'edge', from: 'agent', to: 'tools', label: 'tools (round 1 of 4)' })
    view = applyFrame(view, { type: 'edge', from: 'agent', to: 'tools', label: 'tools (round 2 of 4)' })
    expect(view.taken).toEqual({ 'agent>tools': 'tools (round 2 of 4)' })
  })

  it('stores the result and marks the run done', () => {
    const result: ResultFrame = {
      type: 'result',
      answer: 'Answer [1].',
      sources: [{ n: 1, title: 'Expo 98', url: 'https://en.wikipedia.org/wiki/Expo_98' }],
      critic: { verdict: 'accept', notes: '', reviewed: true },
      path: ['plan', 'agent', 'draft', 'critic', 'final'],
      evidenceCount: 1,
      toolRounds: 0,
      revisions: 0,
      truncated: false,
      totals: { ms: 4000, unpricedRows: 0 },
      models: ['xiaomi/mimo-v2.6-flash'],
    }
    const view = applyFrame(startRun(), result)
    expect(view).toMatchObject({ phase: 'done', result, error: null })
    expect(statusText(view)).toBe('Answer ready')
  })

  it('shows a visit still running as failed when the error arrives, and leaves finished visits alone', () => {
    let view = applyFrame(startRun(), { type: 'node_start', node: 'agent', visit: 1, ms: 0 })
    view = applyFrame(view, { type: 'node_end', node: 'agent', visit: 1, ms: 5, status: 'ok', detail: 'Asked.' })
    view = applyFrame(view, { type: 'node_start', node: 'draft', visit: 1, ms: 9 })
    view = applyFrame(view, { type: 'error', message: 'The AI provider did not answer in time.' })

    expect(view.trace.map((row) => [row.key, row.status, row.detail])).toEqual([
      ['agent-1', 'ok', 'Asked.'],
      ['draft-1', 'failed', 'The AI provider did not answer in time.'],
    ])
    expect(view.marks.draft).toBe('failed')
    expect(view.active).toBeNull()
  })

  it('marks the run failed with the plain message from the server', () => {
    const view = applyFrame(startRun(), { type: 'error', message: 'The AI provider did not answer in time.' })
    expect(view).toMatchObject({ phase: 'failed', error: 'The AI provider did not answer in time.' })
    expect(statusText(view)).toBe('Failed')
  })
})
