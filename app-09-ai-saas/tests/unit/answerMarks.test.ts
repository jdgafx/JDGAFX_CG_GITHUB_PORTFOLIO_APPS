import { describe, expect, it } from 'vitest'
import { explanationLines, markLine } from '../../src/lib/answerMarks'
import { markSpans } from '../../src/lib/markFigures'

const flagged = (pieces: ReturnType<typeof markLine>) => pieces.flatMap((p) => p.parts.filter((part) => part.flagged).map((part) => part.text))

describe('markSpans', () => {
  it('flags only the given ranges and clips ranges outside the text', () => {
    expect(markSpans('abcdef', [{ start: 2, end: 4 }, { start: 5, end: 99 }])).toEqual([
      { text: 'ab', flagged: false },
      { text: 'cd', flagged: true },
      { text: 'e', flagged: false },
      { text: 'f', flagged: true },
    ])
    expect(markSpans('abc', [{ start: -5, end: -1 }])).toEqual([{ text: 'abc', flagged: false }])
  })
})

describe('explanationLines and markLine', () => {
  // The live case: both figures read "30 times"; only the first (react / vue = 11) is wrong. The second (react / svelte = 29.85) is right.
  const TEXT = "1. React is bigger.\n\n2. React is roughly 30 times Vue's 72 million total and about 30 times Svelte's 26.5 million."
  const first = TEXT.indexOf('30 times')

  it('finds each line with its offset in the whole text', () => {
    const lines = explanationLines(TEXT)
    expect(lines.map((l) => l.text)).toEqual(['1. React is bigger.', "2. React is roughly 30 times Vue's 72 million total and about 30 times Svelte's 26.5 million."])
    expect(TEXT.slice(lines[1].offset, lines[1].offset + 2)).toBe('2.')
  })

  it('marks exactly one "30 times" when the server gives the position of the rejected one', () => {
    const line = explanationLines(TEXT)[1]
    const pieces = markLine(line, [{ start: first, end: first + '30 times'.length }], ['30 times'])
    expect(flagged(pieces)).toEqual(['30 times'])
    const whole = pieces.flatMap((p) => p.parts.map((part) => part.text)).join('')
    expect(whole).toBe(line.text)
    // It is the first one: the text before the mark holds no other "30 times".
    const before = whole.slice(0, whole.indexOf('30 times'))
    expect(before).not.toContain('30 times')
  })

  it('falls back to matching the text, every occurrence, when there are no positions', () => {
    expect(flagged(markLine(explanationLines(TEXT)[1], null, ['30 times']))).toEqual(['30 times', '30 times'])
  })

  it('places a mark correctly after strong and emphasis markers', () => {
    const text = 'Zod holds **40.1%** and *7.85 billion* downloads, about 9 times react.'
    const at = text.indexOf('9 times')
    const pieces = markLine(explanationLines(text)[0], [{ start: at, end: at + 7 }], [])
    expect(flagged(pieces)).toEqual(['9 times'])
    const strongAt = text.indexOf('40.1%')
    expect(flagged(markLine(explanationLines(text)[0], [{ start: strongAt, end: strongAt + 5 }], []))).toEqual(['40.1%'])
  })
})
