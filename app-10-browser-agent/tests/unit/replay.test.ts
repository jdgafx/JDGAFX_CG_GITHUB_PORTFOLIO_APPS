import { describe, expect, it } from 'vitest'
import { CLIENT_FRAME_MAX_BYTES, cleanFrame, followIndex, frameTotals, moveIndex, nextPlayable, playableCount, replayItems } from '../../src/lib/replay'
import { initialRunState, runReducer, type RunState } from '../../src/lib/runState'
import { lanesFor, type TraceRow } from '../../src/lib/trace'
import type { BotStep, RunEvent } from '../../src/types'

const STEPS: BotStep[] = [
  { action: 'navigate', target: 'Hubble Space Telescope article', thought: 'Open the article.', url: 'https://en.wikipedia.org/wiki/Hubble_Space_Telescope' },
  { action: 'click', target: 'Buy tickets button', thought: 'Click the button.' },
  { action: 'extract', target: 'page title', thought: 'Read the title.' },
]
const OBSERVED = { url: 'https://en.wikipedia.org/wiki/Hubble_Space_Telescope', title: 'Hubble Space Telescope - Wikipedia', excerpt: 'Jump to content' }
// Recorded from a live run: 640 x 366 JPEG, 32,766 bytes. The data is shortened here, the shape is real.
const FRAME = { data: 'QUJD', width: 640, height: 366, bytes: 32_766 }

function replayState(events: RunEvent[], phase: RunState['phase'] = 'failed'): RunState {
  let state: RunState = { ...initialRunState, steps: STEPS, phase: 'running' }
  for (const event of events) state = runReducer(state, { type: 'event', event })
  return { ...state, phase }
}

const FAILED_RUN: RunEvent[] = [
  { type: 'step_start', index: 0, name: 'Navigate: Hubble Space Telescope article' },
  { type: 'step_complete', index: 0, name: 'Navigate: Hubble Space Telescope article', status: 'ok', ms: 1971, detail: 'Opened en.wikipedia.org.', observed: OBSERVED, frame: FRAME },
  { type: 'step_start', index: 1, name: 'Click: Buy tickets button' },
  { type: 'step_complete', index: 1, name: 'Click: Buy tickets button', status: 'failed', ms: 734, detail: 'The target was not found: Buy tickets button.', observed: OBSERVED, frame: FRAME },
  { type: 'step_complete', index: 2, name: 'Extract: page title', status: 'skipped', ms: 0, detail: 'Not run: an earlier stage failed.' },
]

describe('cleanFrame', () => {
  it('accepts a small base64 JPEG with sane dimensions', () => {
    expect(cleanFrame(FRAME)).toEqual({ frame: FRAME })
  })

  it('says nothing when the step carried no picture', () => {
    expect(cleanFrame(undefined)).toEqual({})
  })

  it.each([
    ['text that is not base64', { ...FRAME, data: '<script>alert(1)</script>' }],
    ['more bytes than the page keeps', { ...FRAME, bytes: CLIENT_FRAME_MAX_BYTES + 1 }],
    ['a base64 string longer than the cap allows', { ...FRAME, data: 'A'.repeat(110_000) }],
    ['a width of zero', { ...FRAME, width: 0 }],
    ['a height that is not a number', { ...FRAME, height: '366' }],
    ['no data', { width: 640, height: 366, bytes: 10 }],
  ])('drops %s and says so', (_name, raw) => {
    const result = cleanFrame(raw)
    expect(result.frame).toBeUndefined()
    expect(result.note).toBe('No picture: the page could not read the picture the server sent.')
  })
})

describe('replayItems', () => {
  it('pairs each planned step with its picture, observed page and status', () => {
    const items = replayItems(replayState(FAILED_RUN))
    expect(items.map((item) => item.status)).toEqual(['ok', 'failed', 'skipped'])
    expect(items[1]).toMatchObject({ label: 'Click: Buy tickets button', detail: 'The target was not found: Buy tickets button.', frame: FRAME, observed: OBSERVED })
    expect(items[2].frame).toBeUndefined()
    expect(items[2].detail).toBe('Not run: an earlier stage failed.')
  })

  it('keeps the reason a step has no picture', () => {
    const state = replayState([
      { type: 'step_complete', index: 0, name: 'x', status: 'ok', ms: 5, detail: 'Opened.', observed: OBSERVED, frameNote: 'No picture: the run reached its picture size limit.' },
    ], 'running')
    expect(replayItems(state)[0].note).toBe('No picture: the run reached its picture size limit.')
  })

  it('totals the pictures and their bytes', () => {
    expect(frameTotals(replayItems(replayState(FAILED_RUN)))).toEqual({ count: 2, bytes: 65_532 })
  })
})

describe('repeated pictures', () => {
  const REPEAT: RunEvent[] = [
    { type: 'step_complete', index: 0, name: 'a', status: 'ok', ms: 5, detail: 'Opened.', observed: OBSERVED, frame: FRAME },
    { type: 'step_complete', index: 1, name: 'b', status: 'ok', ms: 5, detail: 'Observed.', observed: OBSERVED, frameSameAs: 0 },
  ]

  it('shows the earlier picture on the repeating step and says which step it repeats', () => {
    const items = replayItems(replayState(REPEAT, 'complete'))
    expect(items[1].frame).toEqual(FRAME)
    expect(items[1].sameAs).toBe(0)
    expect(items[0].sameAs).toBeUndefined()
  })

  it('counts a repeated picture once in the totals', () => {
    expect(frameTotals(replayItems(replayState(REPEAT, 'complete')))).toEqual({ count: 1, bytes: 32_766 })
  })

  it('shows nothing for a repeat of a step that has no picture', () => {
    const state = replayState([REPEAT[1]], 'complete')
    expect(replayItems(state)[1].frame).toBeUndefined()
  })
})

describe('which step the viewer shows', () => {
  it('follows the running step while the run is live', () => {
    const state = replayState(FAILED_RUN.slice(0, 3), 'running')
    expect(followIndex(replayItems(state), 'running')).toBe(1)
  })

  it('opens a failed run on the step that failed, the most useful view', () => {
    expect(followIndex(replayItems(replayState(FAILED_RUN)), 'failed')).toBe(1)
  })

  it('opens a finished run on its last step that ran, and an empty plan on 0', () => {
    const done = replayState(FAILED_RUN.slice(0, 2), 'complete')
    expect(followIndex(replayItems(done), 'complete')).toBe(0)
    expect(followIndex([], 'idle')).toBe(0)
  })
})

describe('keyboard and play', () => {
  it('moves with the arrow keys and does not wrap at the ends', () => {
    expect(moveIndex(1, 'ArrowRight', 4)).toBe(2)
    expect(moveIndex(3, 'ArrowRight', 4)).toBe(3)
    expect(moveIndex(0, 'ArrowLeft', 4)).toBe(0)
    expect(moveIndex(2, 'ArrowLeft', 4)).toBe(1)
    expect(moveIndex(2, 'Home', 4)).toBe(0)
    expect(moveIndex(1, 'End', 4)).toBe(3)
  })

  it('ignores other keys and an empty strip', () => {
    expect(moveIndex(1, 'a', 4)).toBeNull()
    expect(moveIndex(0, 'ArrowRight', 0)).toBeNull()
  })

  it('plays forward over steps that ran and stops before steps that never did', () => {
    const items = replayItems(replayState(FAILED_RUN))
    expect(nextPlayable(items, 0)).toBe(1)
    expect(nextPlayable(items, 1)).toBeNull()
    expect(playableCount(items)).toBe(2)
  })
})

describe('trace lanes', () => {
  const row = (status: TraceRow['status'], ms: number | null): TraceRow => ({ key: String(Math.random()), name: 'x', status, ms, detail: '' })

  it('lays measured rows end to end and leaves unmeasured rows without a bar', () => {
    const lanes = lanesFor([row('ok', 300), row('running', null), row('failed', 100), row('skipped', 0)])
    expect(lanes[0]).toEqual({ left: 0, width: 75 })
    expect(lanes[1]).toBeNull()
    expect(lanes[2]).toEqual({ left: 75, width: 25 })
    expect(lanes[3]).toBeNull()
  })

  it('draws nothing when no row has a measured time', () => {
    expect(lanesFor([row('waiting', null)])).toEqual([null])
  })
})

describe('strip scrolling and URL truncation', () => {
  it('measures a cell from the scroller, not from the page', async () => {
    const { offsetInScroller } = await import('../../src/lib/useOverflow')
    // The strip starts 392 px from the page edge and is scrolled 300 px. A cell 900 px from the page edge is 808 px into the strip.
    expect(offsetInScroller(900, 392, 300)).toBe(808)
    expect(offsetInScroller(392, 392, 0)).toBe(0)
  })

  it('scrolls the least that brings a cell into view, and not at all when it already is', async () => {
    const { nearestScroll } = await import('../../src/lib/useOverflow')
    expect(nearestScroll(0, 800, 140, 128)).toBeNull()
    expect(nearestScroll(0, 800, 700, 128)).toBe(36)
    expect(nearestScroll(300, 800, 140, 128)).toBe(132)
    expect(nearestScroll(300, 800, 4, 128)).toBe(0)
  })

  it('reports which edges of a scroller hold more', async () => {
    const { edgesOf } = await import('../../src/lib/useOverflow')
    expect(edgesOf(0, 800, 1000)).toEqual({ start: false, end: true })
    expect(edgesOf(200, 800, 1000)).toEqual({ start: true, end: false })
    expect(edgesOf(0, 800, 800)).toEqual({ start: false, end: false })
  })

  it('cuts a long address in the middle and keeps a short one', async () => {
    const { middleTruncate } = await import('../../src/lib/format')
    expect(middleTruncate('https://news.ycombinator.com/')).toBe('https://news.ycombinator.com/')
    const long = 'https://en.wikipedia.org/wiki/Hubble_Space_Telescope_servicing_missions_and_instruments_list'
    const cut = middleTruncate(long, 40)
    expect(cut).toHaveLength(40)
    expect(cut.startsWith('https://en.wikipedia.org')).toBe(true)
    expect(cut.endsWith('ruments_list')).toBe(true)
    expect(cut).toContain('…')
  })
})
