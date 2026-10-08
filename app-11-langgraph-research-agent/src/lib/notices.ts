import type { ResultFrame } from '../../netlify/shared/events'

export const TRUNCATED_NOTICE = 'The answer was cut short at its length limit.'

/** The notice shown above a cited answer, or null when the answer is complete. */
export function answerNotice(result: Pick<ResultFrame, 'truncated'>): string | null {
  return result.truncated ? TRUNCATED_NOTICE : null
}
