import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { FRAME_MAX_BYTES, FrameRecorder, NO_FRAME, QUALITIES, RUN_FRAME_MAX_BYTES, fitFrame } from '../../netlify/shared/frames'

const shot = (bytes: number) => ({ jpeg: Buffer.alloc(bytes, 1), width: 640, height: 366 })

describe('fitFrame', () => {
  it('keeps the first quality when the picture already fits (live sizes: Hacker News 28,042 bytes, Hubble 32,766)', async () => {
    const tried: number[] = []
    const outcome = await fitFrame(async (q) => (tried.push(q), shot(32_766)), FRAME_MAX_BYTES)
    expect(tried).toEqual([QUALITIES[0]])
    expect(outcome).toEqual({ frame: { data: Buffer.alloc(32_766, 1).toString('base64'), width: 640, height: 366, bytes: 32_766 } })
  })

  it('lowers the quality step by step until the picture fits, and stops at the first fit', async () => {
    const sizes: Record<number, number> = { 60: 90_000, 42: 71_000, 28: 55_000, 18: 30_000 }
    const tried: number[] = []
    const outcome = await fitFrame(async (q) => (tried.push(q), shot(sizes[q])), FRAME_MAX_BYTES)
    expect(tried).toEqual([60, 42, 28])
    expect('frame' in outcome && outcome.frame.bytes).toBe(55_000)
  })

  it('gives a note, not a frame, when even the lowest quality is too big', async () => {
    expect(await fitFrame(async () => shot(200_000), FRAME_MAX_BYTES)).toEqual({ note: NO_FRAME.tooBig })
  })

  it('gives a note when the capture fails, and stops trying', async () => {
    let calls = 0
    expect(await fitFrame(async () => (calls++, null), FRAME_MAX_BYTES)).toEqual({ note: NO_FRAME.failed })
    expect(calls).toBe(1)
  })

  it('gives the run-budget note without capturing when no bytes are left', async () => {
    let calls = 0
    expect(await fitFrame(async () => (calls++, shot(1)), 0)).toEqual({ note: NO_FRAME.budget })
    expect(calls).toBe(0)
  })

  it('keeps ten frames at the per-frame cap inside the run cap only when the run cap is reached first', () => {
    expect(FRAME_MAX_BYTES * 10).toBeGreaterThan(RUN_FRAME_MAX_BYTES)
    // 450,000 JPEG bytes become about 600,000 base64 characters, far below the 20 MB streamed limit.
    expect(Math.ceil(RUN_FRAME_MAX_BYTES / 3) * 4).toBe(600_000)
  })
})

describe('FrameRecorder repeats', () => {
  /** A page whose pictures come from the queue, one per capture. */
  function pageShowing(...jpegs: Buffer[]): Page {
    const queue = [...jpegs]
    const send = async (method: string) => (method === 'Page.getLayoutMetrics'
      ? { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 960, clientHeight: 549 } }
      : { data: (queue.shift() ?? jpegs[jpegs.length - 1]).toString('base64') })
    return { context: () => ({ newCDPSession: async () => ({ send, detach: async () => undefined }) }) } as unknown as Page
  }

  it('sends the first picture, then names the earlier step for an identical one and spends no bytes on it', async () => {
    const same = Buffer.alloc(28_042, 3)
    const recorder = new FrameRecorder(pageShowing(same, same, Buffer.alloc(31_000, 4)))
    const first = await recorder.capture(0)
    expect('frame' in first && first.frame.bytes).toBe(28_042)
    expect(await recorder.capture(1)).toEqual({ sameAs: 0 })
    expect(recorder.bytesSpent).toBe(28_042)
    const third = await recorder.capture(2)
    expect('frame' in third && third.frame.bytes).toBe(31_000)
    expect(recorder.bytesSpent).toBe(59_042)
  })

  it('compares with the last picture sent, so a page that changes and returns is sent again', async () => {
    const a = Buffer.alloc(10_000, 1)
    const b = Buffer.alloc(10_000, 2)
    const recorder = new FrameRecorder(pageShowing(a, b, a))
    await recorder.capture(0)
    await recorder.capture(1)
    expect('frame' in (await recorder.capture(2))).toBe(true)
  })
})
