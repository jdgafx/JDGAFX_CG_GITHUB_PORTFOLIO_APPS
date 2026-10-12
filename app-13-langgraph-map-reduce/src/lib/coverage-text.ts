import type { Coverage, RunResult } from '../types/frames'

function joinNumbers(ids: number[]): string {
  return joinIds(ids.map(String))
}

/** "2", "2 and 6", "2, 6 and 9". */
function joinIds(ids: string[]): string {
  if (ids.length <= 1) return ids.join('')
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
}

/** Each missing chunk with its real reason: it gave no key points, or the summary does not cite it. */
export function missingItems(coverage: Coverage): string[] {
  const noPoints = new Set(coverage.noPoints)
  return coverage.missing.map((id) => `chunk ${id} (${noPoints.has(id) ? 'no key points found' : 'not cited in the summary'})`)
}

/** The headline claim, per key point: "22 of 37 key points used". allUsed is true only when every extracted point is cited. */
export function pointsHeadline(coverage: Pick<Coverage, 'citedPoints' | 'uncitedPoints'>): { text: string; allUsed: boolean } {
  const total = coverage.citedPoints.length + coverage.uncitedPoints.length
  return { text: `${coverage.citedPoints.length} of ${total} key points used`, allUsed: total > 0 && coverage.uncitedPoints.length === 0 }
}

/** The key points the summary does not use, in document order, each with its text. */
export function unusedPoints(result: Pick<RunResult, 'coverage' | 'keyPoints'>): Array<{ id: string; text: string }> {
  const texts = new Map(result.keyPoints.flatMap((chunk) => chunk.points.map((point) => [point.id, point.text] as const)))
  return result.coverage.uncitedPoints.map((id) => ({ id, text: texts.get(id) ?? '' }))
}

/** The sentence that says some chunks' key points could not be checked against the summary, or null when all were. */
export function uncheckedNote(coverage: Pick<Coverage, 'unchecked'>): string | null {
  const ids = coverage.unchecked
  if (ids.length === 0) return null
  return `The key points of ${ids.length === 1 ? 'chunk' : 'chunks'} ${joinNumbers(ids)} could not be checked against the summary, so they are listed as not used.`
}

/** What the review made of the unused points, in words. Null when there is nothing to review. It never changes the count. */
export function reviewLine(result: Pick<RunResult, 'review' | 'reviewFlags'>): string | null {
  switch (result.review) {
    case 'not-needed':
      return null
    case 'skipped':
      return 'The review did not run, because too little of the time limit was left. None of these were checked.'
    case 'unavailable':
      return 'The review could not be completed. None of these were checked.'
    case 'done':
      return result.reviewFlags.length === 0
        ? 'The review model found none of these central to the document\'s main subject.'
        : `The review model found ${result.reviewFlags.length === 1 ? 'point' : 'points'} ${joinIds(result.reviewFlags)} central to the document's main subject, so ${result.reviewFlags.length === 1 ? 'its text is' : 'their texts are'} added to the summary under "Also central in the text".`
  }
}

/** The badge beside the coverage count: what happened to the retry, in words and tone. */
export function coverageBadge(result: Pick<RunResult, 'retryOutcome'>): { tone: string; text: string } {
  switch (result.retryOutcome) {
    case 'skipped':
      return { tone: 'ds-badge--warning', text: 'Retry not completed' }
    case 'kept-first':
      return { tone: 'ds-badge--warning', text: '1 retry used, first pass kept' }
    case 'used':
      return { tone: 'ds-badge--success', text: '1 retry used' }
    case 'used-nothing-new':
      return { tone: 'ds-badge--warning', text: '1 retry used, nothing new' }
    case 'none':
      return { tone: 'ds-badge--success', text: 'No chunk retry needed' }
  }
}

/** "Still missing after the retry" once a retry ran to the end, otherwise "Still missing". */
export function missingLead(result: Pick<RunResult, 'retryOutcome'>): string {
  return result.retryOutcome === 'used' || result.retryOutcome === 'used-nothing-new' || result.retryOutcome === 'kept-first' ? 'Still missing after the retry' : 'Still missing'
}
