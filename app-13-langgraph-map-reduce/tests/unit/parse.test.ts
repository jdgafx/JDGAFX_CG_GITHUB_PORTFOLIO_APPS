import { describe, expect, it } from 'vitest'
import { jsonObject, parseExtraction, parseImportant, parseStated, parseSummary } from '../../netlify/shared/parse'

const IDS = ['1.1', '1.2', '2.1', '3.1']
const CHUNKS = [1, 2, 3]

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

describe('parseImportant', () => {
  it('keeps only the ids it was given, accepts a number by its text, and drops anything else', () => {
    expect(parseImportant('{"important": ["3.1", "1.1", " 2.1 ", "9.9", 1.2, "x", null]}', IDS)).toEqual(['3.1', '1.1', '2.1', '1.2'])
  })

  it('returns an empty list when the review names nothing, and null when unreadable', () => {
    expect(parseImportant('{"important": []}', IDS)).toEqual([])
    expect(parseImportant('the summary looks fine', IDS)).toBeNull()
  })
})

describe('parseStated', () => {
  const IDS_OF_CHUNK = ['2.1', '2.2', '2.3']

  it('maps each sentence number to the ids of the chunk it states, and drops forged ids, other chunks and unknown sentences', () => {
    const reply = JSON.stringify({
      states: [
        { sentence: 1, points: ['2.1', '9.9', '1.1'] },
        { sentence: '3', points: [2.2, ' 2.3 '] },
        { sentence: 7, points: ['2.1'] },
        { sentence: 0, points: ['2.1'] },
        { sentence: 2, points: [] },
        'not an entry',
      ],
    })

    expect(parseStated(reply, 4, IDS_OF_CHUNK)).toEqual(
      new Map([
        [1, ['2.1']],
        [3, ['2.2', '2.3']],
      ]),
    )
  })

  it('joins repeated sentence entries, and reads an empty or missing list as nothing stated', () => {
    expect(parseStated('{"states": [{"sentence": 1, "points": ["2.1"]}, {"sentence": 1, "points": ["2.1", "2.2"]}]}', 2, IDS_OF_CHUNK)).toEqual(new Map([[1, ['2.1', '2.2']]]))
    expect(parseStated('{"states": []}', 2, IDS_OF_CHUNK)).toEqual(new Map())
    expect(parseStated('{}', 2, IDS_OF_CHUNK)).toEqual(new Map())
  })

  it('returns null when the reply holds no JSON object', () => {
    expect(parseStated('I could not tell.', 2, IDS_OF_CHUNK)).toBeNull()
  })
})

describe('parseSummary', () => {
  it('reads sections with cited chunks, keeping only known chunk numbers, and leaves the key points to the check', () => {
    const summary = parseSummary(
      JSON.stringify({
        overview: 'A lease.',
        sections: [{ heading: 'Money', points: [{ text: 'Rent is monthly.', chunks: [1, 7, '3', 1], points: ['1.1'] }] }],
      }),
      CHUNKS,
    )

    expect(summary).toEqual({
      overview: 'A lease.',
      sections: [{ heading: 'Money', points: [{ text: 'Rent is monthly.', points: [], chunks: [1, 3] }] }],
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
      CHUNKS,
    )

    expect(summary?.sections.map((s) => s.heading)).toEqual(['Kept'])
    expect(summary?.sections[0]?.points).toHaveLength(1)
  })

  it('returns null when no usable section remains', () => {
    expect(parseSummary('{"overview": "x", "sections": []}', CHUNKS)).toBeNull()
    expect(parseSummary('not json at all', CHUNKS)).toBeNull()
  })
})
