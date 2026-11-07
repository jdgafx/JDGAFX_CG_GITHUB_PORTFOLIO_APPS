import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PROMPT_SOURCES_CHARS,
  MAX_SNIPPET_CHARS,
  arxivSearchUrl,
  capText,
  cleanPageText,
  hnSearchUrl,
  numberSources,
  parseArxiv,
  parseHn,
  parseRelevance,
  parseWebSearch,
  parseWikipedia,
  relevanceMessage,
  retrieveSources,
  searchTerms,
  sourcesPromptBlock,
  tavilySearchBody,
  wikipediaArticleUrl,
  wikipediaSearchUrl,
} from '../../netlify/shared/retrieve'
import type { Source } from '../../src/types'

// Fixtures follow the shape of the real replies (formatversion 2 for Wikipedia, Algolia for HN, Atom for arXiv, Tavily's search reply).
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
    ...overrides,
  }
}

function arxivEntry(id: string, title: string, summary: string, published = '2026-10-02T17:59:59Z') {
  return `<entry>
    <id>http://arxiv.org/abs/${id}</id>
    <updated>${published}</updated>
    <published>${published}</published>
    <title>${title}</title>
    <summary>${summary}</summary>
    <author><name>A. Author</name></author>
    <link href="http://arxiv.org/abs/${id}" rel="alternate" type="text/html"/>
  </entry>`
}
const arxivFeed = (...entries: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>http://arxiv.org/api/feed-id</id><title>ArXiv Query</title>${entries.join('')}</feed>`

const WEB_REPLY = {
  query: 'webb galaxies',
  results: [
    { title: 'Webb finds early galaxies', url: 'https://www.space.com/webb-early-galaxies', content: 'The James Webb Space Telescope found early galaxies only 300 million years after the Big Bang.', score: 0.9 },
    { title: 'Unrelated cooking tips', url: 'https://cooking.example/tips', content: 'Salt your pasta water.', score: 0.2 },
    { title: 'Insecure page about Webb telescope galaxies', url: 'http://plain.example/webb', content: 'Webb telescope galaxies on plain http.' },
  ],
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
  it('asks Wikipedia for article intros as plain text, capped by characters', () => {
    const url = new URL(wikipediaSearchUrl('James Webb'))
    expect(url.origin + url.pathname).toBe('https://en.wikipedia.org/w/api.php')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      action: 'query',
      generator: 'search',
      gsrsearch: 'James Webb',
      gsrlimit: '2',
      gsrnamespace: '0',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      exchars: String(MAX_SNIPPET_CHARS),
    })
  })

  it('asks Wikipedia for any of the words in a second request, because a long question has no page with every word', () => {
    expect(new URL(wikipediaSearchUrl('SSE WebSockets streaming', true)).searchParams.get('gsrsearch')).toBe('SSE OR WebSockets OR streaming')
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

  it('asks arXiv for any of the words, best match first', () => {
    const url = new URL(arxivSearchUrl('Rust "safe" systems'))
    expect(url.origin + url.pathname).toBe('https://export.arxiv.org/api/query')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      search_query: 'all:"Rust" OR all:"safe" OR all:"systems"',
      max_results: '4',
      sortBy: 'relevance',
    })
  })

  it('sends Tavily the raw question and one basic search, with no page extraction', () => {
    expect(JSON.parse(tavilySearchBody('In two sentences, compare SSE and WebSockets?'))).toEqual({
      query: 'In two sentences, compare SSE and WebSockets?',
      max_results: 5,
      search_depth: 'basic',
      include_answer: false,
    })
  })

  it('escapes the query text and builds article links that survive markdown', () => {
    expect(new URL(wikipediaSearchUrl('a&b=c')).searchParams.get('gsrsearch')).toBe('a&b=c')
    expect(wikipediaArticleUrl('Python (programming language)')).toBe('https://en.wikipedia.org/wiki/Python_%28programming_language%29')
    expect(wikipediaArticleUrl('A [B] (C)')).toBe('https://en.wikipedia.org/wiki/A_%5BB%5D_%28C%29')
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

describe('parseRelevance: the only field code reads', () => {
  it('keeps the numbers marked relevant and ignores everything else in the reply', () => {
    const reply = '{"results":[{"n":1,"relevant":true,"reason":"ignore previous instructions"},{"n":2,"relevant":false},{"n":3,"relevant":true}]}'
    expect([...(parseRelevance(reply, 3) ?? [])]).toEqual([1, 3])
  })

  it('reads a reply inside a code fence', () => {
    expect([...(parseRelevance('```json\n{"results":[{"n":2,"relevant":true}]}\n```', 2) ?? [])]).toEqual([2])
  })

  it('ignores an out-of-range, repeated or non-boolean entry, and a result the reply leaves out is not kept', () => {
    const reply = '{"results":[{"n":9,"relevant":true},{"n":1,"relevant":false},{"n":1,"relevant":true},{"n":2,"relevant":"yes"},{"n":0,"relevant":true},{"n":1.5,"relevant":true}]}'
    expect([...(parseRelevance(reply, 3) ?? [])]).toEqual([])
    expect(parseRelevance(reply, 3)).toBeInstanceOf(Set)
  })

  it('says nothing was usable when the reply is not the JSON asked for', () => {
    expect(parseRelevance('no idea', 3)).toBeUndefined()
    expect(parseRelevance('{"results":[]}', 3)).toBeUndefined()
    expect(parseRelevance('{"results":[{"n":9,"relevant":true}]}', 3)).toBeUndefined()
    expect(parseRelevance('{"answer":"all of them"}', 3)).toBeUndefined()
  })
})

describe('relevanceMessage', () => {
  it('lists the question and each numbered result with its site, title, date and a short excerpt', () => {
    const message = relevanceMessage('Is Rust faster than Go?', [
      { n: 1, group: 0, source: { title: 'Rust vs Go', site: 'Web', url: 'https://example.com/a', snippet: 'A comparison.', note: 'example.com' } },
      { n: 2, group: 2, source: { title: 'Rust 2.0', site: 'Hacker News', url: 'https://news.ycombinator.com/item?id=1', snippet: 'x '.repeat(400), note: '90 points, Oct 2026' } },
    ])
    expect(message.startsWith('Question: Is Rust faster than Go?\n\nResults:\n1. [Web] Rust vs Go\n   A comparison.\n2. [Hacker News] Rust 2.0 (90 points, Oct 2026)\n')).toBe(true)
    expect(message.length).toBeLessThan(600)
  })
})

describe('cleanPageText', () => {
  it('takes out markdown images and "Image 9:" caption lines, and nothing else', () => {
    const page = 'Intro text.\nImage 9: Logo of the site\n![hero](https://cdn.example/x.png) Real sentence about Rust.\n  Image 10: Photo credit\nThe image 3: shows a chart.'
    expect(capText(cleanPageText(page), 500)).toBe('Intro text. Real sentence about Rust. The image 3: shows a chart.')
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
    const [source] = parseHn({ hits: [hnHit()] })
    expect(source).toEqual({
      title: 'The James Webb Space Telescope is finding too many early galaxies',
      site: 'Hacker News',
      url: 'https://news.ycombinator.com/item?id=34360010',
      note: '764 points, 526 comments, Jan 2023',
      snippet:
        'Hacker News story "The James Webb Space Telescope is finding too many early galaxies", linking to skyandtelescope.org. 764 points, 526 comments, Jan 2023.',
    })
  })

  it('drops hits with a bad id or low points, never links to the story url, and keeps at most three', () => {
    const body = {
      hits: [
        hnHit({ objectID: '12; DROP' }),
        hnHit({ objectID: '2', points: 5 }),
        hnHit({ objectID: '4' }),
        hnHit({ objectID: '5', url: 'javascript:alert(1)' }),
        hnHit({ objectID: '6' }),
        hnHit({ objectID: '7' }),
      ],
    }
    const parsed = parseHn(body)
    expect(parsed.map(source => source.url)).toEqual([
      'https://news.ycombinator.com/item?id=4',
      'https://news.ycombinator.com/item?id=5',
      'https://news.ycombinator.com/item?id=6',
    ])
    expect(parsed[1]?.snippet).not.toContain('javascript')
  })

  it('returns nothing for an empty or odd body', () => {
    expect(parseHn({ hits: [] })).toEqual([])
    expect(parseHn({})).toEqual([])
    expect(parseHn([])).toEqual([])
  })
})

describe('parseWebSearch', () => {
  it('keeps https results in Tavily order with their own link, host and extract, and drops http ones', () => {
    expect(parseWebSearch(WEB_REPLY)).toEqual([
      {
        title: 'Webb finds early galaxies',
        site: 'Web',
        url: 'https://www.space.com/webb-early-galaxies',
        snippet: 'The James Webb Space Telescope found early galaxies only 300 million years after the Big Bang.',
        note: 'space.com',
      },
      { title: 'Unrelated cooking tips', site: 'Web', url: 'https://cooking.example/tips', snippet: 'Salt your pasta water.', note: 'cooking.example' },
    ])
  })

  it('escapes brackets and parentheses in the link, drops links with a login, and names the host when there is no title', () => {
    const body = {
      results: [
        { title: ' ', url: 'https://example.com/a_(b)_[c]', content: 'rust systems language' },
        { title: 'Rust systems', url: 'https://user:pass@example.com/x', content: 'rust systems language' },
        { title: 'Rust systems', url: 'javascript:alert(1)', content: 'rust systems language' },
      ],
    }
    expect(parseWebSearch(body)).toEqual([
      { title: 'example.com', site: 'Web', url: 'https://example.com/a_%28b%29_%5Bc%5D', snippet: 'rust systems language', note: 'example.com' },
    ])
  })

  it('strips page junk before the cut, keeps at most five candidates and cuts each extract to 500 characters', () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      title: `Rust ${i}`,
      url: `https://example.com/${i}`,
      content: `Image 9: banner\n![x](https://cdn.example/x.png)rust ${'word '.repeat(200)}`,
    }))
    const parsed = parseWebSearch({ results })
    expect(parsed).toHaveLength(5)
    expect(parsed.every(source => source.snippet.length <= MAX_SNIPPET_CHARS + 1 && source.snippet.startsWith('rust word'))).toBe(true)
  })

  it('returns nothing for an odd body', () => {
    expect(parseWebSearch({})).toEqual([])
    expect(parseWebSearch({ detail: { error: 'x' } })).toEqual([])
    expect(parseWebSearch(null)).toEqual([])
  })
})

describe('parseArxiv', () => {
  it('reads titles, abstracts and dates, builds the link from the paper id without its version, and decodes XML entities', () => {
    const feed = arxivFeed(arxivEntry('2610.01234v3', 'Safe &amp; fast\n   Rust systems', 'We study Rust &lt;unsafe&gt; blocks in systems code.'))
    expect(parseArxiv(feed)).toEqual([
      {
        title: 'Safe & fast Rust systems',
        site: 'arXiv',
        url: 'https://arxiv.org/abs/2610.01234',
        snippet: 'We study Rust <unsafe> blocks in systems code.',
        note: 'preprint, Oct 2026',
      },
    ])
  })

  it('accepts an old-style id and an id with no version, drops an error entry, and keeps at most four', () => {
    const feed = arxivFeed(
      '<entry><id>http://arxiv.org/api/errors#bad_id</id><title>Error</title><summary>rust systems error</summary></entry>',
      arxivEntry('cs/0601001v2', 'Rust systems one', 'rust systems'),
      arxivEntry('2610.00002', 'Cooking', 'pasta'),
      arxivEntry('2610.00003v1', 'Rust systems two', 'rust systems'),
      arxivEntry('2610.00004v1', 'Rust systems three', 'rust systems'),
      arxivEntry('2610.00005v1', 'Rust systems four', 'rust systems'),
    )
    expect(parseArxiv(feed).map(source => source.url)).toEqual([
      'https://arxiv.org/abs/cs/0601001',
      'https://arxiv.org/abs/2610.00002',
      'https://arxiv.org/abs/2610.00003',
      'https://arxiv.org/abs/2610.00004',
    ])
  })

  it('returns nothing for a reply that is not a feed', () => {
    expect(parseArxiv('<html>nope</html>')).toEqual([])
    expect(parseArxiv(null)).toEqual([])
  })
})

describe('numbering and the prompt block', () => {
  const sources = numberSources(
    [{ title: 'W', site: 'Web', url: 'https://example.com/w', snippet: 'About W.', note: 'example.com' }],
    [{ title: 'A', site: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/A', snippet: 'About A.' }],
    [{ title: 'B', site: 'Hacker News', url: 'https://news.ycombinator.com/item?id=1', snippet: 'About B.', note: '30 points' }],
  )

  it('numbers sources from 1 in the order given, so web pages come first', () => {
    expect(sources.map(source => [source.n, source.title])).toEqual([[1, 'W'], [2, 'A'], [3, 'B']])
  })

  it('writes one block per source with its number, site, title and capped text', () => {
    expect(sourcesPromptBlock(sources)).toBe('[1] Web: W\nAbout W.\n\n[2] Wikipedia: A\nAbout A.\n\n[3] Hacker News: B\nAbout B.')
  })

  it('carries all eight sources at full length to the Researcher', () => {
    const full: Source[] = Array.from({ length: 8 }, (_, i) => ({
      n: i + 1,
      title: `A page title of the usual length ${i + 1}`,
      site: i < 3 ? 'Web' : 'arXiv',
      url: 'https://example.com/p',
      snippet: `${'w '.repeat(250)}`.trim(),
    }))
    const block = sourcesPromptBlock(full)
    expect(block.split('\n\n')).toHaveLength(8)
    expect(block.length).toBeLessThanOrEqual(MAX_PROMPT_SOURCES_CHARS)
  })

  it('stops at a source boundary when the block would pass the cap', () => {
    const big: Source[] = Array.from({ length: 12 }, (_, i) => ({
      n: i + 1,
      title: `T${i + 1}`,
      site: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/T',
      snippet: 'w '.repeat(400),
    }))
    const block = sourcesPromptBlock(big)
    expect(block.length).toBeLessThanOrEqual(MAX_PROMPT_SOURCES_CHARS)
    expect(block.startsWith('[1] Wikipedia: T1')).toBe(true)
    expect(block).not.toContain('[12]')
    expect(block.split('\n\n').every(part => /^\[\d+\] Wikipedia: T\d+\n/.test(part))).toBe(true)
  })
})

describe('retrieveSources', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const xml = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/atom+xml' } })
  const signal = () => new AbortController().signal
  const NOTHING = { query: { pages: [] }, hits: [], results: [] }
  const PROVIDER = { url: 'https://openrouter.test/v1/chat', apiKey: 'test-only-placeholder' }
  type Reply = () => Response | Promise<Response>

  /** A model reply as the provider streams it: the text, then the finish and the bill. */
  const modelReply = (text: string, finish = 'stop'): Response =>
    new Response(
      [
        { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: { content: text } }] },
        { model: 'anthropic/claude-haiku-5.5', choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200, cost: 0.0004 } },
      ]
        .map(value => `data: ${JSON.stringify(value)}\n\n`)
        .join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
  /** The titles the relevance call was shown, in order. */
  const shownTitles = (init: RequestInit | undefined): string[] => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
    return [...(body.messages[1]?.content ?? '').matchAll(/^\d+\. \[[^\]]+\] (.*?)(?: \([^)]*\))?$/gm)].map(match => match[1] ?? '')
  }
  /** Says "relevant" for every shown result whose title is in `keep`. */
  const keepTitles = (...keep: string[]) => (init: RequestInit | undefined) => {
    const results = shownTitles(init).map((title, i) => ({ n: i + 1, relevant: keep.includes(title) }))
    return modelReply(JSON.stringify({ results }))
  }
  const keepAll = (init: RequestInit | undefined) => modelReply(JSON.stringify({ results: shownTitles(init).map((_, i) => ({ n: i + 1, relevant: true })) }))

  /** Routes each site's request to its reply (a site left out answers with nothing found) and the relevance call to `judge`. */
  function fetchBy(replies: { web?: Reply; arxiv?: Reply; hn?: Reply; wiki?: Reply; judge?: (init: RequestInit | undefined) => Response | Promise<Response> }) {
    const mock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === PROVIDER.url) return (replies.judge ?? keepAll)(init)
      if (url.startsWith('https://api.tavily.com/')) return (replies.web ?? (() => json(NOTHING)))()
      if (url.startsWith('https://export.arxiv.org/')) return (replies.arxiv ?? (() => xml(arxivFeed())))()
      if (url.startsWith('https://en.wikipedia.org/')) return (replies.wiki ?? (() => json(NOTHING)))()
      return (replies.hn ?? (() => json(NOTHING)))()
    })
    vi.stubGlobal('fetch', mock)
    return mock
  }
  const options = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) => ({ signal: signal(), fetchImpl, webKey: 'test-key', provider: PROVIDER, ...extra })
  const providerCalls = (fetchImpl: ReturnType<typeof fetchBy>) => fetchImpl.mock.calls.filter(call => String(call[0]) === PROVIDER.url)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('looks up all four sites in parallel, asks the model once, numbers web pages first, and caps each site', async () => {
    const fetchImpl = fetchBy({
      web: () => json(WEB_REPLY),
      arxiv: () => xml(arxivFeed(arxivEntry('2610.01234v1', 'James Webb telescope galaxies', 'early galaxies seen by the Webb telescope'))),
      hn: () => json({ hits: [hnHit()] }),
      wiki: () => json(WIKIPEDIA_REPLY),
      judge: keepTitles('Webb finds early galaxies', 'James Webb telescope galaxies', 'The James Webb Space Telescope is finding too many early galaxies', 'James Webb Space Telescope', 'Hubble Space Telescope'),
    })
    const result = await retrieveSources('What has the James Webb Space Telescope discovered?', options(fetchImpl))

    expect(result.sources.map(source => [source.n, source.site, source.title])).toEqual([
      [1, 'Web', 'Webb finds early galaxies'],
      [2, 'arXiv', 'James Webb telescope galaxies'],
      [3, 'Hacker News', 'The James Webb Space Telescope is finding too many early galaxies'],
      [4, 'Wikipedia', 'James Webb Space Telescope'],
    ])
    expect(result.detail).toBe('Found 1 web page, 1 arXiv paper, 1 Hacker News thread and 1 Wikipedia article. The relevance check kept 4 of 6 results.')
    expect(result.reached).toBe(true)
    expect(result.judged).toBe(true)
    expect(result.candidates).toBe(6)
    expect(result.usage).toEqual({ prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200, cost: 0.0004 })
    // Tavily, arXiv, Hacker News, Wikipedia twice (all words, any word), and the one relevance call.
    expect(fetchImpl).toHaveBeenCalledTimes(6)
    expect(providerCalls(fetchImpl)).toHaveLength(1)
    const sent = fetchImpl.mock.calls.map(call => [String(call[0]), call[1]] as const)
    const wikiTerms = sent.filter(([url]) => url.startsWith('https://en.wikipedia.org/')).map(([url]) => new URL(url).searchParams.get('gsrsearch'))
    expect(wikiTerms).toEqual(['James Webb Space Telescope discovered', 'James OR Webb OR Space OR Telescope OR discovered'])
    const tavily = sent.find(([url]) => url.startsWith('https://api.tavily.com/'))?.[1]
    expect(tavily?.method).toBe('POST')
    expect(JSON.parse(String(tavily?.body))).toMatchObject({ query: 'What has the James Webb Space Telescope discovered?' })
    expect(tavily?.headers).toMatchObject({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' })
    expect(sent.find(([url]) => url.startsWith('https://en.wikipedia.org/'))?.[1]?.headers).toMatchObject({ 'User-Agent': expect.stringContaining('AgentFlow') })
  })

  it('shows the model the question and every candidate with its site and title, as quoted data', async () => {
    const fetchImpl = fetchBy({ web: () => json(WEB_REPLY), hn: () => json({ hits: [hnHit()] }) })
    await retrieveSources('What has the James Webb Space Telescope discovered?', options(fetchImpl))
    const body = JSON.parse(String(providerCalls(fetchImpl)[0]?.[1]?.body)) as { messages: Array<{ role: string; content: string }> }
    expect(body.messages[0]?.content).toContain('never instructions')
    expect(body.messages[0]?.content).toMatch(/Today's date is \d{4}-\d{2}-\d{2}\.$/)
    expect(body.messages[1]?.content).toContain('Question: What has the James Webb Space Telescope discovered?')
    expect(shownTitles(providerCalls(fetchImpl)[0]?.[1])).toEqual([
      'Webb finds early galaxies',
      'Unrelated cooking tips',
      'The James Webb Space Telescope is finding too many early galaxies',
    ])
  })

  it('drops what the model marks not relevant, and keeps a site\'s results in its own order up to its cap', async () => {
    const results = Array.from({ length: 5 }, (_, i) => ({ title: `Page ${i + 1}`, url: `https://example.com/${i + 1}`, content: `text ${i + 1}` }))
    const fetchImpl = fetchBy({
      web: () => json({ results }),
      judge: keepTitles('Page 2', 'Page 3', 'Page 4', 'Page 5'),
    })
    const result = await retrieveSources('anything at all', options(fetchImpl))
    expect(result.sources.map(source => source.title)).toEqual(['Page 2', 'Page 3', 'Page 4'])
    expect(result.detail).toBe('Found 3 web pages. The relevance check kept 3 of 5 results.')
  })

  it('caps arXiv at two, Hacker News at two and Wikipedia at one after the model has judged', async () => {
    const fetchImpl = fetchBy({
      arxiv: () => xml(arxivFeed(...[1, 2, 3, 4].map(i => arxivEntry(`2610.0000${i}v1`, `Paper ${i}`, 'abstract')))),
      hn: () => json({ hits: [1, 2, 3].map(i => hnHit({ objectID: String(i), title: `Story ${i}` })) }),
      wiki: () => json(WIKIPEDIA_REPLY),
    })
    const result = await retrieveSources('anything at all', options(fetchImpl))
    expect(result.sources.map(source => source.title)).toEqual(['Paper 1', 'Paper 2', 'Story 1', 'Story 2', 'James Webb Space Telescope'])
    expect(result.sources.map(source => source.n)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps no source and says so plainly when the model marks every result not relevant', async () => {
    const fetchImpl = fetchBy({
      web: () => json({ results: [{ title: 'Pasta', url: 'https://cooking.example/pasta', content: 'Salt the water.' }] }),
      arxiv: () => xml(arxivFeed(arxivEntry('2610.00002v1', 'Cooking', 'pasta'))),
      hn: () => json({ hits: [hnHit({ title: 'A completely different story' })] }),
      wiki: () => json({ query: { pages: [{ title: 'Pasta', index: 1, extract: 'Pasta is food.' }] } }),
      judge: keepTitles(),
    })
    const result = await retrieveSources('quantum chromodynamics lattice', options(fetchImpl))
    expect(result.sources).toEqual([])
    expect(result.detail).toBe('No sources found for this question on the web, arXiv, Hacker News or Wikipedia. The relevance check kept 0 of 4 results.')
    expect(result.reached).toBe(true)
    expect(result.judged).toBe(true)
  })

  it('makes no model call when the sites gave nothing to judge', async () => {
    const fetchImpl = fetchBy({})
    const result = await retrieveSources('zxqv', options(fetchImpl))
    expect(result.sources).toEqual([])
    expect(result.detail).toBe('No sources found for this question on the web, arXiv, Hacker News or Wikipedia.')
    expect(result.reached).toBe(true)
    expect(result.usage).toBeUndefined()
    expect(providerCalls(fetchImpl)).toHaveLength(0)
  })

  it('falls back to the web search order and drops the other sites when the relevance call fails, and says so', async () => {
    const web = { results: Array.from({ length: 5 }, (_, i) => ({ title: `Page ${i + 1}`, url: `https://example.com/${i + 1}`, content: `text ${i + 1}` })) }
    const cases: Array<[string, () => Response | Promise<Response>]> = [
      ['gave an answer that could not be read', () => modelReply('I cannot help with that')],
      ['was cut off before it finished', () => modelReply('{"results":[', 'length')],
      ['could not get an answer from the AI provider', () => new Response('nope', { status: 401 })],
    ]
    for (const [why, judge] of cases) {
      const fetchImpl = fetchBy({ web: () => json(web), hn: () => json({ hits: [hnHit()] }), wiki: () => json(WIKIPEDIA_REPLY), judge })
      const result = await retrieveSources('anything at all', options(fetchImpl))
      expect(result.sources.map(source => source.site)).toEqual(['Web', 'Web', 'Web'])
      expect(result.sources.map(source => source.title)).toEqual(['Page 1', 'Page 2', 'Page 3'])
      expect(result.detail).toBe(`Found 3 web pages. The relevance check ${why}, so web results are in the search's own order and the other sites were left out.`)
      expect(result.judged).toBe(false)
    }
  })

  it('falls back when the relevance call does not answer within its own deadline', async () => {
    const stalled = (init: RequestInit | undefined) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')))
      })
    const fetchImpl = fetchBy({ web: () => json({ results: [{ title: 'Page 1', url: 'https://example.com/1', content: 'text' }] }), judge: stalled })
    const started = Date.now()
    const result = await retrieveSources('anything at all', options(fetchImpl, { relevanceTimeoutMs: 40 }))
    expect(Date.now() - started).toBeLessThan(2500)
    expect(result.judged).toBe(false)
    expect(result.sources.map(source => source.title)).toEqual(['Page 1'])
    expect(result.detail).toContain('The relevance check did not answer in time')
  })

  it('falls back when no provider is set up', async () => {
    const fetchImpl = fetchBy({ web: () => json({ results: [{ title: 'Page 1', url: 'https://example.com/1', content: 'text' }] }) })
    const result = await retrieveSources('anything at all', options(fetchImpl, { provider: null }))
    expect(result.sources.map(source => source.title)).toEqual(['Page 1'])
    expect(result.detail).toBe("Found 1 web page. The relevance check is not set up on this server, so web results are in the search's own order and the other sites were left out.")
    expect(providerCalls(fetchImpl)).toHaveLength(0)
  })

  it('keeps one Wikipedia article even when both Wikipedia requests return the same pages', async () => {
    const fetchImpl = fetchBy({ wiki: () => json(WIKIPEDIA_REPLY) })
    const result = await retrieveSources('space telescope', options(fetchImpl))
    expect(result.sources.map(source => source.title)).toEqual(['James Webb Space Telescope'])
    expect(shownTitles(providerCalls(fetchImpl)[0]?.[1])).toEqual(['James Webb Space Telescope', 'Hubble Space Telescope'])
  })

  it('uses the any-word Wikipedia request when the all-words one finds nothing', async () => {
    let calls = 0
    const fetchImpl = fetchBy({
      wiki: () => {
        calls += 1
        return json(calls === 1 ? { batchcomplete: true } : WIKIPEDIA_REPLY)
      },
    })
    const result = await retrieveSources('space telescope', options(fetchImpl))
    expect(result.sources.map(source => source.title)).toEqual(['James Webb Space Telescope'])
  })

  it('keeps the other sites when one fails, and says which one failed', async () => {
    const fetchImpl = fetchBy({ wiki: () => json({}, 503), hn: () => json({ hits: [hnHit()] }) })
    const result = await retrieveSources('James Webb Space Telescope', options(fetchImpl))
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.n).toBe(1)
    expect(result.detail).toBe('Found 1 Hacker News thread. Wikipedia answered HTTP 503. The relevance check kept 1 of 1 results.')
    expect(result.reached).toBe(true)
  })

  it('names the web search in the trace when it is over its monthly limit, and the others carry on', async () => {
    for (const status of [429, 432]) {
      const fetchImpl = fetchBy({ web: () => json({ detail: { error: 'usage limit' } }, status), hn: () => json({ hits: [hnHit()] }) })
      const result = await retrieveSources('James Webb Space Telescope', options(fetchImpl))
      expect(result.detail).toBe('Found 1 Hacker News thread. Web search over its monthly limit. The relevance check kept 1 of 1 results.')
      expect(result.sources.map(source => source.site)).toEqual(['Hacker News'])
    }
  })

  it('names a refused key, and says the web search is not set up when there is no key at all', async () => {
    const refused = await retrieveSources('James Webb Space Telescope', options(fetchBy({ web: () => json({}, 401), hn: () => json({ hits: [hnHit()] }) })))
    expect(refused.detail).toBe('Found 1 Hacker News thread. Web search refused its key. The relevance check kept 1 of 1 results.')

    const fetchImpl = fetchBy({ hn: () => json({ hits: [hnHit()] }) })
    const unset = await retrieveSources('James Webb Space Telescope', { signal: signal(), fetchImpl, webKey: '', provider: PROVIDER })
    expect(unset.detail).toBe('Found 1 Hacker News thread. Web search is not set up on this server. The relevance check kept 1 of 1 results.')
    expect(fetchImpl.mock.calls.some(call => String(call[0]).startsWith('https://api.tavily.com/'))).toBe(false)
  })

  it('tries a dropped connection once more and then uses the answer', async () => {
    let wikiCalls = 0
    const fetchImpl = fetchBy({
      wiki: () => {
        wikiCalls += 1
        if (wikiCalls === 1) throw new TypeError('fetch failed')
        return json(WIKIPEDIA_REPLY)
      },
    })
    const result = await retrieveSources('space telescope', options(fetchImpl))
    expect(wikiCalls).toBe(3) // the first request twice, the any-word request once
    expect(result.detail).toBe('Found 1 Wikipedia article. The relevance check kept 1 of 2 results.')
  })

  it('does not retry an HTTP error status', async () => {
    let arxivCalls = 0
    const fetchImpl = fetchBy({
      arxiv: () => {
        arxivCalls += 1
        return xml('error', 500)
      },
    })
    await retrieveSources('James Webb', options(fetchImpl))
    expect(arxivCalls).toBe(1)
  })

  it('reports no sources, with the reasons, when every lookup fails', async () => {
    const down = () => {
      throw new TypeError('fetch failed')
    }
    const fetchImpl = fetchBy({ web: down, arxiv: down, wiki: down, hn: () => new Response('<html>', { status: 200 }) })
    const result = await retrieveSources('anything', options(fetchImpl))
    expect(result.sources).toEqual([])
    expect(result.detail).toBe(
      'No sources retrieved: Web search could not be reached; arXiv could not be reached; Hacker News sent a reply that is not JSON; Wikipedia could not be reached.',
    )
    expect(result.reached).toBe(false)
    expect(providerCalls(fetchImpl)).toHaveLength(0)
  })

  it('gives up on a lookup that does not answer within the timeout, and names every site that stalled', async () => {
    const stalled = (init: RequestInit | undefined) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')))
      })
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => stalled(init))
    const started = Date.now()
    const result = await retrieveSources('anything', options(fetchImpl, { timeoutMs: 30 }))
    expect(Date.now() - started).toBeLessThan(1000)
    expect(result.sources).toEqual([])
    expect(result.detail).toBe(
      'No sources retrieved: Web search did not answer in time; arXiv did not answer in time; Hacker News did not answer in time; Wikipedia did not answer in time.',
    )
  })

  it('refuses a reply larger than the byte cap', async () => {
    const fetchImpl = fetchBy({ arxiv: () => xml('x'.repeat(250_000)) })
    const result = await retrieveSources('anything', options(fetchImpl))
    expect(result.detail).toBe('No sources found for this question on the web, arXiv, Hacker News or Wikipedia. arXiv sent too much data.')
    expect(result.reached).toBe(true)
  })
})
