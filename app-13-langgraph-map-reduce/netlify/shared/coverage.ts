import type { Coverage, Summary } from '../../src/types/frames'

/** Chunk ids that the summary cites in at least one point. Ids outside the known set are ignored. */
export function citedChunks(summary: Summary, chunkIds: number[]): Set<number> {
  const known = new Set(chunkIds)
  const cited = new Set<number>()
  for (const section of summary.sections) {
    for (const point of section.points) {
      for (const id of point.chunks) if (known.has(id)) cited.add(id)
    }
  }
  return cited
}

export interface CoverageInput {
  chunkIds: number[]
  /** Chunks whose extraction produced at least one key point. */
  withPoints: Set<number>
  /** Chunks the summary cites. */
  cited: Set<number>
}

/**
 * A chunk is covered when extraction produced a key point for it and the summary cites it. That test is
 * deterministic: the review model's opinion is advisory and never counts here. Every other chunk is
 * missing, and noPoints says which of those gave no key points. covered and missing partition the ids.
 */
export function computeCoverage(input: CoverageInput): Coverage {
  const covered: number[] = []
  const missing: number[] = []
  const noPoints: number[] = []
  for (const id of [...input.chunkIds].sort((a, b) => a - b)) {
    if (!input.withPoints.has(id)) {
      missing.push(id)
      noPoints.push(id)
    } else if (input.cited.has(id)) covered.push(id)
    else missing.push(id)
  }
  return { covered, missing, noPoints }
}
