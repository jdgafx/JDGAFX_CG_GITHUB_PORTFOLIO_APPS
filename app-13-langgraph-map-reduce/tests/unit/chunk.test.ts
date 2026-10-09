import { describe, expect, it } from 'vitest'
import { CHUNK_TARGET, MAX_CHUNKS, splitText } from '../../netlify/shared/chunk'

/** Sentence i is 263 characters ("Item 01 " plus 15 x "alpha beta gamma" plus the full stop), so four fit a 1,200 character chunk and five do not. */
const sentence = (i: number): string => `Item ${String(i).padStart(2, '0')} ${'alpha beta gamma '.repeat(15).trim()}.`
const GENERATED = Array.from({ length: 24 }, (_, i) => sentence(i + 1)).join(' ')

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean)

describe('splitText', () => {
  it('returns no chunks for empty or blank input', () => {
    expect(splitText('')).toEqual([])
    expect(splitText('   \n\n  ')).toEqual([])
  })

  it('breaks only on sentence boundaries, so no sentence is cut in two', () => {
    const sentences = Array.from({ length: 5 }, (_, i) => `Sentence ${i} ${'word '.repeat(90).trim()}.`)
    const chunks = splitText(sentences.join(' '))

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.text.endsWith('.'))).toBe(true)
    expect(chunks.map((c) => c.text).join(' ')).toBe(sentences.join(' '))
  })

  it('numbers chunks from 1 with no gaps and keeps every chunk within the target size', () => {
    const chunks = splitText(GENERATED)

    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, i) => i + 1))
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(CHUNK_TARGET)
  })

  it('packs 24 sentences into exactly 6 chunks of 4, starting and ending where the document does', () => {
    const chunks = splitText(GENERATED)

    expect(sentence(1)).toHaveLength(263)
    expect(chunks).toHaveLength(6)
    expect(chunks[0]?.text.startsWith('Item 01 alpha')).toBe(true)
    expect(chunks[5]?.text.startsWith('Item 21 alpha')).toBe(true)
    expect(chunks[5]?.text.endsWith('gamma.')).toBe(true)
    expect(chunks.map((c) => c.text.length)).toEqual([1055, 1055, 1055, 1055, 1055, 1055])
  })

  it('never produces more than the chunk cap, and keeps every word, for a text at the input limit', () => {
    const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} has some words in it.`).join(' ').slice(0, 20000)
    const chunks = splitText(text)

    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap((c) => words(c.text))).toEqual(words(text))
  })

  it('splits one oversized word run into pieces that fit the target', () => {
    const chunks = splitText('x'.repeat(3000))

    expect(chunks.length).toBeGreaterThanOrEqual(3)
    expect(chunks.every((c) => c.text.length <= CHUNK_TARGET)).toBe(true)
    expect(chunks.map((c) => c.text).join('')).toBe('x'.repeat(3000))
  })
})
