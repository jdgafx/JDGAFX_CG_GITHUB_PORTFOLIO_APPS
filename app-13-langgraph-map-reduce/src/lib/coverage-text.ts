import type { Coverage, RunResult } from '../types/frames'

/** "2", "2 and 6", "2, 6 and 9". */
function joinNumbers(ids: number[]): string {
  if (ids.length <= 1) return ids.join('')
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
}

/** Each missing chunk with its real reason: it gave no key points, or the summary does not cite it. */
export function missingItems(coverage: Coverage): string[] {
  const noPoints = new Set(coverage.noPoints)
  return coverage.missing.map((id) => `chunk ${id} (${noPoints.has(id) ? 'no key points found' : 'not cited in the summary'})`)
}

/** The muted note under the coverage line, or null when the review flagged nothing. It never changes the count. */
export function reviewNote(flags: number[]): string | null {
  if (flags.length === 0) return null
  return `The review model thinks ${flags.length === 1 ? 'chunk' : 'chunks'} ${joinNumbers(flags)} may be thin in the summary.`
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
    case 'none':
      return { tone: 'ds-badge--success', text: 'No retry needed' }
  }
}

/** "Still missing after the retry" once a retry ran to the end, otherwise "Still missing". */
export function missingLead(result: Pick<RunResult, 'retryOutcome'>): string {
  return result.retryOutcome === 'used' || result.retryOutcome === 'kept-first' ? 'Still missing after the retry' : 'Still missing'
}
