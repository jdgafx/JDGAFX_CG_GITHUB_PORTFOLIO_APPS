import { describe, expect, it } from 'vitest'
import { READ_BATCH_SIZE, batchesOf } from '../../netlify/shared/batches'

describe('batchesOf', () => {
  it('takes at most four comments per read request', () => {
    expect(READ_BATCH_SIZE).toBe(4)
  })

  it.each([
    [[], []],
    [[7], [[7]]],
    [[1, 2, 3, 4], [[1, 2, 3, 4]]],
    [[1, 2, 3, 4, 5], [[1, 2, 3, 4], [5]]],
    [[1, 2, 4, 8, 9, 10, 12, 13, 14], [[1, 2, 4, 8], [9, 10, 12, 13], [14]]],
  ])('splits %j into %j, in order, none lost or repeated', (ids, expected) => {
    expect(batchesOf(ids)).toEqual(expected)
  })

  it('makes ceil(n / 4) batches up to the most comments a review can pass on (15 asked for, 5 more checked)', () => {
    for (let n = 0; n <= 20; n += 1) expect(batchesOf(Array.from({ length: n }, (_, i) => i + 1)).length).toBe(Math.ceil(n / 4))
  })
})
