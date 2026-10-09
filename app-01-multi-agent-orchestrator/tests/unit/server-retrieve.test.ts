import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SNIPPET_CHARS,
  capText,
  hnSearchUrl,
  numberSources,
  parseHn,
  parseWikipedia,
  retrieveSources,
  searchTerms,
  sourcesPromptBlock,
  wikipediaArticleUrl,
  wikipediaSearchUrl,
} from '../../netlify/shared/retrieve'
import type { Source } from '../../src/types'

// Fixtures follow the shape of the real replies (formatversion 2 for Wikipedia, Algolia for HN).
// Wikipedia returns pages out of rank order, so `index` decides the order.
const WIKIPEDIA_REPLY = {
  batchcomplete: true,
  query: {
    pages: [
      { pageid: 40203, ns: 0, title: 'Hubble Space Telescope', index: 2, extract: 'The Hubble Space Telescope launched in 1990.' },
      { pageid: 434221, ns: 0, title: 'James Webb Space Telescope', index: 1, extract: 'The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy.' },
      { pageid: 1, ns: 0, title: 'Stub with no intro', index: 3, extract: '' },
      { pageid: 2, ns: 0, index: 4, extract: 'No title here.' },
    ],
  },
}

function hnHit(overrides: Record<string, unknown> = {}) {
  return {
    objectID: '34360010',
    title: 'The James Webb Space Telescope is finding too many early galaxies',
    url: 'https://skyandtelescope.org/astronomy-news/webb/',
    points: 764,
    num_comments: 526,
    created_at: '2023-01-12T20:45:57Z',
    _highlightResult: { title: { matchedWords: ['james', 'webb', 'space', 'telescope'] } },
    ...overrides,
  }
}

describe('searchTerms', () => {
  it('drops question words and filler and keeps the topic words in order', () => {
    expect(searchTerms('What is the history and current status of the James Webb Space Telescope?')).toBe(
      'history status James Webb Space Telescope',
    )
    expect(searchTerms('How is AI changing software engineering jobs?')).toBe('AI changing software engineering jobs')
  })

  it('keeps symbols that belong to a name and removes repeated words', () => {
    expect(searchTerms('Why use C++ and C#, c++ again?')).toBe('use C++ C# again')
  })

  it('caps the terms at eight and falls back to the question when nothing is left', () => {
    expect(searchTerms('one two three four five six seven eight nine ten').split(' ')).toHaveLength(8)
    expect(searchTerms('what is it?')).toBe('what is it?')
  })
})

describe('request URLs', () => {
  it('asks Wikipedia for the top three article intros as plain text, capped by characters', () => {
    const url = new URL(wikipediaSearchUrl('James Webb'))
    expect(url.origin + url.pathname).toBe('https://en.wikipedia.org/w/api.php')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      action: 'query',
      generator: 'search',
      gsrsearch: 'James Webb',
      gsrlimit: '3',
      gsrnamespace: '0',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      exchars: String(MAX_SNIPPET_CHARS),
    })
  })

  it('asks Hacker News for stories with more than 20 points', () => {
    const url = new URL(hnSearchUrl('Rust systems'))
    expect(url.origin + url.pathname).toBe('https://hn.algolia.com/api/v1/search')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      query: 'Rust systems',
      tags: 'story',
      numericFilters: 'points>20',
      removeWordsIfNoResults: 'allOptional',
    })
  })

  it('escapes the query text and builds article links that survive markdown', () => {
    expect(new URL(wikipediaSearchUrl('a&b=c')).searchParams.get('gsrsearch')).toBe('a&b=c')
    expect(wikipediaArticleUrl('Python (programming language)')).toBe('https://en.wikipedia.org/wiki/Python_%28programming_language%29')
  })
})

describe('capText', () => {
  it('collapses whitespace, strips control characters and cuts at a word with an ellipsis', () => {
    expect(capText('a\u0000b\n\n  c', 50)).toBe('a b c')
    const cut = capText('alpha beta gamma delta epsilon', 18)
    expect(cut).toBe('alpha beta gamma…')
    expect(capText('x'.repeat(40), 10)).toBe(`${'x'.repeat(10)}…`)
  })
})

describe('parseWikipedia', () => {
  it('returns articles in rank order and drops pages without a title or intro text', () => {
    const parsed = parseWikipedia(WIKIPEDIA_REPLY)
    expect(parsed.map(source => source.title)).toEqual(['James Webb Space Telescope', 'Hubble Space Telescope'])
    expect(parsed[0]).toEqual({
      title: 'James Webb Space Telescope',
      site: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/James_Webb_Space_Telescope',
      snippet: 'The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy.',
    })
  })

  it('caps the snippet and ignores the upstream link', () => {
    const long = 'word '.repeat(300)
    const [source] = parseWikipedia({ query: { pages: [{ title: 'X', index: 1, extract: long, fullurl: 'https://evil.example/' }] } })
    expect(source?.snippet.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS + 1)
    expect(source?.url).toBe('https://en.wikipedia.org/wiki/X')
  })

  it('returns nothing for an empty, odd or hostile body', () => {
    expect(parseWikipedia({ batchcomplete: true })).toEqual([])
    expect(parseWikipedia({ query: { pages: 'nope' } })).toEqual([])
    expect(parseWikipedia(null)).toEqual([])
    expect(parseWikipedia('<html>')).toEqual([])
  })
})

describe('parseHn', () => {
  it('turns a hit into the discussion link with points, comments and the month', () => {
    const [source] = parseHn({ hits: [hnHit()] }, 'James Webb Space Telescope')
    expect(source).toEqual({
      title: 'The James Webb Space Telescope is finding too many early galaxies',
      site: 'Hacker News',
      url: 'https://news.ycombinator.com/item?id=34360010',
      note: '764 points, 526 comments, Jan 2023',
      snippet:
        'Hacker News story "The James Webb Space Telescope is finding too many early galaxies", linking to skyandtelescope.org. 764 points, 526 comments, Jan 2023.',
    })
  })

  it('drops hits with a bad id, low points or too few matching title words, and keeps at most two', () => {
    const body = {
      hits: [
        hnHit({ objectID: '12; DROP' }),
        hnHit({ objectID: '2', points: 5 }),
        hnHit({ objectID: '3', _highlightResult: { title: { matchedWords: ['space'] } } }),
        hnHit({ objectID: '4' }),
        hnHit({ objectID: '5', url: 'javascript:alert(1)' }),
        hnHit({ objectID: '6' }),
      ],
    }
    const parsed = parseHn(body, 'James Webb')
    expect(parseHn({ hits: [hnHit({ _highlightResult: { title: { matchedWords: ['telescope', 'discovered'] } } })] }, 'James Webb Space Telescope discovered')).toEqual([])
    expect(parsed.map(source => source.url)).toEqual([
      'https://news.ycombinator.com/item?id=4',
      'https://news.ycombinator.com/item?id=5',
    ])
    expect(parsed[1]?.snippet).not.toContain('javascript')
  })

  it('returns nothing for an empty or odd body', () => {
    expect(parseHn({ hits: [] }, 'x')).toEqual([])
    expect(parseHn({}, 'x')).toEqual([])
    expect(parseHn([], 'x')).toEqual([])
  })
})

describe('numbering and the prompt block', () => {
  const sources = numberSources(
    [{ title: 'A', site: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/A', snippet: 'About A.' }],
    [{ title: 'B', site: 'Hacker News', url: 'https://news.ycombinator.com/item?id=1', snippet: 'About B.', note: '30 points' }],
  )

  it('numbers sources from 1 in order, Wikipedia first', () => {
    expect(sources.map(source => [source.n, source.title])).toEqual([[1, 'A'], [2, 'B']])
  })

  it('writes one block per source with its number, site, title and capped text', () => {
    expect(sourcesPromptBlock(sources)).toBe('[1] Wikipedia: A\nAbout A.\n\n[2] Hacker News: B\nAbout B.')
  })

  it('stops at a source boundary when the block would pass the cap', () => {
    const big: Source[] = Array.from({ length: 10 }, (_, i) => ({
      n: i + 1,
      title: `T${i + 1}`,
      site: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/T',
      snippet: 'w '.repeat(400),
    }))
    const block = sourcesPromptBlock(big)
    expect(block.length).toBeLessThanOrEqual(3_200)
    expect(block.startsWith('[1] Wikipedia: T1')).toBe(true)
    expect(block).not.toContain('[10]')
    expect(block.split('\n\n').every(part => /^\[\d+\] Wikipedia: T\d+\n/.test(part))).toBe(true)
  })
})

describe('retrieveSources', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const signal = () => new AbortController().signal

  function fetchBy(wiki: () => Response | Promise<Response>, hn: () => Response | Promise<Response>) {
    return vi.fn<typeof fetch>(async input => (String(input).startsWith('https://en.wikipedia.org/') ? wiki() : hn()))
  }

  it('looks up both sites in parallel and numbers what comes back', async () => {
    const fetchImpl = fetchBy(() => json(WIKIPEDIA_REPLY), () => json({ hits: [hnHit()] }))
    const result = await retrieveSources('What has the James Webb Space Telescope discovered?', { signal: signal(), fetchImpl })

    expect(result.sources.map(source => [source.n, source.site, source.title])).toEqual([
      [1, 'Wikipedia', 'James Webb Space Telescope'],
      [2, 'Wikipedia', 'Hubble Space Telescope'],
      [3, 'Hacker News', 'The James Webb Space Telescope is finding too many early galaxies'],
    ])
    expect(result.detail).toBe('Found 2 Wikipedia articles and 1 Hacker News thread.')
    expect(result.reached).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const sentUrls = fetchImpl.mock.calls.map(call => String(call[0]))
    expect(new URL(sentUrls[0] ?? '').searchParams.get('gsrsearch')).toBe('James Webb Space Telescope discovered')
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ 'User-Agent': expect.stringContaining('AgentFlow') })
  })

  it('keeps the other site when one fails, and says which one failed', async () => {
    const fetchImpl = fetchBy(() => json({}, 503), () => json({ hits: [hnHit()] }))
    const result = await retrieveSources('James Webb Space Telescope', { signal: signal(), fetchImpl })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.n).toBe(1)
    expect(result.detail).toBe('Found 1 Hacker News thread. Wikipedia answered HTTP 503.')
    expect(result.reached).toBe(true)
  })

  it('tries a dropped connection once more and then uses the answer', async () => {
    let wikiCalls = 0
    const fetchImpl = fetchBy(
      () => {
        wikiCalls += 1
        if (wikiCalls === 1) throw new TypeError('fetch failed')
        return json(WIKIPEDIA_REPLY)
      },
      () => json({ hits: [] }),
    )
    const result = await retrieveSources('James Webb', { signal: signal(), fetchImpl })
    expect(wikiCalls).toBe(2)
    expect(result.detail).toBe('Found 2 Wikipedia articles.')
  })

  it('does not retry an HTTP error status', async () => {
    let wikiCalls = 0
    const fetchImpl = fetchBy(
      () => {
        wikiCalls += 1
        return json({}, 500)
      },
      () => json({ hits: [] }),
    )
    await retrieveSources('James Webb', { signal: signal(), fetchImpl })
    expect(wikiCalls).toBe(1)
  })

  it('reports no sources, with the reasons, when both lookups fail', async () => {
    const fetchImpl = fetchBy(
      () => {
        throw new TypeError('fetch failed')
      },
      () => new Response('<html>', { status: 200 }),
    )
    const result = await retrieveSources('anything', { signal: signal(), fetchImpl })
    expect(result.sources).toEqual([])
    expect(result.detail).toBe('No sources retrieved: Wikipedia could not be reached; Hacker News sent a reply that is not JSON.')
    expect(result.reached).toBe(false)
  })

  it('says so plainly when the sites answer but have nothing', async () => {
    const fetchImpl = fetchBy(() => json({ batchcomplete: true }), () => json({ hits: [] }))
    const result = await retrieveSources('zxqv', { signal: signal(), fetchImpl })
    expect(result.sources).toEqual([])
    expect(result.detail).toBe('No sources found for this question on Wikipedia or Hacker News.')
    expect(result.reached).toBe(true)
  })

  it('gives up on a lookup that does not answer within the timeout', async () => {
    const stalled = (init: RequestInit | undefined) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')))
      })
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => stalled(init))
    const started = Date.now()
    const result = await retrieveSources('anything', { signal: signal(), timeoutMs: 30, fetchImpl })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(result.sources).toEqual([])
    expect(result.detail).toBe('No sources retrieved: Wikipedia did not answer in time; Hacker News did not answer in time.')
  })

  it('refuses a reply larger than the byte cap', async () => {
    const huge = new Response('x'.repeat(250_000), { status: 200 })
    const fetchImpl = fetchBy(() => huge, () => json({ hits: [] }))
    const result = await retrieveSources('anything', { signal: signal(), fetchImpl })
    expect(result.detail).toBe('No sources retrieved: Wikipedia sent too much data.')
    expect(result.reached).toBe(true)
  })
})
