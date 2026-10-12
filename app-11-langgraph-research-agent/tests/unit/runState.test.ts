import { describe, expect, it } from 'vitest'
import type { ResultFrame } from '../../netlify/shared/events'
import { applyFrame, emptyRun, failRun, liveData, researchStatus, startRun, statusText } from '../../src/lib/runState'

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

  it('keeps the usage and the unreported calls of a failed step on its row', () => {
    const view = applyFrame(startRun(), {
      type: 'node_end', node: 'draft', visit: 1, ms: 5, status: 'failed', detail: 'The draft came back empty.',
      model: 'm', servedModel: 'anthropic/claude-haiku-5.5', usage: { total_tokens: 140 }, cost: 0.00003, unreportedCalls: 1,
    })
    expect(view.trace[0]).toMatchObject({ status: 'failed', usage: { total_tokens: 140 }, cost: 0.00003, unreportedCalls: 1 })
  })

  it('records the latest label taken on each conditional edge', () => {
    let view = applyFrame(startRun(), { type: 'edge', from: 'agent', to: 'tools', label: 'tools (round 1 of 4)' })
    view = applyFrame(view, { type: 'edge', from: 'agent', to: 'tools', label: 'tools (round 2 of 4)' })
    expect(view.taken).toEqual({ 'agent>tools': 'tools (round 2 of 4)' })
  })

  const resultFrame = (overrides: Partial<ResultFrame> = {}): ResultFrame => ({
    type: 'result',
    answer: 'Answer [1].',
    sources: [{ n: 1, title: 'Expo 98', url: 'https://en.wikipedia.org/wiki/Expo_98' }],
    critic: { verdict: 'accept', notes: '', reviewed: true },
    ending: { kind: 'complete', message: '' },
    citation: { sentences: 1, uncited: [] },
    path: ['plan', 'agent', 'draft', 'critic', 'final'],
    evidenceCount: 1,
    toolRounds: 0,
    revisions: 0,
    truncated: false,
    totals: { ms: 4000, unpricedRows: 0, unreportedCalls: 0, refusedCalls: 0 },
    models: ['qwen/qwen3.7-flash'],
    ...overrides,
  })

  it('keeps the run id from the first frame, and clears it for the next run', () => {
    const view = applyFrame(startRun(), { type: 'run_start', runId: 'a1b2c3d4' })
    expect(view).toMatchObject({ runId: 'a1b2c3d4', phase: 'running' })
    expect(applyFrame(view, { type: 'node_start', node: 'plan', visit: 1, ms: 0 }).runId).toBe('a1b2c3d4')
    expect(startRun().runId).toBeNull()
  })

  it('stores the result and marks the run done', () => {
    const result = resultFrame()
    const view = applyFrame(startRun(), result)
    expect(view).toMatchObject({ phase: 'done', result, error: null })
    expect(statusText(view)).toBe('Answer ready')
    expect(researchStatus(view)).toBe('Research finished. The cited answer is ready.')
  })

  it('says what is true when the answer cites nothing, and when the run stopped early', () => {
    const noSource = applyFrame(startRun(), resultFrame({ answer: 'The sources do not say.', sources: [] }))
    expect(researchStatus(noSource)).toBe('Research finished. The answer cites no source.')

    const partial = applyFrame(
      startRun(),
      resultFrame({ ending: { kind: 'partial', message: 'Unreviewed: the time limit ended the review.' } }),
    )
    expect(statusText(partial)).toBe('Partial answer')
    expect(researchStatus(partial)).toBe('Research stopped early. The answer is the last draft, labelled below.')

    const none = applyFrame(startRun(), resultFrame({ answer: '', ending: { kind: 'no_answer', message: 'No answer was written.' } }))
    expect(statusText(none)).toBe('No answer')
    expect(researchStatus(none)).toBe('Research stopped early. No answer was written. The pages read are listed.')
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

  it('ends a run whose Wikipedia reads all failed as Failed, with the live chip failed, never as Answer ready', () => {
    let view = applyFrame(startRun(), { type: 'node_end', node: 'tools', visit: 1, ms: 3, status: 'ok', detail: 'No new source. Could not reach Wikipedia.' })
    view = applyFrame(view, { type: 'node_start', node: 'draft', visit: 1, ms: 9 })
    view = applyFrame(view, { type: 'node_end', node: 'draft', visit: 1, ms: 1, status: 'failed', detail: 'Wikipedia could not be reached, so no page was read and nothing was researched. Please try again.' })
    view = applyFrame(view, { type: 'error', message: 'Wikipedia could not be reached, so no page was read and nothing was researched. Please try again.' })
    expect(view.phase).toBe('failed')
    expect(view.result).toBeNull()
    expect(statusText(view)).toBe('Failed')
    expect(researchStatus(view)).toBe('Research failed. The answer panel says why.')
    expect(liveData(view).state).toBe('failed')
  })

  it('does not call an answer with an uncited sentence ready', () => {
    const view = applyFrame(startRun(), resultFrame({ citation: { sentences: 2, uncited: ['1931 minus 1889 is 42 years.'] } }))
    expect(statusText(view)).toBe('Not fully cited')
    expect(researchStatus(view)).toBe('Research finished. 1 sentence(s) of the answer are marked not cited.')
    expect(statusText(applyFrame(startRun(), resultFrame()))).toBe('Answer ready')
  })
})

describe('a resumed run', () => {
  it('marks kept steps as reused, the visitor\'s step as edited, and later steps by their own status', () => {
    let view = startRun()
    view = applyFrame(view, { type: 'node_end', node: 'plan', visit: 1, ms: 1491, status: 'ok', detail: 'Planned.', reused: true })
    view = applyFrame(view, { type: 'node_end', node: 'critic', visit: 1, ms: 0, status: 'ok', detail: 'Replaced.', edited: true })
    expect(view.marks).toMatchObject({ plan: 'reused', critic: 'edited', draft: 'idle' })
    expect(view.trace.map((row) => [row.key, row.reused, row.edited])).toEqual([
      ['plan-1', true, undefined],
      ['critic-1', undefined, true],
    ])
    view = applyFrame(view, { type: 'node_start', node: 'critic', visit: 2, ms: 3 })
    view = applyFrame(view, { type: 'node_end', node: 'critic', visit: 2, ms: 1523, status: 'ok', detail: 'Accepted.' })
    expect(view.marks.critic).toBe('ok')
  })

  it('keeps the offered checkpoints', () => {
    const view = applyFrame(startRun(), { type: 'checkpoints', items: [{ kind: 'plan', visit: 1, token: 't', queries: ['q'], sources: [] }] })
    expect(view.checkpoints).toHaveLength(1)
  })

  it('does not call a re-run answer ready when the critic still asked for changes', () => {
    const frame = (verdict: 'accept' | 'revise'): ResultFrame => ({
      type: 'result', answer: 'A [1].', sources: [], critic: { verdict, notes: 'n', reviewed: true }, ending: { kind: 'complete', message: '' }, citation: { sentences: 1, uncited: [] },
      path: [], evidenceCount: 1, toolRounds: 1, revisions: 2, truncated: false, totals: { ms: 1, unpricedRows: 0, unreportedCalls: 0, refusedCalls: 0 }, models: [],
      fork: { kind: 'plan', visit: 1, reused: 0, rerun: 8 },
    })
    expect(statusText(applyFrame(startRun(), frame('accept')))).toBe('New answer ready')
    expect(statusText(applyFrame(startRun(), frame('revise')))).toBe('New answer, critic not satisfied')
  })

  it('says what a re-run did, not that research finished, and keeps the clock of a failed re-run', () => {
    let view = startRun()
    view = applyFrame(view, { type: 'node_end', node: 'plan', visit: 1, ms: 1491, status: 'ok', detail: 'Planned.', reused: true })
    expect(researchStatus(view)).toBe('Re-run in progress.')
    const failed = failRun(view, 'The run reached its time limit before this step finished.')
    expect(researchStatus(failed)).toBe('Re-run failed. The original run is still here: edit and re-run, or go back to it.')
    expect(failed.startedAt).not.toBeNull()
    expect(failed.endedAt).toBeGreaterThanOrEqual(failed.startedAt as number)
    expect(researchStatus(startRun())).toBe('Starting research.')
  })
})
