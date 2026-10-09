import { describe, expect, it } from 'vitest'
import {
  clipExtract, hackerNewsUrl, isRelevantTitle, parseHackerNews, parseWikipedia, searchTerms, searchesHackerNews,
  wikipediaPageUrl, wikipediaUrl,
} from '../../netlify/shared/sources'

// Shapes recorded from en.wikipedia.org/w/api.php (formatversion=2, generator=search) and hn.algolia.com/api/v1/search.
const WIKIPEDIA_RESPONSE = {
  batchcomplete: true,
  continue: { gsroffset: 5, continue: 'gsroffset||' },
  query: {
    pages: [
      { pageid: 3, ns: 0, title: 'Memory safety', index: 3, extract: 'Memory safety is the state of being protected from various software bugs and security vulnerabilities when dealing with memory access.' },
      { pageid: 1, ns: 0, title: 'Rust (programming language)', index: 1, extract: 'Rust is a general-purpose programming language that emphasizes performance, type safety, concurrency, and memory safety.' },
      { pageid: 9, ns: 0, title: 'Rust', index: 2, extract: 'Rust may refer to: iron oxide, a plant disease, and a programming language, among other meanings of the word.' },
      { pageid: 4, ns: 0, title: 'Stub', index: 4, extract: 'Too short.' },
      { pageid: 5, ns: 0, title: 'Rust for Linux', index: 5, extract: 'Rust for Linux is an ongoing project to add support for the Rust programming language to the Linux kernel.' },
      { pageid: 6, ns: 0, title: 'No extract', index: 6 },
      { pageid: 7, ns: 0, title: 'Sixth', index: 7, extract: 'A sixth article with enough words in its introduction to pass the length check for a usable extract.' },
    ],
  },
}

describe('searchTerms', () => {
  it('keeps the meaningful words of a topic in order, lower-cased', () => {
    expect(searchTerms('Why unit tests matter for small teams')).toEqual(['unit', 'tests', 'small', 'teams'])
  })

  it('drops repeats and keeps names such as c++ and node.js', () => {
    expect(searchTerms('C++ vs C++ and Node.js')).toEqual(['c++', 'vs', 'node.js'])
  })

  it('keeps at most six words', () => {
    expect(searchTerms('alpha bravo charlie delta echo foxtrot golf hotel')).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'])
  })

  it('falls back to the whole topic when every word is a stopword', () => {
    expect(searchTerms('what is it')).toEqual(['what is it'])
  })

  it('returns nothing for an empty topic', () => {
    expect(searchTerms('   ')).toEqual([])
  })
})

describe('URL building', () => {
  it('builds one Wikipedia request that returns search hits with their introductions', () => {
    const url = new URL(wikipediaUrl(['rust', 'memory']))
    expect(`${url.origin}${url.pathname}`).toBe('https://en.wikipedia.org/w/api.php')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: 'rust memory',
      gsrnamespace: '0', gsrlimit: '5', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '5', exchars: '600',
    })
  })

  it('builds the Hacker News request for stories with at least 20 points, relaxing words if nothing matches', () => {
    const url = new URL(hackerNewsUrl(['rust', 'memory']))
    expect(`${url.origin}${url.pathname}`).toBe('https://hn.algolia.com/api/v1/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'rust memory', tags: 'story', hitsPerPage: '12', numericFilters: 'points>=20',
      removeWordsIfNoResults: 'allOptional', attributesToRetrieve: 'title,url,points,created_at,objectID',
    })
  })

  it('encodes characters in the topic instead of letting them reach the query string', () => {
    const url = wikipediaUrl(['a&b=c', 'x#y'])
    expect(new URL(url).searchParams.get('gsrsearch')).toBe('a&b=c x#y')
    expect(new URL(url).searchParams.get('b')).toBeNull()
  })

  it('links an article by title, with spaces as underscores and parentheses encoded', () => {
    expect(wikipediaPageUrl('Rust (programming language)')).toBe('https://en.wikipedia.org/wiki/Rust_%28programming_language%29')
    expect(wikipediaPageUrl('AC/DC')).toBe('https://en.wikipedia.org/wiki/AC%2FDC')
  })

  it('searches Hacker News for every content type except marketing copy', () => {
    expect(searchesHackerNews('Technical Article')).toBe(true)
    expect(searchesHackerNews('Social Thread')).toBe(true)
    expect(searchesHackerNews('Marketing Copy')).toBe(false)
  })
})

describe('clipExtract', () => {
  it('keeps a complete short extract as it is', () => {
    expect(clipExtract('One sentence.\n', 100)).toBe('One sentence.')
  })

  it('cuts a long extract after its last whole sentence', () => {
    expect(clipExtract('First sentence here. Second sentence here. Third one that is cut off mid', 50)).toBe('First sentence here. Second sentence here.')
  })

  it('cuts at a word with an ellipsis when no sentence ends in range', () => {
    const cut = clipExtract('word '.repeat(40), 30)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(31)
  })

  it('ends a cut-off extract with an ellipsis rather than a half sentence', () => {
    expect(clipExtract('Lead sentence is fine and goes on and on without ending because the source cut it', 200).endsWith('…')).toBe(true)
  })
})

describe('parseWikipedia', () => {
  it('orders articles by search rank and skips stubs, disambiguation pages and entries with no text', () => {
    const titles = parseWikipedia(WIKIPEDIA_RESPONSE).map(item => item.title)
    expect(titles).toEqual(['Rust (programming language)', 'Memory safety', 'Rust for Linux'])
  })

  it('returns title, link and extract for each article', () => {
    expect(parseWikipedia(WIKIPEDIA_RESPONSE)[0]).toEqual({
      kind: 'wikipedia',
      title: 'Rust (programming language)',
      url: 'https://en.wikipedia.org/wiki/Rust_%28programming_language%29',
      summary: 'Rust is a general-purpose programming language that emphasizes performance, type safety, concurrency, and memory safety.',
    })
  })

  it('returns nothing for an answer without pages, such as no matches or an error body', () => {
    expect(parseWikipedia({ batchcomplete: true })).toEqual([])
    expect(parseWikipedia({ error: { code: 'x' } })).toEqual([])
    expect(parseWikipedia(null)).toEqual([])
    expect(parseWikipedia('text')).toEqual([])
    expect(parseWikipedia({ query: { pages: 'no' } })).toEqual([])
  })
})

const HN_RESPONSE = {
  hits: [
    { title: 'Rust is not about memory safety', url: 'https://o-santi.github.io/blog/rust-is-not-about-memory-safety/', points: 57, created_at: '2024-06-02T09:30:00.000Z', objectID: '40548000' },
    { title: 'Ask HN: Is Rust memory safe in practice?', url: null, points: 240, created_at: '2022-11-25T12:00:00Z', objectID: '33743000' },
    { title: 'Rust memory safety in Chrome', url: 'https://www.chromium.org/rust', points: 242, created_at: '2020-08-19T01:00:00Z', objectID: '24200000' },
    { title: 'Rust memory safety in Chrome', url: 'https://www.chromium.org/rust', points: 100, created_at: '2020-09-01T01:00:00Z', objectID: '24300000' },
    { title: 'Low points about Rust memory', url: 'https://example.test/low', points: 3, created_at: '2020-01-01T00:00:00Z', objectID: '1' },
    { title: 'Cooking with fire', url: 'https://example.test/fire', points: 900, created_at: '2020-01-01T00:00:00Z', objectID: '2' },
    { title: 'Rust memory unsafe link', url: 'javascript:alert(1)', points: 80, created_at: '2021-01-01T00:00:00Z', objectID: '3' },
  ],
}

describe('parseHackerNews', () => {
  const terms = ['rust', 'memory', 'safety']

  it('keeps relevant stories of 20+ points, most points first, at most three', () => {
    const stories = parseHackerNews(HN_RESPONSE, terms)
    expect(stories.map(story => [story.title, story.points])).toEqual([
      ['Rust memory safety in Chrome', 242],
      ['Ask HN: Is Rust memory safe in practice?', 240],
      ['Rust memory unsafe link', 80],
    ])
  })

  it('returns the story date and link, and falls back to the discussion page when a story has no link', () => {
    const stories = parseHackerNews(HN_RESPONSE, terms)
    expect(stories[0]).toEqual({
      kind: 'hackernews', title: 'Rust memory safety in Chrome', url: 'https://www.chromium.org/rust', summary: '', points: 242, date: '2020-08-19',
    })
    expect(stories[1]?.url).toBe('https://news.ycombinator.com/item?id=33743000')
    expect(stories[1]?.date).toBe('2022-11-25')
  })

  it('never uses a link that is not http(s)', () => {
    const story = parseHackerNews(HN_RESPONSE, terms).find(item => item.title === 'Rust memory unsafe link')
    expect(story?.url).toBe('https://news.ycombinator.com/item?id=3')
  })

  it('returns nothing for an answer without hits', () => {
    expect(parseHackerNews({ hits: [] }, terms)).toEqual([])
    expect(parseHackerNews({}, terms)).toEqual([])
    expect(parseHackerNews([], terms)).toEqual([])
  })
})

describe('isRelevantTitle', () => {
  it('needs about half of the topic words, at most three and at least one', () => {
    expect(isRelevantTitle('Rust memory safety in Chrome', ['rust', 'programming', 'language', 'memory', 'safety'])).toBe(true)
    expect(isRelevantTitle('Show HN: Another Programming Language', ['rust', 'programming', 'language', 'memory', 'safety'])).toBe(false)
    expect(isRelevantTitle('Telescope news', ['telescope'])).toBe(true)
    expect(isRelevantTitle('Cooking with fire', ['telescope'])).toBe(false)
  })

  it('matches a word by its first four letters, so plurals and endings still count', () => {
    expect(isRelevantTitle('Unit testing at scale', ['unit', 'tests'])).toBe(true)
  })
})
