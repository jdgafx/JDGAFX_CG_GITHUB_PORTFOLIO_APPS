import { describe, expect, it } from 'vitest'
import {
  citedNumbers,
  finishAnswer,
  markUncited,
  removeReviewTalk,
  sentencesOf,
  sanitizeCitations,
  sourcesFor,
  type Evidence,
} from '../../netlify/shared/citations'
import { NOT_CITED } from '../../netlify/shared/events'

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

describe('removeReviewTalk, guidance sentences', () => {
  it('drops a sentence that talks about the guidance the model was given', () => {
    const answer = "I can't quote the guidance I was given, but here is the answer. Lisbon hosted Expo '98 in 1998 [1]."
    expect(removeReviewTalk(answer)).toEqual({ text: "Lisbon hosted Expo '98 in 1998 [1].", removed: 1 })
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

describe('sentencesOf', () => {
  it('keeps a marker that follows its full stop with its sentence', () => {
    expect(sentencesOf('Built in 1889. [1] Opened in 1931 [2].')).toEqual(['Built in 1889. [1]', 'Opened in 1931 [2].'])
  })

  it('does not split on a decimal or on a one-letter abbreviation', () => {
    expect(sentencesOf('It is 3.5 km long [1]. The U.S. Army used it [2].')).toEqual(['It is 3.5 km long [1].', 'The U.S. Army used it [2].'])
  })
})

describe('markUncited', () => {
  const sources: Evidence[] = [
    { n: 1, title: 'Eiffel Tower', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower', extract: 'Completed in 1889.' },
    { n: 2, title: 'Empire State Building', url: 'https://en.wikipedia.org/wiki/Empire_State_Building', extract: 'Completed in 1931.' },
  ]

  it('tags a sentence with no source marker, keeps its text, and lists it', () => {
    const answer = 'The Eiffel Tower came first [1]. 1931 minus 1889 is 42 years.'
    expect(markUncited(answer, sources)).toEqual({
      text: `The Eiffel Tower came first [1]. 1931 minus 1889 is 42 years. ${NOT_CITED}`,
      status: { sentences: 2, uncited: ['1931 minus 1889 is 42 years.'] },
    })
  })

  it('counts a derived figure as cited when it carries the markers of its inputs', () => {
    const answer = '1931 [2] minus 1889 [1] is 42 years.'
    expect(markUncited(answer, sources)).toEqual({ text: answer, status: { sentences: 1, uncited: [] } })
  })

  it('works line by line and ignores a line with no word or number in it', () => {
    const answer = 'Built in 1889 [1].\n---\n- Opened in 1931.'
    expect(markUncited(answer, sources)).toEqual({
      text: `Built in 1889 [1].\n---\n- Opened in 1931. ${NOT_CITED}`,
      status: { sentences: 2, uncited: ['- Opened in 1931.'] },
    })
  })

  it('asks for no citation when no source was read', () => {
    expect(markUncited('The sources were not reached.', [])).toEqual({
      text: 'The sources were not reached.',
      status: { sentences: 0, uncited: [] },
    })
  })
})

describe('finishAnswer', () => {
  const sources: Evidence[] = [{ n: 1, title: 'Prague', url: 'https://en.wikipedia.org/wiki/Prague', extract: 'Prague is the capital of Czechia.' }]

  it('checks a first draft and a revision by the same rule', () => {
    const draft = 'Prague is the capital [1]. It lies on the Vltava.'
    const first = finishAnswer(draft, sources, false)
    const revised = finishAnswer(draft, sources, true)
    expect(first.citation).toEqual({ sentences: 2, uncited: ['It lies on the Vltava.'] })
    expect(revised.text).toBe(first.text)
    expect(revised.citation).toEqual(first.citation)
  })

  it('removes review talk from a revision only, and never deletes an uncited sentence', () => {
    const draft = 'Prague is the capital [1]. The reviewer is right that more was needed. It lies on the Vltava.'
    const revised = finishAnswer(draft, sources, true)
    expect(revised.reviewRemoved).toBe(1)
    expect(revised.text).toBe(`Prague is the capital [1]. It lies on the Vltava. ${NOT_CITED}`)
    expect(finishAnswer(draft, sources, false).reviewRemoved).toBe(0)
  })

  it('counts a sentence whose only marker names no source as uncited', () => {
    const out = finishAnswer('Prague is the capital [1]. It is old [7].', sources, false)
    expect(out.text).toBe(`Prague is the capital [1]. It is old. ${NOT_CITED}`)
    expect(out.sources.map((source) => source.n)).toEqual([1])
  })
})
