import { describe, expect, it } from 'vitest'
import { buildRows, lanes } from '../../src/lib/traceRows'
import type { TraceStep } from '../../src/lib/api'

const step = (name: string, ms: number, status: TraceStep['status'] = 'ok'): TraceStep => ({ name, status, ms, detail: 'x' })

describe('trace waterfall', () => {
  it('places each finished step after the ones before it, as shares of the total', () => {
    const rows = buildRows([step('Build request', 100), step('Call model', 300), step('Stream answer', 600)], 'running', true)
    const bars = lanes(rows)
    // 1000 ms done, a quarter reserved for the running step: the axis is 1250 ms.
    expect(bars[0]).toEqual({ left: 0, width: 8 })
    expect(bars[1]).toEqual({ left: 8, width: 24 })
    expect(bars[2]).toEqual({ left: 32, width: 48 })
    expect(bars[3]).toEqual({ left: 80, width: 20 })
  })

  it('draws the running step from where the finished ones end to the right edge of the axis', () => {
    const rows = buildRows([step('Build request', 100), step('Call model', 300)], 'running', false)
    expect(rows[2].state).toBe('running')
    expect(lanes(rows)[2]).toEqual({ left: 80, width: 20 })
  })

  it('fills the whole lane for a first step that is running', () => {
    expect(lanes(buildRows([], 'running', false))[0]).toEqual({ left: 0, width: 100 })
  })

  it('has no bars before a run, and marks the step a stop interrupted', () => {
    expect(lanes(buildRows([], 'idle', false)).every((bar) => bar === null)).toBe(true)
    const stopped = buildRows([step('Build request', 20)], 'stopped', false)
    expect(stopped.map((r) => r.state)).toEqual(['ok', 'stopped', 'notRun', 'notRun', 'notRun'])
  })
})
