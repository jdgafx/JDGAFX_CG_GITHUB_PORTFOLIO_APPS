import type { Finding, Merged } from '../../src/types/frames'

/** Trims, collapses spaces and drops case and repeats. The first spelling and order are kept. */
export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const cleaned = value.replace(/\s+/g, ' ').trim()
    const key = cleaned.toLowerCase()
    if (!cleaned || seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
  }
  return out
}

/**
 * The reduce step. Findings for one chunk are merged, which covers the retry pass re-running a
 * chunk, and entities are deduplicated across the whole document. Chunks are ordered by id.
 */
export function mergeFindings(findings: Finding[]): Merged {
  const ids = [...new Set(findings.map((f) => f.chunkId))].sort((a, b) => a - b)
  const byChunk = ids.map((chunkId) => {
    const mine = findings.filter((f) => f.chunkId === chunkId)
    return {
      chunkId,
      points: uniqueStrings(mine.flatMap((f) => f.points)),
      entities: uniqueStrings(mine.flatMap((f) => f.entities)),
    }
  })
  return {
    byChunk,
    entities: uniqueStrings(byChunk.flatMap((c) => c.entities)),
    findingCount: findings.length,
  }
}
