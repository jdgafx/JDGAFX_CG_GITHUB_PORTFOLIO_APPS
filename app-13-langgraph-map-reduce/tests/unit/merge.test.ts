import { describe, expect, it } from 'vitest'
import { mergeFindings, uniqueStrings } from '../../netlify/shared/merge'
import type { Finding } from '../../src/types/frames'

function finding(chunkId: number, points: string[], entities: string[]): Finding {
  return { chunkId, points, entities, model: 'meta-llama/llama-3.1-8b-instruct', usage: null }
}

describe('uniqueStrings', () => {
  it('drops case and spacing repeats, keeps the first spelling and the order', () => {
    expect(uniqueStrings(['The Lessor', 'the  lessor ', 'Tenant', '', '   ', 'TENANT'])).toEqual(['The Lessor', 'Tenant'])
  })
})

describe('mergeFindings (reduce)', () => {
  it('deduplicates entities across chunks and orders chunks by id', () => {
    const merged = mergeFindings([
      finding(3, ['Rule three.'], ['Lessor', 'Lot 4']),
      finding(1, ['Rule one.'], ['lessor', 'Tenant']),
      finding(2, ['Rule two.'], ['TENANT', 'Lot 4']),
    ])

    expect(merged.byChunk.map((c) => c.chunkId)).toEqual([1, 2, 3])
    // Chunks are read in id order, so the first spelling seen is the one from chunk 1.
    expect(merged.entities).toEqual(['lessor', 'Tenant', 'Lot 4'])
    expect(merged.findingCount).toBe(3)
  })

  it('merges a retry finding into the chunk it repeats, without repeating its points', () => {
    const merged = mergeFindings([
      finding(2, ['Deadline is 30 days.'], ['Lessor']),
      finding(2, ['deadline is 30 days.', 'Notice must be written.'], ['lessor']),
    ])

    expect(merged.byChunk).toEqual([
      { chunkId: 2, points: ['Deadline is 30 days.', 'Notice must be written.'], entities: ['Lessor'] },
    ])
    expect(merged.findingCount).toBe(2)
  })

  it('returns an empty merge when there are no findings', () => {
    expect(mergeFindings([])).toEqual({ byChunk: [], entities: [], findingCount: 0 })
  })
})
