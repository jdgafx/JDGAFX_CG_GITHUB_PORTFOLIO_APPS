import { describe, expect, it } from 'vitest'
import { missingItems, reviewNote } from '../../src/lib/coverage-text'

describe('missingItems', () => {
  it('gives each missing chunk its own reason', () => {
    expect(missingItems({ covered: [1], missing: [2, 6], noPoints: [2] })).toEqual([
      'chunk 2 (no key points found)',
      'chunk 6 (not cited in the summary)',
    ])
  })
})

describe('reviewNote', () => {
  it('is empty when the review flagged nothing', () => {
    expect(reviewNote([])).toBeNull()
  })

  it('names one, two or three chunks in plain words', () => {
    expect(reviewNote([2])).toBe('The review model thinks chunk 2 may be thin in the summary.')
    expect(reviewNote([2, 6])).toBe('The review model thinks chunks 2 and 6 may be thin in the summary.')
    expect(reviewNote([2, 6, 9])).toBe('The review model thinks chunks 2, 6 and 9 may be thin in the summary.')
  })
})
