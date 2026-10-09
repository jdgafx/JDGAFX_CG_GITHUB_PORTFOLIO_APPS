import { describe, expect, it } from 'vitest'
import { citedChunks, computeCoverage } from '../../netlify/shared/coverage'
import type { Summary } from '../../src/types/frames'

const summary: Summary = {
  overview: 'Overview.',
  sections: [
    {
      heading: 'Rules',
      points: [
        { text: 'First rule.', chunks: [1] },
        { text: 'Second rule.', chunks: [2, 9] },
      ],
    },
  ],
}

describe('citedChunks', () => {
  it('collects every cited chunk id and ignores ids that are not chunks', () => {
    expect([...citedChunks(summary, [1, 2, 3])].sort((a, b) => a - b)).toEqual([1, 2])
  })
})

describe('computeCoverage', () => {
  it('covers a chunk when it has points and the summary cites it, and says why the others are missing', () => {
    const coverage = computeCoverage({
      chunkIds: [1, 2, 3, 4],
      withPoints: new Set([1, 2, 3]),
      cited: new Set([1, 2, 4]),
    })

    expect(coverage).toEqual({ covered: [1, 2], missing: [3, 4], noPoints: [4] })
  })

  it('partitions the chunk ids and sorts both lists', () => {
    const coverage = computeCoverage({ chunkIds: [3, 1, 2], withPoints: new Set([1, 2, 3]), cited: new Set([3, 1, 2]) })

    expect(coverage).toEqual({ covered: [1, 2, 3], missing: [], noPoints: [] })
  })

  it('reports every chunk as missing, with no key points, when nothing was extracted', () => {
    const coverage = computeCoverage({ chunkIds: [1, 2], withPoints: new Set(), cited: new Set([1, 2]) })

    expect(coverage).toEqual({ covered: [], missing: [1, 2], noPoints: [1, 2] })
  })
})
