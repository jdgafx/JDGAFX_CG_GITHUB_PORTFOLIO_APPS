import type { CDPSession, Page } from 'playwright-core'
import type { StepFrame } from '../../src/types'
import { withTimeout } from './browser'

/** Width of a stored frame. A page wider than this is scaled down, a narrower one is kept as it is. */
export const FRAME_WIDTH = 640
/** One frame never exceeds this many JPEG bytes. */
export const FRAME_MAX_BYTES = 70_000
/** All frames of one run together stay under this many JPEG bytes (about 600 KB of base64 in the stream). */
export const RUN_FRAME_MAX_BYTES = 450_000
/** JPEG quality tried in turn until a frame fits. */
export const QUALITIES = [60, 42, 28, 18]
const CAPTURE_MS = 4_000

/** Why a step has no frame. Shown to the visitor, so it is plain copy. */
export const NO_FRAME = {
  budget: 'No picture: the run reached its picture size limit.',
  tooBig: 'No picture: this page did not fit the picture size limit.',
  failed: 'No picture: the browser could not capture this page in time.',
} as const

/** A picture, the reason there is none, or the index of an earlier step whose picture is byte for byte the same. */
export type FrameOutcome = { frame: StepFrame } | { note: string } | { sameAs: number }

/**
 * Picks the best quality whose JPEG fits `limit` bytes. `shoot` returns the JPEG at a quality, or
 * null when capturing fails. Quality only goes down, so the first fit is the sharpest one.
 */
export async function fitFrame(
  shoot: (quality: number) => Promise<{ jpeg: Buffer; width: number; height: number } | null>,
  limit: number,
): Promise<FrameOutcome> {
  if (limit <= 0) return { note: NO_FRAME.budget }
  for (const quality of QUALITIES) {
    const shot = await shoot(quality)
    if (!shot) return { note: NO_FRAME.failed }
    if (shot.jpeg.length <= limit) {
      return { frame: { data: shot.jpeg.toString('base64'), width: shot.width, height: shot.height, bytes: shot.jpeg.length } }
    }
  }
  return { note: NO_FRAME.tooBig }
}

/** Captures one small JPEG per step from the live page over the Chrome DevTools protocol, under a per-run byte budget. */
export class FrameRecorder {
  private session: CDPSession | undefined
  private spent = 0
  private last: { data: string; index: number } | undefined

  constructor(private readonly page: Page) {}

  get bytesSpent(): number {
    return this.spent
  }

  private async cdp(): Promise<CDPSession> {
    this.session ??= await this.page.context().newCDPSession(this.page)
    return this.session
  }

  private async shoot(quality: number): Promise<{ jpeg: Buffer; width: number; height: number } | null> {
    try {
      const session = await this.cdp()
      const metrics = await session.send('Page.getLayoutMetrics')
      const view = metrics.cssVisualViewport
      const scale = Math.min(1, FRAME_WIDTH / view.clientWidth)
      const result = await session.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality,
        clip: { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale },
      })
      return {
        jpeg: Buffer.from(result.data, 'base64'),
        width: Math.round(view.clientWidth * scale),
        height: Math.round(view.clientHeight * scale),
      }
    } catch {
      return null
    }
  }

  /**
   * The page as it is now. Never throws: a page that cannot be captured gives a note instead. A picture identical to the
   * last one sent is not sent again: the outcome names the step it repeats, and it uses none of the run's byte budget.
   */
  async capture(index: number): Promise<FrameOutcome> {
    const limit = Math.min(FRAME_MAX_BYTES, RUN_FRAME_MAX_BYTES - this.spent)
    try {
      const outcome = await withTimeout(fitFrame((quality) => this.shoot(quality), limit), CAPTURE_MS, 'The picture took too long.')
      if (!('frame' in outcome)) return outcome
      if (this.last?.data === outcome.frame.data) return { sameAs: this.last.index }
      this.spent += outcome.frame.bytes
      this.last = { data: outcome.frame.data, index }
      return outcome
    } catch {
      return { note: NO_FRAME.failed }
    }
  }

  async close(): Promise<void> {
    await this.session?.detach().catch(() => undefined)
  }
}
