import { describe, expect, it } from 'vitest'
import { CHUNK_TARGET, MAX_CHUNKS, splitText } from '../../netlify/shared/chunk'
import { SAMPLE_TEXT } from '../../src/lib/sample'

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
    const chunks = splitText(SAMPLE_TEXT)

    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, i) => i + 1))
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(CHUNK_TARGET)
  })

  it('gives the sample exactly 9 chunks, starting and ending where the document does', () => {
    const chunks = splitText(SAMPLE_TEXT)

    expect(chunks).toHaveLength(9)
    expect(chunks[0]?.text.startsWith('IN CONGRESS, July 4, 1776.')).toBe(true)
    expect(chunks[8]?.text.endsWith('Lyman Hall, George Walton.')).toBe(true)
    expect(chunks.map((c) => c.text.length)).toEqual([1158, 1062, 1103, 1175, 951, 1192, 530, 1196, 942])
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
