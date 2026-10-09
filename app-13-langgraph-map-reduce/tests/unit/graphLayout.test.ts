import { describe, expect, it } from 'vitest'
import { graphLayout } from '../../src/lib/graphLayout'
import { laneFor } from '../../src/lib/trace'
import { loopShort, pathSteps } from '../../src/lib/status'
import { applyFrame, initialView, type RunView } from '../../src/lib/view'
import type { Frame, TraceRow } from '../../src/types/frames'

describe('graph layout', () => {
  it.each([1, 6, 7, 12])('draws %i chunks inside its own canvas, narrow and wide', (n) => {
    for (const narrow of [false, true]) {
      const layout = graphLayout(n, narrow)
      expect(layout.pills).toHaveLength(n)
      const boxes = [...layout.pills, ...Object.values(layout.stages), layout.fan]
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w).toBeLessThanOrEqual(layout.width)
        expect(b.y + b.h).toBeLessThanOrEqual(layout.height)
      }
    }
  })

  it('draws a line to and from every chunk up to six, and one block arrow either side above that', () => {
    expect(graphLayout(6, false).edges.filter((e) => e.key.startsWith('split>fan'))).toHaveLength(6)
    expect(graphLayout(7, false).edges.filter((e) => e.key.startsWith('split>fan'))).toHaveLength(1)
    expect(graphLayout(3, true).block).toBe(true)
  })

  it('never overlaps two chunk boxes', () => {
    const { pills } = graphLayout(12, false)
    for (const a of pills)
      for (const b of pills)
        if (a.chunk < b.chunk) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
  })

  it('clamps the chunk count to 1..12', () => {
    expect(graphLayout(0, false).pills).toHaveLength(1)
    expect(graphLayout(40, true).pills).toHaveLength(12)
  })
})

const row = (node: TraceRow['node'], ms: number, chunk?: number): TraceRow => ({ node, status: 'ok', ms, detail: '', ...(chunk ? { chunk } : {}) })

describe('trace lanes', () => {
  it('places parallel chunk rows by their own start so they overlap', () => {
    const lanes = laneFor(
      [row('split', 10), row('extract', 2000, 1), row('extract', 3000, 2)],
      [{ node: 'split', ms: 0 }, { node: 'extract', chunk: 1, ms: 100 }, { node: 'extract', chunk: 2, ms: 120 }],
      4000,
    )
    expect(lanes[1]).toEqual({ left: 2.5, width: 50 })
    expect(lanes[2]).toEqual({ left: 3, width: 75 })
  })

  it('gives a retried chunk its second start, and no lane when a start is unknown', () => {
    const lanes = laneFor(
      [row('extract', 1000, 2), row('extract', 1000, 2), row('check', 5)],
      [{ node: 'extract', chunk: 2, ms: 0 }, { node: 'extract', chunk: 2, ms: 5000 }],
      6000,
    )
    expect(lanes[0]?.left).toBe(0)
    expect(lanes[1]?.left).toBeCloseTo(83.33, 1)
    expect(lanes[2]).toBeNull()
  })
})

describe('path line and loop label', () => {
  const frames: Frame[] = [
    { type: 'node_start', node: 'split', ms: 0, detail: 's' },
    { type: 'node_end', ...row('split', 3) },
    { type: 'edge', from: 'split', to: 'extract', label: 'fan out: 2 chunks', count: 2 },
    { type: 'node_start', node: 'extract', ms: 5, detail: 'chunk 1 of 2', chunk: 1 },
    { type: 'node_end', ...row('extract', 900, 1) },
    { type: 'node_start', node: 'extract', ms: 6, detail: 'chunk 2 of 2', chunk: 2 },
  ]
  const view: RunView = frames.reduce(applyFrame, { ...initialView(), phase: 'running' as const })

  it('collapses extract rows and marks the running step', () => {
    expect(pathSteps(view)).toEqual([
      { label: 'split', now: false },
      { label: 'extract, 1 chunk', now: true },
    ])
  })

  it('remembers when each step began, from the server offsets', () => {
    expect(view.starts.map((s) => [s.node, s.chunk, s.ms])).toEqual([
      ['split', undefined, 0],
      ['extract', 1, 5],
      ['extract', 2, 6],
    ])
  })

  it('shows a short loop label: the retry, the complete coverage, or the default', () => {
    expect(loopShort(view)).toBe('Retry if chunks are missing')
    expect(loopShort({ ...view, edges: ['coverage complete'] })).toBe('Coverage complete')
    expect(loopShort({ ...view, retryLabel: 'retry 2 missing chunks' })).toBe('Retry 2 missing chunks')
  })
})
