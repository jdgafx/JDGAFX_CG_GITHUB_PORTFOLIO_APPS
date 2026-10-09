import { describe, expect, it } from 'vitest'
import {
  applyFrame,
  emptyRun,
  failRun,
  researchStatus,
  startRun,
  statusText,
  stopRun,
  type RunView,
} from '../../src/lib/runState'

function running(): RunView {
  let view = startRun()
  view = applyFrame(view, { type: 'node_start', node: 'plan', visit: 1, ms: 0 })
  view = applyFrame(view, { type: 'node_end', node: 'plan', visit: 1, ms: 40, status: 'ok', detail: 'Planned searches.' })
  return applyFrame(view, { type: 'node_start', node: 'agent', visit: 1, ms: 50 })
}

describe('stopRun', () => {
  it('marks the step in progress as stopped and ends its running row', () => {
    const view = stopRun(running())
    expect(view).toMatchObject({ phase: 'stopped', active: null, error: null })
    expect(view.marks.agent).toBe('stopped')
    expect(view.marks.plan).toBe('ok')
    expect(view.trace.map((row) => [row.node, row.status])).toEqual([
      ['plan', 'ok'],
      ['agent', 'stopped'],
    ])
    expect(statusText(view)).toBe('Stopped')
    expect(researchStatus(view)).toBe('Research stopped. Steps that finished are still in the trace.')
  })
})

describe('failRun', () => {
  it('marks the step in progress as failed and gives its row the message', () => {
    const message = 'The answer stream was interrupted before the run finished.'
    const view = failRun(running(), message)
    expect(view).toMatchObject({ phase: 'failed', active: null, error: message })
    expect(view.marks.agent).toBe('failed')
    expect(view.trace[1]).toMatchObject({ node: 'agent', status: 'failed', detail: message })
  })
})

describe('researchStatus', () => {
  it('names the verb of the primary button in each phase', () => {
    expect(researchStatus(emptyRun())).toBe('Ready. Start research when the question is set.')
    expect(researchStatus(startRun())).toBe('Starting research.')
    expect(researchStatus(running())).toBe('Research running. Current step: agent.')
  })

  it('never says the run is starting once a step has begun, even in the gap between two steps', () => {
    let view = startRun()
    view = applyFrame(view, { type: 'node_start', node: 'plan', visit: 1, ms: 0 })
    view = applyFrame(view, { type: 'node_end', node: 'plan', visit: 1, ms: 40, status: 'ok', detail: 'Planned searches.' })
    // The step ended and the next one has not started: no node is active, and the trace already has a row.
    expect(view.active).toBeNull()
    expect(researchStatus(view)).toBe('Research running.')
    expect(statusText(view)).toBe('Running')
    // Before any step has begun the starting words still apply.
    expect(researchStatus(startRun())).toBe('Starting research.')
    expect(statusText(startRun())).toBe('Starting the run')
  })
})
