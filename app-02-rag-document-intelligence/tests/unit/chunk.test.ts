import { describe, it, expect } from 'vitest'
import { chunkText, stripPageMarkers } from '../../src/lib/chunk'

// Builds text the way src/lib/pdf.ts does: a marker line, the page text, then a blank line.
function pdfText(pages: string[]): string {
  return pages.map((page, i) => `--- Page ${i + 1} ---\n${page}\n\n`).join('')
}

// Deterministic pseudo-random numbers in [0, 1), so a failing layout can be replayed by its seed.
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

// Pages of filler words with sentence stops scattered through them, so passage ends land in many places.
function randomPages(seed: number): string[] {
  const next = seededRandom(seed)
  const pageCount = 2 + Math.floor(next() * 4)
  return Array.from({ length: pageCount }, () => {
    const wordCount = 150 + Math.floor(next() * 250)
    return Array.from({ length: wordCount }, () => (next() < 0.08 ? 'stop.' : 'filler')).join(' ')
  })
}

describe('chunkText', () => {
  it('keeps marker text out of every passage, wherever a passage boundary falls', () => {
    for (let n = 300; n <= 1500; n += 37) {
      const { chunks } = chunkText(pdfText(['a'.repeat(n), 'b'.repeat(n), 'c'.repeat(n)]))
      expect(chunks.length).toBeGreaterThan(0)
      for (const chunk of chunks) {
        expect(chunk).not.toMatch(/---|Page \d/)
      }
    }
  })

  it('keeps marker text out of passages for 300 random page layouts', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { chunks } = chunkText(pdfText(randomPages(seed)))
      for (const chunk of chunks) {
        expect(chunk, `seed ${seed}`).not.toMatch(/---|Page \d/)
      }
    }
  })

  it('gives each passage the page where its first character sits', () => {
    const { chunks, chunkPages } = chunkText(pdfText(['a'.repeat(1200), 'b'.repeat(1200), 'c'.repeat(1200)]))
    const pageOfLetter: Record<string, number> = { a: 1, b: 2, c: 3 }
    expect(chunkPages).toEqual(chunks.map(chunk => pageOfLetter[chunk.charAt(0)]))
    expect(new Set(chunkPages)).toEqual(new Set([1, 2, 3]))
  })

  it('assigns every passage of a text file without markers to page 1', () => {
    const { chunks, chunkPages } = chunkText('Plain sentence number. '.repeat(80))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunkPages).toEqual(chunks.map(() => 1))
  })

  it('drops fragments at or below the minimum passage length', () => {
    expect(chunkText('Too short.').chunks).toEqual([])
  })

  it('produces no passage from pages that contain only markers', () => {
    expect(chunkText(pdfText(['', ''])).chunks).toEqual([])
  })
})

describe('stripPageMarkers', () => {
  it('removes markers and joins the pages with single spaces', () => {
    expect(stripPageMarkers(pdfText(['Hello', 'World']))).toBe('Hello World')
  })
})

describe('chunk boundaries and decimals', () => {
  it('does not end a passage inside a decimal number', () => {
    const text = `${'word '.repeat(99)}score 41.8 single-model. ${'tail '.repeat(40)}`
    const { chunks } = chunkText(text, 500)
    expect(chunks.some(c => c.endsWith('41.'))).toBe(false)
    expect(chunks[0]?.endsWith('single-model.')).toBe(true)
  })
})
