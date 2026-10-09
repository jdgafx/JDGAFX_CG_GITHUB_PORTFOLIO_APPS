import { describe, expect, it } from 'vitest'
import { missingParts, parseComparison } from '../../netlify/shared/compare'

const FULL = `## Similarities
- Both show a red road sign
- Both are photographed in daylight
## Differences
- A is round, B is a triangle
  and B is dented
## Verdict
B is the clearer photo.
It is sharper.`

describe('parseComparison', () => {
  it('splits a reply into bullet lists and a one-paragraph verdict, joining wrapped bullets', () => {
    expect(parseComparison(FULL)).toEqual({
      similarities: ['Both show a red road sign', 'Both are photographed in daylight'],
      differences: ['A is round, B is a triangle and B is dented'],
      verdict: 'B is the clearer photo. It is sharper.',
    })
  })

  it('reads bold and colon headings and numbered lists', () => {
    const parsed = parseComparison('**Similarities**\n1. one\n2) two\nDifferences:\n* three\n**Verdict:**\nfour')
    expect(parsed).toEqual({ similarities: ['one', 'two'], differences: ['three'], verdict: 'four' })
  })

  it('works on a partial reply while it streams', () => {
    expect(parseComparison('## Similarities\n- Both')).toEqual({ similarities: ['Both'], differences: [], verdict: '' })
    expect(parseComparison('')).toEqual({ similarities: [], differences: [], verdict: '' })
  })
})

describe('missingParts', () => {
  it('is empty for a complete reply and names each absent part otherwise', () => {
    expect(missingParts(FULL)).toEqual([])
    expect(missingParts('## Similarities\n- a\n## Verdict\nb')).toEqual(['differences'])
    expect(missingParts('nothing useful')).toEqual(['similarities', 'differences', 'verdict'])
  })
})
