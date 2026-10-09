import { describe, expect, it } from 'vitest'
import { proseOf, readability, syllables } from '../../netlify/shared/readability'

describe('syllables', () => {
  it.each([['the', 1], ['reading', 2], ['syllable', 3], ['beautiful', 3], ['make', 1], ['wanted', 2], ['queue', 1], ['memory', 3], ['jumped', 1], ['', 0]])('%s has %i', (word, count) => {
    expect(syllables(word)).toBe(count)
  })
})

describe('proseOf', () => {
  it('drops headings, citation markers, link markup and emphasis marks', () => {
    expect(proseOf('## Title\n- A **bold** claim [1].\nSee [the page](https://x.test) now.')).toBe('A bold claim .\nSee the page now.')
  })
})

describe('readability', () => {
  it('computes Flesch reading ease and words per sentence from counts', () => {
    // 6 words, 2 sentences, 6 syllables: 206.835 - 1.015 * 3 - 84.6 * 1 = 119.19
    const result = readability('The cat sat. The dog ran.')
    expect(result).toEqual({ words: 6, sentences: 2, wordsPerSentence: 3, fleschEase: 119.2 })
  })

  it('scores long Latinate sentences as harder than short plain ones', () => {
    const plain = readability('We build tools. They help people write. Small steps work.')
    const dense = readability('Notwithstanding considerable organizational complexity, institutional methodologies necessitate comprehensive interdepartmental coordination mechanisms.')
    expect(plain && dense && plain.fleschEase - dense.fleschEase).toBeGreaterThan(80)
    expect(dense?.wordsPerSentence).toBe(11)
  })

  it('ignores headings and citation markers, so the Sources list and [n] do not move the score', () => {
    const base = readability('Rust is fast. It is safe.')
    expect(readability('## Why Rust\n\nRust is fast [1]. It is safe [2].')).toEqual(base)
  })

  it('counts a bullet without an end mark as one sentence', () => {
    expect(readability('- one two three\n- four five six')?.sentences).toBe(2)
  })

  it('returns null for text with no words', () => {
    expect(readability('## Only a heading')).toBeNull()
    expect(readability('')).toBeNull()
  })
})
