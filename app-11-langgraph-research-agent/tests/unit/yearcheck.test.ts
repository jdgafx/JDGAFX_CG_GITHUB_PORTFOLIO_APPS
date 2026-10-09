import { describe, expect, it } from 'vitest'
import type { Evidence } from '../../netlify/shared/citations'
import { yearGapIssues } from '../../netlify/shared/graph/yearcheck'

const QUESTION = 'Which was completed first, the Eiffel Tower or the Empire State Building, and how many years apart?'
const EVIDENCE: Evidence[] = [
  {
    n: 1,
    title: 'Eiffel Tower',
    url: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
    extract: "The Eiffel Tower was designed and built by Gustave Eiffel's company from 1887 to 1889 for the 1889 World's Fair.",
  },
  {
    n: 2,
    title: 'Empire State Building',
    url: 'https://en.wikipedia.org/wiki/Empire_State_Building',
    extract: 'The Empire State Building was constructed between 1930 and 1931 and opened on May 1, 1931.',
  },
]

describe('yearGapIssues', () => {
  it('flags a gap worked out from the start of a range: 1930 minus 1889 is 41, the building was completed in 1931', () => {
    const answer =
      'The Eiffel Tower was completed first [1]. The Empire State Building was constructed between 1930 and 1931 [2]. The gap is 41 years (1930 minus 1889).'
    expect(yearGapIssues(QUESTION, answer, EVIDENCE)).toEqual([
      {
        quote: 'The gap is 41 years (1930 minus 1889).',
        fix: 'The sources give 1930 to 1931, so 1930 is when it began. Use 1931, when it was completed, and work the gap out again.',
      },
    ])
  })

  it('accepts the gap worked out from the completion years', () => {
    expect(yearGapIssues(QUESTION, 'The gap is 42 years (1931 minus 1889) [1][2].', EVIDENCE)).toEqual([])
    const long =
      'The Eiffel Tower was completed first. It was built from 1887 to 1889 [1]. The Empire State Building was constructed between 1930 and 1931 [2]. Subtracting 1889 from 1931 gives 42 years apart.'
    expect(yearGapIssues(QUESTION, long, EVIDENCE)).toEqual([])
  })

  it('flags a gap that is not the difference of the years named', () => {
    expect(yearGapIssues(QUESTION, 'The Eiffel Tower was completed in 1889 and the Empire State Building in 1931, 45 years apart.', EVIDENCE)).toEqual([
      {
        quote: 'The Eiffel Tower was completed in 1889 and the Empire State Building in 1931, 45 years apart.',
        fix: 'The years named differ by 42, not 45. Work the gap out from the year each event was completed.',
      },
    ])
  })

  it('finds the years in the answer when the sentence with the gap names none', () => {
    const answer = 'The Eiffel Tower was completed in 1889 [1]. The Empire State Building was completed in 1931 [2]. They are 42 years apart.'
    expect(yearGapIssues(QUESTION, answer, EVIDENCE)).toEqual([])
    expect(yearGapIssues(QUESTION, answer.replace('42 years', '44 years'), EVIDENCE)[0]?.fix).toContain('differ by 42, not 44')
  })

  it('flags a year that is in none of the sources', () => {
    const issues = yearGapIssues(QUESTION, 'The gap is 40 years (1931 minus 1891).', EVIDENCE)
    expect(issues).toEqual([{ quote: 'The gap is 40 years (1931 minus 1891).', fix: '1891 is not in the sources. Use the years the sources give.' }])
  })

  it('does not flag a duration that is the range itself', () => {
    // The sentence with "2 years" names 1887 and 1889, which is exactly the range the source gives.
    expect(yearGapIssues('How many years did it take, and how many years apart?', 'It took 2 years (1887 to 1889) between start and end [1].', EVIDENCE)).toEqual([])
  })

  it('says nothing for a question that asks for no gap, or an answer with no gap', () => {
    expect(yearGapIssues('Who designed the Eiffel Tower?', 'It was built in 1889, 41 years apart (1930 minus 1889).', EVIDENCE)).toEqual([])
    expect(yearGapIssues(QUESTION, 'The sources do not say.', EVIDENCE)).toEqual([])
  })
})
