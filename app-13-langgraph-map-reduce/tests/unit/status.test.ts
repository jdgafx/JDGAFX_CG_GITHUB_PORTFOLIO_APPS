import { describe, expect, it } from 'vitest'
import { stageWord, statusLine } from '../../src/lib/status'
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

  it('does not fall back to the start wording between the check and the retry calls', () => {
    const view = [
      { type: 'node_start', node: 'split', ms: 1, detail: 'Splitting' } as Frame,
      end({ node: 'split' }),
      { type: 'node_start', node: 'extract', ms: 2, detail: 'chunk 1 of 1', chunk: 1 } as Frame,
      end({ node: 'extract', chunk: 1 }),
      end({ node: 'reduce' }),
      end({ node: 'synthesize' }),
      end({ node: 'check' }),
      { type: 'edge', from: 'check', to: 'extract', label: 'retry 1 missing chunk' } as Frame,
    ].reduce(applyFrame, running())

    expect(statusLine(view, 0, true)).toBe('Analyzing.')
  })

  it('still names the step that is running', () => {
    const view = applyFrame(running(), { type: 'node_start', node: 'synthesize', ms: 1, detail: 'Writing' })

    expect(statusLine(view, 0, true)).toBe('Analyzing. Writing the cited summary.')
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
