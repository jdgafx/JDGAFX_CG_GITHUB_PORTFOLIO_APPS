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
  /** Chunks the review model says the summary leaves out. */
  flagged: Set<number>
}

/**
 * A chunk is covered when extraction produced a key point for it, the summary cites it, and the
 * review model did not flag it. Every other chunk is missing. covered and missing partition the ids.
 */
export function computeCoverage(input: CoverageInput): Coverage {
  const covered: number[] = []
  const missing: number[] = []
  for (const id of [...input.chunkIds].sort((a, b) => a - b)) {
    const ok = input.withPoints.has(id) && input.cited.has(id) && !input.flagged.has(id)
    if (ok) covered.push(id)
    else missing.push(id)
  }
  return { covered, missing }
}
