import { describe, expect, it } from 'vitest'
import { createSentenceSplitter, speakable } from '../../src/lib/sentences'

function feedAll(pieces: string[]): string[] {
  const splitter = createSentenceSplitter()
  return [...pieces.flatMap(piece => splitter.push(piece)), ...splitter.flush()]
}

describe('createSentenceSplitter', () => {
  it('splits a recorded weather answer into its two sentences, keeping the decimals whole', () => {
    const reply = "It's currently 21.9 degrees Celsius in Lisbon, Portugal, with a clear sky. It feels like 18.9 degrees, and today's high is 25.4 degrees with a low of 17.1 degrees."
    expect(feedAll([reply])).toEqual([
      "It's currently 21.9 degrees Celsius in Lisbon, Portugal, with a clear sky.",
      "It feels like 18.9 degrees, and today's high is 25.4 degrees with a low of 17.1 degrees.",
    ])
  })

  it('does not end a sentence at a period between digits, even when the stream cuts there', () => {
    const splitter = createSentenceSplitter()
    expect(splitter.push('It is 16.')).toEqual([])
    expect(splitter.push('8 °C and clear. ')).toEqual(['It is 16.8 °C and clear.'])
  })

  it('releases a sentence only once the space after its end has arrived', () => {
    const splitter = createSentenceSplitter()
    expect(splitter.push('Ada Lovelace was an English mathematician.')).toEqual([])
    expect(splitter.pending()).toBe('Ada Lovelace was an English mathematician.')
    expect(splitter.push(' She wrote')).toEqual(['Ada Lovelace was an English mathematician.'])
    expect(splitter.flush()).toEqual(['She wrote'])
  })

  it('skips initials and abbreviations', () => {
    expect(feedAll(['J. R. R. Tolkien wrote it. Dr. Smith, e.g. the author, agreed. Done.'])).toEqual([
      'J. R. R. Tolkien wrote it.',
      'Dr. Smith, e.g. the author, agreed.',
      'Done.',
    ])
  })

  it('ends a sentence at a question mark, an exclamation mark, an ellipsis and a line break', () => {
    expect(feedAll(['Really? Yes! Maybe... Fine.\nNext line'])).toEqual(['Really?', 'Yes!', 'Maybe...', 'Fine.', 'Next line'])
  })

  it('works when the text arrives a few characters at a time', () => {
    const reply = 'One. Two words. Three more words here.'
    expect(feedAll([...reply].map(c => c))).toEqual(['One.', 'Two words.', 'Three more words here.'])
  })

  it('speaks a long run-on at its last comma instead of holding the voice back', () => {
    const clause = `${'word '.repeat(30)}and then, `
    const rest = 'word '.repeat(10)
    const [first, ...others] = feedAll([clause + rest])
    expect(first.endsWith('and then,')).toBe(true)
    expect(others.join(' ')).toBe(rest.trim())
  })

  it('returns nothing for empty input', () => {
    expect(feedAll(['', '  '])).toEqual([])
  })
})

describe('speakable', () => {
  it('removes markdown markers so the voice does not read them', () => {
    expect(speakable('It is **warm** and *clear*, see `x`.')).toBe('It is warm and clear, see x.')
  })
})

describe('settle', () => {
  it('completes a tail that ends like a sentence when the stream goes quiet', () => {
    const splitter = createSentenceSplitter()
    expect(splitter.push('Let me look up Ada Lovelace for you.')).toEqual([])
    expect(splitter.settle()).toEqual(['Let me look up Ada Lovelace for you.'])
    expect(splitter.pending()).toBe('')
  })

  it('leaves a tail that ends in a decimal point, an abbreviation or a word', () => {
    for (const tail of ['It is 16.', 'You could ask Dr.', 'Let me check the weather in']) {
      const splitter = createSentenceSplitter()
      splitter.push(tail)
      expect(splitter.settle()).toEqual([])
      expect(splitter.pending()).toBe(tail)
    }
  })
})
