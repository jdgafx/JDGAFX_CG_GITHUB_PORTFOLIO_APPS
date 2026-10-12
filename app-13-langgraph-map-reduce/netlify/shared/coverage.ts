import type { Coverage, Merged, Summary, SummaryPoint } from '../../src/types/frames'

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

/** Every extracted key point id, in chunk then point order. */
export function pointIdsOf(merged: Merged): string[] {
  return merged.byChunk.flatMap((chunk) => chunk.points.map((point) => point.id))
}

/** Key point ids that the summary cites in at least one sentence. Ids that are not extracted points are ignored, whatever the summary says. */
export function citedPointIds(summary: Summary, pointIds: string[]): Set<string> {
  const known = new Set(pointIds)
  const cited = new Set<string>()
  for (const section of summary.sections) {
    for (const point of section.points) {
      for (const id of point.points) if (known.has(id)) cited.add(id)
    }
  }
  return cited
}

/** The heading of the section that carries the central key points the writer left out. */
export const CENTRAL_HEADING = 'Also central in the text'

/**
 * The summary with each key point the review found central, and no sentence states, added as a sentence of its own: the
 * point's extracted text, which states only what its chunk states, cited to its own id and chunk. No model call.
 */
export function addCentralPoints(summary: Summary, merged: Merged, flagged: string[]): Summary {
  const wanted = new Set(flagged)
  const points: SummaryPoint[] = merged.byChunk.flatMap((chunk) =>
    chunk.points.filter((p) => wanted.has(p.id)).map((p) => ({ text: p.text, points: [p.id], chunks: [chunk.chunkId] })),
  )
  return points.length === 0 ? summary : { ...summary, sections: [...summary.sections, { heading: CENTRAL_HEADING, points }] }
}

export interface CoverageInput {
  chunkIds: number[]
  /** Chunks whose extraction produced at least one key point. */
  withPoints: Set<number>
  /** Chunks the summary cites. */
  cited: Set<number>
  /** Every extracted key point id, in order. */
  pointIds: string[]
  /** The key point ids a summary sentence states, as the check found. */
  citedPoints: Set<string>
  /** Chunks whose key points the check could not judge. */
  unchecked: number[]
}

/**
 * A key point is used when the summary cites its id, and nothing else counts: that is the headline. The chunk view is
 * secondary: a chunk is covered when extraction produced a key point for it and the summary cites one of its points.
 * Both tests are deterministic: the review model's opinion never counts here, only the sentences it caused to be added. Every other chunk is missing, and noPoints
 * says which of those gave no key points. covered and missing partition the chunk ids; citedPoints and uncitedPoints
 * partition the point ids.
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
  return {
    covered,
    missing,
    noPoints,
    citedPoints: input.pointIds.filter((id) => input.citedPoints.has(id)),
    uncitedPoints: input.pointIds.filter((id) => !input.citedPoints.has(id)),
    unchecked: [...input.unchecked].sort((a, b) => a - b),
  }
}
