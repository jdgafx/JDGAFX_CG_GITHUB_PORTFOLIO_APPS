import { describe, it, expect } from 'vitest'
import { questionTerms, retrieve, scoreChunk } from '../../src/lib/api'

describe('questionTerms', () => {
  it('keeps the content words and drops stop words and short tokens', () => {
    const terms = [...questionTerms('What revenue did Gadget Y earn in 2024?')].sort()
    expect(terms).toEqual(['2024', 'earn', 'gadget', 'revenue'])
  })

  it('falls back to every token when the question is only stop words', () => {
    const terms = [...questionTerms('What is this about?')].sort()
    expect(terms).toEqual(['about', 'this', 'what'])
  })
})

describe('scoreChunk', () => {
  const terms = new Set(['revenue', 'gadget'])

  it('scores a passage that covers both terms at 1.2', () => {
    // Coverage 2/2, density 2/sqrt(4) capped at 1, plus 0.4 * (1/2) * 1.
    expect(scoreChunk('Gadget revenue rose sharply.', terms)).toBeCloseTo(1.2, 9)
  })

  it('scores a passage that covers one term at 0.6', () => {
    // Coverage 1/2, density 1/sqrt(4) = 0.5, plus 0.4 * (1/2) * 0.5.
    expect(scoreChunk('Gadget sales were flat.', terms)).toBeCloseTo(0.6, 9)
  })

  it('scores a passage with no matching term at 0', () => {
    expect(scoreChunk('Nothing relevant here.', terms)).toBe(0)
  })

  it('scores everything at 0 when the question has no terms', () => {
    expect(scoreChunk('Gadget revenue rose sharply.', new Set())).toBe(0)
  })
})

describe('retrieve', () => {
  const chunks = [
    'Gadget sales were flat.',
    'Nothing relevant here.',
    'Gadget revenue rose sharply.',
    'Revenue of the gadget line grew.',
  ]

  it('keeps the highest-scoring passages and returns them in document order', () => {
    expect(retrieve('gadget revenue', chunks, 2).map(c => c.index)).toEqual([2, 3])
    expect(retrieve('gadget revenue', chunks, 3).map(c => c.index)).toEqual([0, 2, 3])
  })

  it('returns no passages when none shares a word with the question', () => {
    expect(retrieve('zebra', chunks)).toEqual([])
  })

  it('returns at most 20 passages by default, the same limit the server accepts', () => {
    const many = Array.from({ length: 25 }, (_, i) => `Gadget note ${i}`)
    const top = retrieve('gadget', many)
    expect(top).toHaveLength(20)
    expect(top.map(c => c.index)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })
})
