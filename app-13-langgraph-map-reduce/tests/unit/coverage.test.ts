import { describe, expect, it } from 'vitest'
import { citedChunks, citedPointIds, computeCoverage } from '../../netlify/shared/coverage'
import type { Summary } from '../../src/types/frames'

const summary: Summary = {
  overview: 'Overview.',
  sections: [
    {
      heading: 'Rules',
      points: [
        { text: 'First rule.', points: ['1.1'], chunks: [1] },
        { text: 'Second rule.', points: ['2.1', '9.1'], chunks: [2, 9] },
      ],
    },
  ],
}

describe('citedChunks', () => {
  it('collects every cited chunk id and ignores ids that are not chunks', () => {
    expect([...citedChunks(summary, [1, 2, 3])].sort((a, b) => a - b)).toEqual([1, 2])
  })
})

describe('citedPointIds', () => {
  it('collects every cited point id and ignores ids that were not extracted', () => {
    expect([...citedPointIds(summary, ['1.1', '2.1', '2.2'])]).toEqual(['1.1', '2.1'])
  })
})

describe('computeCoverage', () => {
  const points = { pointIds: [] as string[], citedPoints: new Set<string>(), unchecked: [] as number[] }

  it('covers a chunk when it has points and the summary cites it, and says why the others are missing', () => {
    const coverage = computeCoverage({
      chunkIds: [1, 2, 3, 4],
      withPoints: new Set([1, 2, 3]),
      cited: new Set([1, 2, 4]),
      ...points,
    })

    expect(coverage).toEqual({ covered: [1, 2], missing: [3, 4], noPoints: [4], citedPoints: [], uncitedPoints: [], unchecked: [] })
  })

  it('partitions the chunk ids and sorts both lists', () => {
    const coverage = computeCoverage({ chunkIds: [3, 1, 2], withPoints: new Set([1, 2, 3]), cited: new Set([3, 1, 2]), ...points })

    expect(coverage).toEqual({ covered: [1, 2, 3], missing: [], noPoints: [], citedPoints: [], uncitedPoints: [], unchecked: [] })
  })

  it('reports every chunk as missing, with no key points, when nothing was extracted', () => {
    const coverage = computeCoverage({ chunkIds: [1, 2], withPoints: new Set(), cited: new Set([1, 2]), ...points })

    expect(coverage).toEqual({ covered: [], missing: [1, 2], noPoints: [1, 2], citedPoints: [], uncitedPoints: [], unchecked: [] })
  })

  it('splits the point ids into cited and uncited in document order, whatever the chunks say', () => {
    const coverage = computeCoverage({
      chunkIds: [1, 2],
      withPoints: new Set([1, 2]),
      cited: new Set([1, 2]),
      pointIds: ['1.1', '1.2', '2.1'],
      citedPoints: new Set(['2.1', '1.1']),
      unchecked: [2],
    })

    // Both chunks are cited, yet point 1.2 is not used.
    expect(coverage).toEqual({ covered: [1, 2], missing: [], noPoints: [], citedPoints: ['1.1', '2.1'], uncitedPoints: ['1.2'], unchecked: [2] })
  })
})
