import { describe, expect, it } from 'vitest'
import { jsonObject, parseExtraction, parseOmitted, parseSummary } from '../../netlify/shared/parse'

const IDS = [1, 2, 3]

describe('jsonObject', () => {
  it('reads an object wrapped in a code fence or prose', () => {
    expect(jsonObject('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  it('reads the first complete object when prose with braces comes before and after it', () => {
    expect(jsonObject('Note {this is prose}. Result: {"points": ["Rent."], "entities": []} Thanks {again}.')).toEqual({
      points: ['Rent.'],
      entities: [],
    })
  })

  it('reads a fenced reply end to end, and ignores braces inside strings', () => {
    const reply = '```json\n{"points": ["Use {braces} with care."], "entities": ["Lessor"]}\n```\nThat is all.'

    expect(parseExtraction(reply)).toEqual({ points: ['Use {braces} with care.'], entities: ['Lessor'] })
  })

  it('handles nested objects and skips a brace that does not open valid JSON', () => {
    expect(jsonObject('set {x} then {"a": {"b": [1, 2]}} done')).toEqual({ a: { b: [1, 2] } })
  })

  it('returns null for an object that never closes', () => {
    expect(jsonObject('{"points": ["cut short"')).toBeNull()
  })

  it('returns null when there is no object to read', () => {
    expect(jsonObject('no braces here')).toBeNull()
    expect(jsonObject('{not json}')).toBeNull()
  })
})

describe('parseExtraction', () => {
  it('reads points and entities, trimmed, deduplicated only by the reducer later', () => {
    const parsed = parseExtraction('{"points": ["  Rent is due monthly. ", "Late fee is 5%."], "entities": ["Lessor"]}')

    expect(parsed).toEqual({ points: ['Rent is due monthly.', 'Late fee is 5%.'], entities: ['Lessor'] })
  })

  it('caps the number of points and drops blank entries', () => {
    const points = Array.from({ length: 9 }, (_, i) => `Point ${i}.`)
    const parsed = parseExtraction(JSON.stringify({ points, entities: ['', '   ', 'Tenant'] }))

    expect(parsed?.points).toHaveLength(6)
    expect(parsed?.entities).toEqual(['Tenant'])
  })

  it('treats missing lists as empty and a reply with no object as unreadable', () => {
    expect(parseExtraction('{}')).toEqual({ points: [], entities: [] })
    expect(parseExtraction('I cannot help with that.')).toBeNull()
  })
})

describe('parseOmitted', () => {
  it('keeps only known chunk ids, accepts digit strings, and sorts them', () => {
    expect(parseOmitted('{"omitted": [3, "1", 9, "x", 2.5]}', IDS)).toEqual([1, 3])
  })

  it('returns an empty list when the review lists nothing, and null when unreadable', () => {
    expect(parseOmitted('{"omitted": []}', IDS)).toEqual([])
    expect(parseOmitted('the summary looks fine', IDS)).toBeNull()
  })
})

describe('parseSummary', () => {
  it('reads sections with cited chunks, keeping only known chunk ids', () => {
    const summary = parseSummary(
      JSON.stringify({
        overview: 'A lease.',
        sections: [{ heading: 'Money', points: [{ text: 'Rent is monthly.', chunks: [1, 7] }] }],
      }),
      IDS,
    )

    expect(summary).toEqual({
      overview: 'A lease.',
      sections: [{ heading: 'Money', points: [{ text: 'Rent is monthly.', chunks: [1] }] }],
    })
  })

  it('drops empty points and sections left with no points', () => {
    const summary = parseSummary(
      JSON.stringify({
        overview: 'A lease.',
        sections: [
          { heading: 'Empty', points: [{ text: '  ', chunks: [1] }] },
          { heading: 'Kept', points: [{ text: 'Term is one year.', chunks: [2] }, { chunks: [3] }] },
        ],
      }),
      IDS,
    )

    expect(summary?.sections.map((s) => s.heading)).toEqual(['Kept'])
    expect(summary?.sections[0]?.points).toHaveLength(1)
  })

  it('returns null when no usable section remains', () => {
    expect(parseSummary('{"overview": "x", "sections": []}', IDS)).toBeNull()
    expect(parseSummary('not json at all', IDS)).toBeNull()
  })
})
