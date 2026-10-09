import { describe, expect, it } from 'vitest'
import { initialRunState, runReducer, type RunAction, type RunState } from '../../src/lib/runState'
import type { BotStep, ObservedPage, PlanResponse } from '../../src/types'

const navigate: BotStep = { action: 'navigate', target: 'Google home page', thought: 'Open the home page.', url: 'https://www.google.com/' }
const observed: ObservedPage = { url: 'https://www.google.com/', title: 'Google', excerpt: 'Google Search' }
const plan: PlanResponse = {
  result: { steps: [navigate] },
  trace: [{ name: 'Model call', status: 'ok', ms: 812, detail: 'Served by m.' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 },
  model: 'anthropic/claude-haiku-5.5',
  totalMs: 800,
}
const NETWORK = 'Could not reach the server. Check your connection and try again.'

function run(state: RunState, ...actions: RunAction[]): RunState {
  return actions.reduce((current, action) => runReducer(current, action), state)
}

const planned = run(initialRunState, { type: 'planned', plan })
const running = run(planned, { type: 'running', replay: false })

describe('planning', () => {
  it('stores the plan, its usage, the served model and the planner time', () => {
    expect(planned.steps).toEqual([navigate])
    expect(planned.usage?.total_tokens).toBe(15)
    expect(planned.model).toBe('anthropic/claude-haiku-5.5')
    expect(planned.planMs).toBe(800)
    expect(planned.planTrace).toHaveLength(1)
  })

  it('records a planning failure with a failed trace entry when the server sent none', () => {
    const failed = run(initialRunState, { type: 'planFailed', message: NETWORK, trace: [] })
    expect(failed.phase).toBe('failed')
    expect(failed.steps).toEqual([])
    expect(failed.error).toEqual({ message: NETWORK, index: null })
    expect(failed.planTrace).toEqual([{ name: 'Planner request', status: 'failed', ms: 0, detail: NETWORK }])
  })

  it('does not add a second failed entry when the server already marked one', () => {
    const failed = run(initialRunState, {
      type: 'planFailed',
      message: 'The AI provider rejected the key or is out of credit',
      trace: [{ name: 'Model call', status: 'failed', ms: 40, detail: 'The AI provider rejected the key or is out of credit' }],
    })
    expect(failed.planTrace).toHaveLength(1)
    expect(failed.planTrace[0].name).toBe('Model call')
  })
})

describe('running', () => {
  it('keeps the planner time for a live run and drops it for a replay', () => {
    expect(running.phase).toBe('running')
    expect(running.planMs).toBe(800)
    expect(running.rows).toEqual([])
    expect(run(planned, { type: 'running', replay: true }).planMs).toBeNull()
  })

  it('updates a planned step in place from running to its result', () => {
    const started = run(running, { type: 'event', event: { type: 'step_start', index: 0, name: 'Navigate: Google home page' } })
    expect(started.rows).toEqual([{ index: 0, name: 'Navigate: Google home page', status: 'running', ms: 0, detail: 'Running.' }])

    const done = run(started, {
      type: 'event',
      event: { type: 'step_complete', index: 0, name: 'Navigate: Google home page', status: 'ok', ms: 500, detail: 'Opened www.google.com.', observed },
    })
    expect(done.rows).toHaveLength(1)
    expect(done.rows[0]).toMatchObject({ status: 'ok', ms: 500, detail: 'Opened www.google.com.', observed })
    expect(done.observed).toEqual(observed)
  })

  it('records the browser version, stage rows and the final page', () => {
    const session = run(running,
      { type: 'event', event: { type: 'browser', version: '153.0.8010.0' } },
      { type: 'event', event: { type: 'stage', name: 'Launch browser', status: 'ok', ms: 30, detail: 'Connected to the browser.' } },
      { type: 'event', event: { type: 'result', ms: 12, observed } },
    )
    expect(session.browser).toBe('153.0.8010.0')
    expect(session.rows.map((row) => [row.index, row.name])).toEqual([
      [null, 'Launch browser'],
      [null, 'Read final page'],
    ])
    expect(session.rows[1].detail).toBe('Final page: Google.')
  })

  it('completes on done, and a done after an error does not reopen the run', () => {
    const complete = run(running, { type: 'event', event: { type: 'done', totalMs: 5000 } })
    expect(complete.phase).toBe('complete')
    expect(complete.runMs).toBe(5000)

    const failed = run(running,
      { type: 'event', event: { type: 'error', message: 'The target was not found: page title.', index: 0 } },
      { type: 'event', event: { type: 'done', totalMs: 9000 } },
    )
    expect(failed.phase).toBe('failed')
    expect(failed.error).toEqual({ message: 'The target was not found: page title.', index: 0 })
  })

  it('adds a failed row for an error the server sent without one', () => {
    const failed = run(running, { type: 'event', event: { type: 'error', message: 'The browser run failed before it finished. Try again in a moment.', index: null } })
    expect(failed.rows).toEqual([{
      index: null,
      name: 'Browser run',
      status: 'failed',
      ms: 0,
      detail: 'The browser run failed before it finished. Try again in a moment.',
    }])
  })

  it('turns a running row into a failure when the stream fails, without a second row', () => {
    const withRow = run(running, { type: 'event', event: { type: 'step_start', index: 0, name: 'Navigate: Google home page' } })
    const failed = run(withRow, { type: 'runFailed', message: NETWORK })
    expect(failed.phase).toBe('failed')
    expect(failed.rows).toHaveLength(1)
    expect(failed.rows[0]).toMatchObject({ status: 'failed', detail: 'No result arrived for this step.' })
    expect(failed.error).toEqual({ message: NETWORK, index: null })
  })

  it('adds a failed row when the stream fails before any row exists', () => {
    const failed = run(running, { type: 'runFailed', message: NETWORK })
    expect(failed.rows).toEqual([{ index: null, name: 'Browser run', status: 'failed', ms: 0, detail: NETWORK }])
  })

  it('reports a stream that ends early, and leaves a finished run alone', () => {
    const ended = run(running, { type: 'streamEnded' })
    expect(ended.phase).toBe('failed')
    expect(ended.error).toEqual({ message: 'The run ended before it reported a result.', index: null })

    const complete = run(running, { type: 'event', event: { type: 'done', totalMs: 1 } })
    expect(runReducer(complete, { type: 'streamEnded' })).toBe(complete)
  })

  it('marks live rows as skipped when the user stops the run', () => {
    const withRow = run(running, { type: 'event', event: { type: 'step_start', index: 0, name: 'Navigate: Google home page' } })
    const stopped = run(withRow, { type: 'stopped' })
    expect(stopped.phase).toBe('stopped')
    expect(stopped.rows[0]).toMatchObject({ status: 'skipped', detail: 'Stopped before this step finished.' })
  })

  it('records that the browser close is not reported after a stop', () => {
    const stopped = run(running, { type: 'stopped' })
    expect(stopped.rows.at(-1)).toEqual({
      index: null,
      name: 'Close browser',
      status: 'skipped',
      ms: 0,
      detail: 'Stop ends the stream. The server closes the browser when its current step ends. The result is not reported to this page.',
    })  })

  it('returns to the empty state on reset', () => {
    expect(run(running, { type: 'reset' })).toEqual({ ...initialRunState, runId: running.runId + 1 })
  })
})
