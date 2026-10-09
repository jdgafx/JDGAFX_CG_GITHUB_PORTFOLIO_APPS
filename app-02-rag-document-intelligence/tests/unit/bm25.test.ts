import { describe, expect, it } from 'vitest'
import { buildIndex, highlightSegments, idf, queryTerms, rank, retrieve, stem } from '../../src/lib/bm25'

describe('stem', () => {
  it('brings plurals, -ed, -ing and a trailing -e to one form', () => {
    expect(['rank', 'ranks', 'ranked', 'ranking'].map(stem)).toEqual(['rank', 'rank', 'rank', 'rank'])
    expect(['make', 'making', 'makes'].map(stem)).toEqual(['mak', 'mak', 'mak'])
    expect(['run', 'running'].map(stem)).toEqual(['run', 'run'])
    expect(['cranes', 'crane'].map(stem)).toEqual(['cran', 'cran'])
    expect(stem('studies')).toBe('study')
    expect(stem('classes')).toBe('class')
  })

  it('leaves short words and -ss, -us, -is endings alone', () => {
    expect(['was', 'gas', 'class', 'status', 'analysis', 'red'].map(stem)).toEqual(['was', 'gas', 'class', 'status', 'analysis', 'red'])
  })
})

describe('queryTerms', () => {
  it('keeps distinct content words as stems with the word the person wrote', () => {
    expect(queryTerms('What revenue did Gadget Y earn? Revenue in 2024!')).toEqual([
      { stem: 'revenu', word: 'revenue' },
      { stem: 'gadget', word: 'gadget' },
      { stem: 'earn', word: 'earn' },
      { stem: '2024', word: '2024' },
    ])
  })

  it('leaves out question verbs and why/who words that every passage could contain', () => {
    expect(queryTerms('Where does the Calvin cycle take place? Why?').map(t => t.word)).toEqual(['calvin', 'cycle'])
  })

  it('falls back to every word when the question is only stop words', () => {
    expect(queryTerms('What is this about?').map(t => t.word)).toEqual(['what', 'is', 'this', 'about'])
  })
})

// Four passages. N = 4, content words per passage 5, 4, 5, 5 so the average length is 4.75.
// "harbor" and "cranes" (stem "cran") each appear in two passages, so idf = ln(1 + 2.5 / 2.5) = ln 2.
const FIXTURE = [
  'Harbor cranes lift containers at the harbor.',
  'The station opened in 1987 in Lisbon.',
  'Cranes and ships. Harbor traffic grew.',
  'Lisbon trams run past the station.',
]

describe('BM25 scores', () => {
  it('computes the idf as ln(1 + (N - n + 0.5) / (n + 0.5))', () => {
    expect(idf(4, 2)).toBeCloseTo(Math.LN2, 12)
    expect(idf(4, 0)).toBeCloseTo(Math.log(1 + 4.5 / 0.5), 12)
  })

  it('builds the index figures', () => {
    const index = buildIndex(FIXTURE)
    expect(index.lengths).toEqual([5, 4, 5, 5])
    expect(index.avgLength).toBe(4.75)
    expect(index.df.get('harbor')).toBe(2)
    expect(index.df.get('cran')).toBe(2)
    expect(index.counts[0]?.get('harbor')).toBe(2)
  })

  it('scores the fixture to the value worked out by hand (k1 1.2, b 0.75)', () => {
    // Passage 0: harbor f=2 and cran f=1, length 5. Passage 2: both f=1, length 5.
    // Each term adds ln2 * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * 5 / 4.75)).
    const ranked = rank(buildIndex(FIXTURE), queryTerms('harbor cranes'))
    expect(ranked.map(r => r.index)).toEqual([0, 2])
    expect(ranked[0]?.score).toBeCloseTo(1.6177126311431307, 9)
    expect(ranked[1]?.score).toBeCloseTo(1.3570750420330544, 9)
    expect(ranked[0]?.matched).toEqual(['harbor', 'cranes'])
  })

  it('leaves out passages that share no term, and breaks ties by document order', () => {
    const index = buildIndex(['alpha beta', 'beta alpha', 'gamma delta'])
    expect(rank(index, queryTerms('alpha')).map(r => r.index)).toEqual([0, 1])
    expect(rank(index, queryTerms('zebra'))).toEqual([])
  })

  it('ranks a rare term above a common one', () => {
    const chunks = ['common common common', 'common rare', 'common words here', 'more common words']
    const ranked = rank(buildIndex(chunks), queryTerms('rare common'))
    expect(ranked[0]?.index).toBe(1)
  })
})

describe('retrieve', () => {
  it('returns the top passages best first, and counts every passage that matched', () => {
    const result = retrieve('harbor cranes', FIXTURE, 1)
    expect(result.ranked.map(r => r.index)).toEqual([0])
    expect(result.matching).toBe(2)
    expect(result.total).toBe(4)
  })

  it('returns at most 20 passages by default, the limit the server accepts', () => {
    const many = Array.from({ length: 25 }, (_, i) => `Gadget note ${i}`)
    const result = retrieve('gadget', many)
    expect(result.ranked).toHaveLength(20)
    expect(result.matching).toBe(25)
  })

  it('finds nothing when no passage shares a word', () => {
    expect(retrieve('zebra', FIXTURE).ranked).toEqual([])
  })
})

describe('highlightSegments', () => {
  it('marks the words whose stem is a question term, including other forms of the word', () => {
    const segments = highlightSegments('Harbor cranes lift the harbors.', queryTerms('harbor crane'))
    expect(segments).toEqual([
      { text: 'Harbor', hit: true },
      { text: ' ', hit: false },
      { text: 'cranes', hit: true },
      { text: ' lift the ', hit: false },
      { text: 'harbors', hit: true },
      { text: '.', hit: false },
    ])
    expect(segments.map(s => s.text).join('')).toBe('Harbor cranes lift the harbors.')
  })

  it('returns one plain run when nothing matches', () => {
    expect(highlightSegments('Nothing here.', queryTerms('zebra'))).toEqual([{ text: 'Nothing here.', hit: false }])
  })
})
