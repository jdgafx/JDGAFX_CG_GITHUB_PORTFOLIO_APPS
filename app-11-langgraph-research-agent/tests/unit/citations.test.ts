import { describe, expect, it } from 'vitest'
import { citedNumbers, sanitizeCitations, sourcesFor, type Evidence } from '../../netlify/shared/citations'

const EVIDENCE: Evidence[] = [
  { n: 1, title: 'Expo 98', url: 'https://en.wikipedia.org/wiki/Expo_98', extract: 'Held in 1998.' },
  { n: 2, title: 'Lisbon', url: 'https://en.wikipedia.org/wiki/Lisbon', extract: 'A capital city.' },
]

describe('citedNumbers', () => {
  it('returns each cited number once, in ascending order', () => {
    expect(citedNumbers('A [2] and B [1][2]. C [10].')).toEqual([1, 2, 10])
  })

  it('returns nothing when the answer cites nothing', () => {
    expect(citedNumbers('No citations here.')).toEqual([])
  })
})

describe('sanitizeCitations', () => {
  it('removes markers that name no source and keeps the valid ones', () => {
    expect(sanitizeCitations('Lisbon hosted it [1]. The theme was new [7] and fresh [2].', EVIDENCE)).toBe(
      'Lisbon hosted it [1]. The theme was new and fresh [2].',
    )
  })

  it('leaves a sentence clean when its only marker was invalid', () => {
    expect(sanitizeCitations('Only a guess [9].', EVIDENCE)).toBe('Only a guess.')
  })

  it('leaves text without markers alone apart from trimming', () => {
    expect(sanitizeCitations('  Plain answer.  ', EVIDENCE)).toBe('Plain answer.')
  })
})

describe('sourcesFor', () => {
  it('lists only the sources the answer cites, in source-number order', () => {
    expect(sourcesFor('Answer [2] and [1].', EVIDENCE)).toEqual([
      { n: 1, title: 'Expo 98', url: 'https://en.wikipedia.org/wiki/Expo_98' },
      { n: 2, title: 'Lisbon', url: 'https://en.wikipedia.org/wiki/Lisbon' },
    ])
  })

  it('lists a single cited source and leaves out the extracts', () => {
    expect(sourcesFor('Answer [2].', EVIDENCE)).toEqual([
      { n: 2, title: 'Lisbon', url: 'https://en.wikipedia.org/wiki/Lisbon' },
    ])
  })

  it('lists nothing when the answer cites nothing', () => {
    expect(sourcesFor('No cite.', EVIDENCE)).toEqual([])
  })
})
