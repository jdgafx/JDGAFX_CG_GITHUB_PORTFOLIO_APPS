import { describe, expect, it } from 'vitest'
import { groupReason } from '../../src/lib/categories'

describe('groupReason', () => {
  it('explains each curated group in plain words', () => {
    expect(groupReason('Speed and latency')).toBe('Small models that answer quickly and cost little.')
    expect(groupReason('Frontier quality')).toBe('Top general models, chosen for answer quality rather than price.')
  })

  it('explains the other live models group by its context floor', () => {
    expect(groupReason('All other live text models')).toMatch(/32,000 tokens of context/)
  })

  it('still gives a sentence for a group the page does not know', () => {
    expect(groupReason('A group added later')).toBe('A text model from the model list.')
  })
})
