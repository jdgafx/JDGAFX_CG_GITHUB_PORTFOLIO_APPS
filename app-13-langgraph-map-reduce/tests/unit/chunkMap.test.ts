import { describe, expect, it } from 'vitest'
import { head, summarize, tail } from '../../src/lib/chunkMap'
import { splitText } from '../../netlify/shared/chunk'

const sentence = (i: number): string => `Item ${String(i).padStart(2, '0')} ${'alpha beta gamma '.repeat(15).trim()}.`
const TEXT = Array.from({ length: 24 }, (_, i) => sentence(i + 1)).join(' ')

describe('the chunk map reads the same chunks the server makes', () => {
  it('has the count, sizes and boundaries of splitText', () => {
    const chunks = splitText(TEXT)
    const summary = summarize(TEXT)
    expect(summary.count).toBe(chunks.length)
    expect(summary.facts.map((f) => f.chars)).toEqual(chunks.map((c) => c.text.length))
    expect(summary.chars).toBe(chunks.reduce((n, c) => n + c.text.length, 0))
    expect(summary.largest).toBe(Math.max(...chunks.map((c) => c.text.length)))
    expect(summary.smallest).toBe(Math.min(...chunks.map((c) => c.text.length)))
    for (const [i, fact] of summary.facts.entries()) {
      expect(fact.id).toBe(i + 1)
      expect(chunks[i]?.text.startsWith(fact.start.replace(/…$/, ''))).toBe(true)
      expect(chunks[i]?.text.endsWith(fact.end.replace(/^…/, ''))).toBe(true)
    }
  })

  it('shows no chunks for text the analysis would refuse', () => {
    expect(summarize('').count).toBe(0)
    expect(summarize('too short').count).toBe(0)
    expect(summarize('x '.repeat(10_001)).count).toBe(0)
  })

  it('sizes the bars against the largest chunk', () => {
    const { facts } = summarize(TEXT)
    expect(Math.max(...facts.map((f) => f.share))).toBe(1)
    expect(facts.every((f) => f.share > 0 && f.share <= 1)).toBe(true)
  })
})

describe('boundary excerpts', () => {
  it('cut at a word and mark a cut with an ellipsis, and only a cut', () => {
    const long = 'one two three four five six seven eight nine ten '.repeat(5).trim()
    expect(head(long, 20)).toMatch(/^one two three four…$/)
    expect(tail(long, 20)).toMatch(/^…[a-z ]+ten$/)
    expect(head('short text')).toBe('short text')
    expect(tail('short text')).toBe('short text')
  })
})
