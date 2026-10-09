import type { Coverage } from '../types/frames'

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
