/** The page screens narrower than this put the result below the controls. */
export const NARROW_BELOW_PX = 1000
/** More than this much scrolling by the visitor during a run means they are reading something else. */
export const SCROLL_TOLERANCE_PX = 40

/**
 * Whether to bring a finished, failed or stopped run's result into view: only on a narrow screen, only once the
 * run has ended, and never when the visitor moved the page themselves during the run.
 */
export function shouldScrollToResult(input: { width: number; ended: boolean; scrolledBy: number }): boolean {
  return input.width < NARROW_BELOW_PX && input.ended && Math.abs(input.scrolledBy) <= SCROLL_TOLERANCE_PX
}
