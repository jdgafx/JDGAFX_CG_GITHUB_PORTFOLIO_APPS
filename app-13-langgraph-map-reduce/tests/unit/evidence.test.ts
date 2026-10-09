import { describe, expect, it } from 'vitest'
import { splitDisplay, splitText } from '../../netlify/shared/chunk'
import {
  buildCells,
  chunkTexts,
  citationsByChunk,
  contentWords,
  heatLevel,
  isHeading,
  pickSentences,
  pointRefs,
  retriedChunks,
  segmentsFor,
  sentencesOf,
} from '../../src/lib/evidence'
import type { Summary } from '../../src/types/frames'

const SUMMARY: Summary = {
  overview: 'o',
  sections: [
    {
      heading: 'Launch',
      points: [
        { text: 'The Saturn V rocket lifted off from Florida.', chunks: [1, 2] },
        { text: 'Armstrong walked on the Moon first.', chunks: [2] },
      ],
    },
    { heading: 'Return', points: [{ text: 'The crew splashed down in the Pacific.', chunks: [2, 4, 9] }] },
  ],
}

describe('points and citations', () => {
  it('keys each point by section and index, in reading order', () => {
    expect(pointRefs(SUMMARY).map((r) => r.key)).toEqual(['0.0', '0.1', '1.0'])
  })

  it('lists, per chunk, the points that cite it, ignoring ids the document does not have', () => {
    const by = citationsByChunk(pointRefs(SUMMARY), [1, 2, 3, 4])
    expect([...by].map(([id, list]) => [id, list.map((r) => r.key)])).toEqual([
      [1, ['0.0']],
      [2, ['0.0', '0.1', '1.0']],
      [3, []],
      [4, ['1.0']],
    ])
    expect(by.has(9)).toBe(false)
  })

  it('shades by share of the most-cited chunk, with zero kept apart', () => {
    expect([0, 1, 2, 3, 4].map((n) => heatLevel(n, 4))).toEqual([0, 1, 2, 3, 4])
    expect(heatLevel(1, 3)).toBe(2)
    expect(heatLevel(3, 3)).toBe(4)
    expect(heatLevel(1, 0)).toBe(0)
  })

  it('builds one cell per chunk with its count, level, kind and retry mark', () => {
    const cells = buildCells([1, 2, 3, 4], SUMMARY, { covered: [1, 2, 4], missing: [3], noPoints: [3] }, new Set([2]))
    expect(cells.map((c) => [c.id, c.count, c.level, c.kind, c.retried])).toEqual([
      [1, 1, 2, 'covered', false],
      [2, 3, 4, 'covered', true],
      [3, 0, 0, 'no-points', false],
      [4, 1, 2, 'covered', false],
    ])
  })

  it('tells a chunk with key points that nothing cites from one that gave none', () => {
    const cells = buildCells([1, 2], SUMMARY, { covered: [1], missing: [2], noPoints: [] }, new Set())
    expect(cells[1]).toMatchObject({ id: 2, kind: 'uncited' })
  })

  it('reads retried chunks from the branches with more than one attempt', () => {
    expect([...retriedChunks([{ chunk: 1, attempts: 1 }, { chunk: 2, attempts: 2 }])]).toEqual([2])
  })
})

describe('sentence choice', () => {
  const chunk =
    'The mission began in 1969. The Saturn V rocket lifted off from Florida at dawn. Crowds watched the launch. Fuel tanks emptied quickly.'

  it('splits a chunk into sentences that rejoin to the exact chunk', () => {
    expect(sentencesOf(chunk)).toHaveLength(4)
    expect(segmentsFor(chunk, [1]).map((s) => s.text).join('')).toBe(chunk)
  })

  it('drops stop words and short words, and folds a plural s', () => {
    expect([...contentWords('The rockets of the Moon are in it')].sort()).toEqual(['moon', 'rocket'])
  })

  it('folds -ing and -ed so a point about a splashdown finds "splashing down"', () => {
    expect(contentWords('splashed splashing landed landing')).toEqual(new Set(['splash', 'land']))
    const text = 'They walked for hours. The crew returned safely, splashing down in the Pacific.'
    expect(pickSentences('The crew splashed down safely in the Pacific.', text)).toEqual([1])
  })

  it('picks the sentence sharing the most content words with the point', () => {
    expect(pickSentences('The Saturn V rocket lifted off from Florida.', chunk)).toEqual([1])
  })

  it('picks a second sentence only when it scores at least half the best, and returns reading order', () => {
    const text = 'Rocket fuel burns fast. Nothing else here. The rocket fuel tanks emptied.'
    expect(pickSentences('rocket fuel tanks emptied quickly', text)).toEqual([0, 2])
    expect(pickSentences('rocket fuel tanks emptied quickly', text, 1)).toEqual([2])
  })

  it('breaks a tie toward the earlier sentence', () => {
    expect(pickSentences('moon landing', 'The moon was bright. The landing was soft. Done here.', 1)).toEqual([0])
  })

  it('picks nothing when no sentence shares a word with the point', () => {
    expect(pickSentences('Tax policy reform', chunk)).toEqual([])
    expect(segmentsFor(chunk, []).map((s) => s.hit)).toEqual([false])
  })

  it('marks the picked sentences and merges neighbours into one run', () => {
    const segments = segmentsFor(chunk, [1, 2])
    expect(segments.map((s) => s.hit)).toEqual([false, true, false])
    expect(segments[1]?.text).toBe('The Saturn V rocket lifted off from Florida at dawn. Crowds watched the launch. ')
  })
})

describe('sentences and headings', () => {
  it('ends a sentence after a closing quote or bracket, so a quoted line is not glued to the next', () => {
    const text = 'He said "We choose to go to the Moon." The crowd cheered (loudly.) Then it rained.'
    expect(sentencesOf(text)).toEqual(['He said "We choose to go to the Moon."', 'The crowd cheered (loudly.)', 'Then it rained.'])
    expect(segmentsFor(text, [0]).map((x) => x.text).join('')).toBe(text)
  })

  it('treats a line break as a sentence end and keeps it when the pieces are rejoined', () => {
    const text = 'History\nThe history of the reef is long. It began early.'
    expect(sentencesOf(text)).toEqual(['History', 'The history of the reef is long.', 'It began early.'])
    expect(segmentsFor(text, [0]).map((x) => x.text).join('')).toBe(text)
  })
})

describe('headings are not supporting sentences', () => {
  const text = 'Geology and geography\nThe reef sits on a continental shelf. Geology shaped it over millions of years.'

  it('recognises a short line with no closing punctuation, and nothing longer or punctuated', () => {
    expect(isHeading('Geology and geography')).toBe(true)
    expect(isHeading('Geology shaped it over millions of years.')).toBe(false)
    expect(isHeading('He said "stop."')).toBe(false)
    expect(isHeading('A line that runs on for much longer than any heading would, with no stop at the end of it at all')).toBe(false)
  })

  it('never marks a heading, even when it shares the most words with the point', () => {
    expect(pickSentences('geology and geography', text)).toEqual([2])
    expect(pickSentences('geology and geography', 'Geology and geography\nNothing else here.')).toEqual([])
  })
})

describe('chunk boundaries match the server', () => {
  const article = ['Intro text about the reef. It is large.', 'History', ...Array.from({ length: 6 }, (_, n) => Array.from({ length: 80 }, (_, i) => `w${n}x${i}`).join(' ') + '.'), 'Geology', 'Rocks are old. They formed slowly.'].join('\n\n')

  it('splitDisplay cuts exactly where splitText cuts and only adds line breaks where the source had them', () => {
    const plain = splitText(article)
    const shown = splitDisplay(article)
    expect(shown.map((c) => c.id)).toEqual(plain.map((c) => c.id))
    expect(shown.map((c) => c.text.replace(/\n/g, ' '))).toEqual(plain.map((c) => c.text))
    expect(shown.some((c) => c.text.includes('\nHistory\n'))).toBe(true)
    expect(shown[shown.length - 1]?.text).toContain('\nGeology\nRocks are old.')
  })
})

describe('chunk boundaries match the server (plain)', () => {
  const paragraphs = Array.from({ length: 7 }, (_, n) => Array.from({ length: 90 }, (_, i) => `word${n}x${i}`).join(' ') + '.')
  const doc = `Intro line.\r\n${paragraphs.join('\n')}\n\n\nEnd -- of text! Done?`

  it('the page splits the text with the same function the split node uses, so ids and texts agree', () => {
    const chunks = splitText(doc)
    const texts = chunkTexts(chunks, chunks.length)
    expect(texts?.size).toBe(chunks.length)
    expect([...(texts?.keys() ?? [])]).toEqual(chunks.map((c) => c.id))
    expect(chunks.map((c) => c.text).join(' ')).toContain('word3x45')
  })

  it('refuses the texts when the count differs from the server, instead of showing the wrong chunk', () => {
    expect(chunkTexts(splitText(doc), 99)).toBeNull()
  })
})
