/** Finish reasons that mean a reply stopped before it was complete. */
const CUT_OFF = new Set(['length', 'timeout', 'error', 'interrupted'])

/**
 * True when a reply was cut off rather than finished. The server uses it to decide on a retry,
 * and the page uses it to label the stage, so both sides agree.
 */
export function isCutOff(finish: string | null): boolean {
  return finish !== null && CUT_OFF.has(finish)
}
