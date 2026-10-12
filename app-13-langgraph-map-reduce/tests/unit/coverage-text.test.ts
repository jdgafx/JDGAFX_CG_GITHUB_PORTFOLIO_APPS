import { describe, expect, it } from 'vitest'
import { coverageBadge, missingItems, missingLead } from '../../src/lib/coverage-text'

describe('missingItems', () => {
  it('gives each missing chunk its own reason', () => {
    expect(missingItems({ covered: [1], missing: [2, 6], noPoints: [2], citedPoints: [], uncitedPoints: [], unchecked: [] })).toEqual([
      'chunk 2 (no key points found)',
      'chunk 6 (not cited in the summary)',
    ])
  })
})

describe('the coverage badge and the missing line follow the retry outcome', () => {
  it.each([
    ['none', 'ds-badge--success', 'No chunk retry needed', 'Still missing'],
    ['used', 'ds-badge--success', '1 retry used', 'Still missing after the retry'],
    ['used-nothing-new', 'ds-badge--warning', '1 retry used, nothing new', 'Still missing after the retry'],
    ['kept-first', 'ds-badge--warning', '1 retry used, first pass kept', 'Still missing after the retry'],
    ['skipped', 'ds-badge--warning', 'Retry not completed', 'Still missing'],
  ] as const)('%s', (retryOutcome, tone, text, lead) => {
    expect(coverageBadge({ retryOutcome })).toEqual({ tone, text })
    expect(missingLead({ retryOutcome })).toBe(lead)
  })
})
