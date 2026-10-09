import { describe, expect, it } from 'vitest'
import { coverageBadge, missingItems, missingLead, reviewNote } from '../../src/lib/coverage-text'

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

describe('the coverage badge and the missing line follow the retry outcome', () => {
  it.each([
    ['none', 'ds-badge--success', 'No retry needed', 'Still missing'],
    ['used', 'ds-badge--success', '1 retry used', 'Still missing after the retry'],
    ['used-nothing-new', 'ds-badge--warning', '1 retry used, nothing new', 'Still missing after the retry'],
    ['kept-first', 'ds-badge--warning', '1 retry used, first pass kept', 'Still missing after the retry'],
    ['skipped', 'ds-badge--warning', 'Retry not completed', 'Still missing'],
  ] as const)('%s', (retryOutcome, tone, text, lead) => {
    expect(coverageBadge({ retryOutcome })).toEqual({ tone, text })
    expect(missingLead({ retryOutcome })).toBe(lead)
  })
})
