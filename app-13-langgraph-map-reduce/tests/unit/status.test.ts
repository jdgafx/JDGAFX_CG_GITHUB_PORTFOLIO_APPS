import { describe, expect, it } from 'vitest'
import { runningStep, stageWord, statusLine } from '../../src/lib/status'
import { applyFrame, initialView, type RunView } from '../../src/lib/view'
import type { Frame, TraceRow } from '../../src/types/frames'

const running = (): RunView => ({ ...initialView(), phase: 'running' })
const end = (over: Partial<TraceRow> & Pick<TraceRow, 'node'>): Frame => ({
  type: 'node_end',
  status: 'ok',
  ms: 1,
  detail: 'done',
  ...over,
})

describe('the running status line', () => {
  it('says the run is starting only before the first event', () => {
    expect(statusLine(running(), 0, true)).toBe('Analyzing. Starting the run.')
  })

  it('keeps the last specific step through the gap between the check and the retry calls', () => {
    const view = [
      { type: 'node_start', node: 'split', ms: 1, detail: 'Splitting' } as Frame,
      end({ node: 'split' }),
      { type: 'node_start', node: 'extract', ms: 2, detail: 'chunk 1 of 1', chunk: 1 } as Frame,
      end({ node: 'extract', chunk: 1 }),
      end({ node: 'reduce' }),
      { type: 'node_start', node: 'synthesize', ms: 3, detail: 'Writing' } as Frame,
      end({ node: 'synthesize' }),
      { type: 'node_start', node: 'check', ms: 4, detail: 'Checking' } as Frame,
      end({ node: 'check' }),
      { type: 'edge', from: 'check', to: 'extract', label: 'retry 1 missing chunk' } as Frame,
    ].reduce(applyFrame, running())

    expect(runningStep(view)).toBe('')
    expect(statusLine(view, 0, true)).toBe('Analyzing. Checking coverage.')
  })

  it('keeps the last step between extract and reduce, and between reduce and synthesis', () => {
    const extracting = [
      { type: 'node_start', node: 'split', ms: 1, detail: 'Splitting' } as Frame,
      end({ node: 'split' }),
      { type: 'edge', from: 'split', to: 'extract', label: 'fan out: 2 chunks', count: 2 } as Frame,
      { type: 'node_start', node: 'extract', ms: 2, detail: 'chunk 1 of 2', chunk: 1 } as Frame,
      { type: 'node_start', node: 'extract', ms: 2, detail: 'chunk 2 of 2', chunk: 2 } as Frame,
    ].reduce(applyFrame, running())
    const gap = [end({ node: 'extract', chunk: 1 }), end({ node: 'extract', chunk: 2 })].reduce(applyFrame, extracting)

    expect(statusLine(extracting, 0, true)).toBe('Analyzing. 0 of 2 chunks extracted.')
    expect(runningStep(gap)).toBe('')
    expect(statusLine(gap, 0, true)).toBe('Analyzing. 1 of 2 chunks extracted.')
  })

  it('still names the step that is running', () => {
    const view = applyFrame(running(), { type: 'node_start', node: 'synthesize', ms: 1, detail: 'Writing' })

    expect(statusLine(view, 0, true)).toBe('Analyzing. Writing the cited summary.')
  })
})

describe('chunk counts that follow the number', () => {
  it('says 1 chunk, not 1 chunks, while extracting and when finished', () => {
    const extracting = [
      { type: 'node_start', node: 'split', ms: 1, detail: 'Splitting' } as Frame,
      end({ node: 'split' }),
      { type: 'edge', from: 'split', to: 'extract', label: 'fan out: 1 chunk', count: 1 } as Frame,
      { type: 'node_start', node: 'extract', ms: 2, detail: 'chunk 1 of 1', chunk: 1 } as Frame,
    ].reduce(applyFrame, running())
    expect(statusLine(extracting, 0, true)).toBe('Analyzing. 0 of 1 chunk extracted.')

    const finished: RunView = {
      ...initialView(),
      phase: 'done',
      result: { coverage: { covered: [1], missing: [], noPoints: [] } } as unknown as RunView['result'],
    }
    expect(statusLine(finished, 0, true)).toBe('Finished. 1 of 1 chunk covered.')
    expect(statusLine({ ...finished, result: { coverage: { covered: [1], missing: [2], noPoints: [] } } as unknown as RunView['result'] }, 0, true)).toBe(
      'Finished. 1 of 2 chunks covered.',
    )
  })
})

describe('a step that never started', () => {
  it('reads Waiting during the run and Not run once the run is over', () => {
    expect(stageWord('idle', false)).toBe('Waiting')
    expect(stageWord('idle', true)).toBe('Not run')
  })

  it('keeps the word of a step that did start', () => {
    expect(stageWord('ok', true)).toBe('Done')
    expect(stageWord('failed', true)).toBe('Failed')
    expect(stageWord('stopped', true)).toBe('Stopped')
  })
})
