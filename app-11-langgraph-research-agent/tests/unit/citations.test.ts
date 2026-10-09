import { describe, expect, it } from 'vitest'
import { citedNumbers, removeReviewTalk, sanitizeCitations, sourcesFor, type Evidence } from '../../netlify/shared/citations'

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

describe('removeReviewTalk', () => {
  it('removes the sentences that speak about the reviewer, the previous draft or the notes, and keeps the answer', () => {
    const answer =
      "Lisbon hosted Expo '98 in 1998 [1]. The reviewer's concern is accurate on both counts. Its theme was The Oceans [1]. As the critic noted, the previous draft left out the theme."
    expect(removeReviewTalk(answer)).toEqual({
      text: "Lisbon hosted Expo '98 in 1998 [1]. Its theme was The Oceans [1].",
      removed: 2,
    })
  })

  it('works line by line and drops a line that is nothing but review talk', () => {
    const answer = 'The Vltava flows through Prague [1].\nThe reviewer is right that Smetana was not read.\nIt is the longest river in Czechia [1].'
    expect(removeReviewTalk(answer)).toEqual({
      text: 'The Vltava flows through Prague [1].\nIt is the longest river in Czechia [1].',
      removed: 1,
    })
  })

  it('leaves a plain answer alone: a film critic and the first draft of a script are not the review', () => {
    const answer = 'Roger Ebert was a film critic who reviewed Blade Runner [1]. The first draft of the script was written in 1977 [2].'
    expect(removeReviewTalk(answer)).toEqual({ text: answer, removed: 0 })
  })

  it('keeps an answer whole when every sentence is review talk, and still counts them', () => {
    const answer = "The reviewer's concern is accurate. The critic is right."
    expect(removeReviewTalk(answer)).toEqual({ text: answer, removed: 2 })
  })
})
