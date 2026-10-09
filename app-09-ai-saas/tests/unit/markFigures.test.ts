import { describe, expect, it } from 'vitest'
import { markFigures } from '../../src/lib/markFigures'

describe('markFigures', () => {
  it('flags the rejected figure and leaves the text around it', () => {
    expect(markFigures("zod is about 1.5 times react's 5.70 billion.", ['1.5 times'])).toEqual([
      { text: 'zod is about ', flagged: false },
      { text: '1.5 times', flagged: true },
      { text: " react's 5.70 billion.", flagged: false },
    ])
  })

  it('finds a figure listed with a direction note', () => {
    expect(markFigures('It fell 44% that day.', ['44% (direction does not match)'])).toEqual([
      { text: 'It fell ', flagged: false },
      { text: '44%', flagged: true },
      { text: ' that day.', flagged: false },
    ])
  })

  it('does not flag the figure inside a longer number', () => {
    expect(markFigures('Up 144% and 4.5%, but 45% is wrong.', ['45%'])).toEqual([
      { text: 'Up 144% and 4.5%, but ', flagged: false },
      { text: '45%', flagged: true },
      { text: ' is wrong.', flagged: false },
    ])
  })

  it('handles dates, versions and several figures, longest first', () => {
    const pieces = markFigures('After 19.3.0 on September 29 and 19.3.01.', ['19.3.0', 'September 29'])
    expect(pieces.filter((p) => p.flagged).map((p) => p.text)).toEqual(['19.3.0', 'September 29'])
  })

  it('returns the text untouched when nothing was rejected', () => {
    expect(markFigures('Nothing wrong.', [])).toEqual([{ text: 'Nothing wrong.', flagged: false }])
  })
})
