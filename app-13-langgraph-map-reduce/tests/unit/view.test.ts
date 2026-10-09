import { describe, expect, it } from 'vitest'
import type { Frame, TraceRow } from '../../src/types/frames'
import { applyFrame, endView, failView, initialView, stopView } from '../../src/lib/view'

const row = (over: Partial<TraceRow> & Pick<TraceRow, 'node' | 'status'>): Frame => ({
  type: 'node_end',
  ms: 10,
  detail: 'chunk 1 of 2',
  ...over,
})

describe('applyFrame', () => {
  it('shows parallel branches, the retry loop and the finished result from the frame sequence', () => {
    const frames: Frame[] = [
      { type: 'node_start', node: 'split', ms: 1, detail: 'Splitting' },
      row({ node: 'split', status: 'ok', detail: '2 chunks' }),
      { type: 'edge', from: 'split', to: 'extract', label: 'fan out: 2 chunks' },
      { type: 'node_start', node: 'extract', ms: 2, detail: 'chunk 1 of 2', chunk: 1 },
      { type: 'node_start', node: 'extract', ms: 2, detail: 'chunk 2 of 2', chunk: 2 },
      row({ node: 'extract', status: 'ok', chunk: 1, detail: 'chunk 1 of 2' }),
      row({ node: 'extract', status: 'failed', chunk: 2, detail: 'chunk 2 of 2', message: 'Timed out.' }),
      { type: 'edge', from: 'check', to: 'extract', label: 'retry 1 missing chunks' },
    ]

    const view = frames.reduce(applyFrame, { ...initialView(), phase: 'running' as const })

    expect(view.stages.split).toBe('ok')
    expect(view.branches).toEqual([
      { chunk: 1, status: 'ok', attempts: 1, detail: 'chunk 1 of 2' },
      { chunk: 2, status: 'failed', attempts: 1, detail: 'Timed out.' },
    ])
    expect(view.retryLabel).toBe('retry 1 missing chunks')
    expect(view.rows).toHaveLength(3)
  })

  it('counts a retried chunk as a second attempt', () => {
    const view = [
      { type: 'node_start', node: 'extract', ms: 1, detail: 'chunk 2 of 2', chunk: 2 } as Frame,
      row({ node: 'extract', status: 'failed', chunk: 2, detail: 'chunk 2 of 2', message: 'Timed out.' }),
      { type: 'node_start', node: 'extract', ms: 9, detail: 'chunk 2 of 2 (retry)', chunk: 2 } as Frame,
    ].reduce(applyFrame, { ...initialView(), phase: 'running' as const })

    expect(view.branches[0]).toMatchObject({ chunk: 2, status: 'running', attempts: 2 })
  })

  it('moves to done on a result frame and keeps the outcome', () => {
    const view = applyFrame(
      { ...initialView(), phase: 'running' as const },
      {
        type: 'result',
        result: {
          summary: { overview: 'o', sections: [] },
          coverage: { covered: [1], missing: [], noPoints: [] },
          reviewFlags: [],
          entities: [],
          retries: 0,
          chunkCount: 1,
          findingCount: 1,
          notice: null,
          retryOutcome: 'none',
          metrics: {
            totalMs: 5,
            totalTokens: 10,
            totalCost: null,
            costSource: null,
            cheapCost: null,
            cheapCalls: 0,
            synthesisCost: null,
          },
        },
      },
    )

    expect(view.phase).toBe('done')
    expect(view.result?.coverage.covered).toEqual([1])
  })
})

describe('chunks that wait for a slot', () => {
  const fan: Frame = { type: 'edge', from: 'split', to: 'extract', label: 'fan out: 6 chunks', count: 6 }
  const start = (chunk: number): Frame => ({ type: 'node_start', node: 'extract', ms: 1, detail: `chunk ${chunk} of 6`, chunk })
  const running = { ...initialView(), phase: 'running' as const }

  it('shows every chunk as waiting after the split and running only once it starts', () => {
    const view = [fan, start(1), start(2), start(3), start(4)].reduce(applyFrame, running)

    expect(view.branches.map((b) => b.status)).toEqual(['running', 'running', 'running', 'running', 'idle', 'idle'])
    expect(view.branches.filter((b) => b.status === 'running')).toHaveLength(4)
    expect(view.branches[4]).toMatchObject({ chunk: 5, attempts: 0 })
  })

  it('does not reset a chunk that has already started when the fan-out arrives late', () => {
    const view = [start(2), fan].reduce(applyFrame, running)

    expect(view.branches.find((b) => b.chunk === 2)?.status).toBe('running')
    expect(view.branches).toHaveLength(6)
  })

  it('ends a waiting chunk as failed when the run fails', () => {
    const view = failView([fan, start(1)].reduce(applyFrame, running), 'x')

    expect(view.branches.map((b) => b.status)).toEqual(['failed', 'failed', 'failed', 'failed', 'failed', 'failed'])
  })

  it('ends a waiting chunk as stopped when the reader stops the run', () => {
    const view = stopView([fan, start(1)].reduce(applyFrame, running))

    expect(view.branches.map((b) => b.status)).toEqual(['stopped', 'stopped', 'stopped', 'stopped', 'stopped', 'stopped'])
  })
})

describe('the result frame keeps the streamed states', () => {
  const result: Frame = {
    type: 'result',
    result: {
      summary: { overview: 'o', sections: [] },
      coverage: { covered: [1], missing: [], noPoints: [] },
      reviewFlags: [],
      entities: [],
      retries: 1,
      chunkCount: 1,
      findingCount: 1,
      notice: 'The retry did not finish in time, so the summary is from the first pass.',
      retryOutcome: 'skipped',
      metrics: { totalMs: 5, totalTokens: 10, totalCost: null, costSource: null, cheapCost: null, cheapCalls: 0, synthesisCost: null },
    },
  }
  const running = { ...initialView(), phase: 'running' as const }

  it('does not mark a step Done that failed, or one that never ran', () => {
    const view = [
      { type: 'node_start', node: 'synthesize', ms: 1, detail: 'Writing' } as Frame,
      row({ node: 'synthesize', status: 'failed', detail: 'Cut off by the time limit', message: 'Cut off by the time limit' }),
      result,
    ].reduce(applyFrame, running)

    expect(view.phase).toBe('done')
    expect(view.stages.synthesize).toBe('failed')
    expect(view.stages.check).toBe('idle')
    expect(view.stages.final).toBe('idle')
  })

  it('closes a step still running as stopped, and shows a final row as Done', () => {
    const view = [
      { type: 'node_start', node: 'check', ms: 1, detail: 'Checking' } as Frame,
      { type: 'node_start', node: 'final', ms: 2, detail: 'Finishing' } as Frame,
      row({ node: 'final', status: 'ok', detail: 'Kept the first-pass summary' }),
      result,
    ].reduce(applyFrame, running)

    expect(view.stages.check).toBe('stopped')
    expect(view.stages.final).toBe('ok')
    expect(view.rows.map((r) => r.node)).toEqual(['final'])
  })
})

describe('failure handling', () => {
  it('marks running stages and branches as failed when an error frame arrives', () => {
    const started = applyFrame(
      { ...initialView(), phase: 'running' as const },
      { type: 'node_start', node: 'extract', ms: 1, detail: 'chunk 1 of 1', chunk: 1 },
    )
    const failed = applyFrame(started, { type: 'error', message: 'The AI provider rejected the key or is out of credit.' })

    expect(failed.phase).toBe('error')
    expect(failed.error).toBe('The AI provider rejected the key or is out of credit.')
    expect(failed.branches[0]?.status).toBe('failed')
  })

  it('treats a stream that ends with no result as a failed run', () => {
    const view = endView({ ...initialView(), phase: 'running' as const })

    expect(view.phase).toBe('error')
    expect(view.error).toBe('The run ended before a result was ready. Please try again.')
  })

  it('leaves a finished run alone when the stream closes', () => {
    const done = { ...initialView(), phase: 'done' as const }

    expect(endView(done)).toBe(done)
    expect(failView(done, 'x').phase).toBe('error')
  })
})
