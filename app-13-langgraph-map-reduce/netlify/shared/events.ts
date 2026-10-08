import type { Frame } from '../../src/types/frames'

/** The stream always ends with this line, also after a failure. */
export const DONE_FRAME = 'data: [DONE]\n\n'

/** One server-sent event: a JSON payload on a single data line. */
export function encodeFrame(frame: Frame): string {
  return `data: ${JSON.stringify(frame)}\n\n`
}
