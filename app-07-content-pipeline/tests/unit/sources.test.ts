import { describe, expect, it } from 'vitest'
import {
  clipExtract, hackerNewsUrl, isPersonLead, isRelevantTitle, parseHackerNews, parseWikipedia, searchTerms, searchesHackerNews,
  topicHits, wikipediaPageUrl, wikipediaUrl,
} from '../../netlify/shared/sources'

// Shapes recorded from en.wikipedia.org/w/api.php (formatversion=2, generator=search) and hn.algolia.com/api/v1/search.
const WIKIPEDIA_RESPONSE = {
  batchcomplete: true,
  continue: { gsroffset: 5, continue: 'gsroffset||' },
  query: {
    pages: [
      { pageid: 3, ns: 0, title: 'Memory safety', index: 3, extract: 'Memory safety is the state of being protected from various software bugs and security vulnerabilities when dealing with memory access. By contrast, programming languages like C and Fortran allow arbitrary pointer arithmetic with no bounds checking.' },
      { pageid: 1, ns: 0, title: 'Rust (programming language)', index: 1, extract: 'Rust is a general-purpose programming language that emphasizes performance, type safety, concurrency, and memory safety.' },
      { pageid: 9, ns: 0, title: 'Rust', index: 2, extract: 'Rust may refer to: iron oxide, a plant disease, and a programming language, among other meanings of the word.' },
      { pageid: 4, ns: 0, title: 'Stub', index: 4, extract: 'Too short.' },
      { pageid: 5, ns: 0, title: 'Rust for Linux', index: 5, extract: 'Rust for Linux is an ongoing project to add support for the Rust programming language to the Linux kernel.' },
      { pageid: 6, ns: 0, title: 'No extract', index: 6 },
      { pageid: 7, ns: 0, title: 'Sixth', index: 7, extract: 'A sixth article with enough words in its introduction to pass the length check for a usable extract.' },
    ],
  },
}

const RUST_TERMS = ['rust', 'programming', 'language', 'memory', 'safety']

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

// Search results as the API returned them for "the James Webb Space Telescope" and for "WebAssembly".
const WEBB_RESPONSE = {
  query: {
    pages: [
      { title: 'James E. Webb', index: 2, extract: 'James Edwin Webb (October 7, 1906 \u2013 March 27, 1992) was an American government official who served as the second administrator of NASA from 1961 to 1968.' },
      { title: 'James Webb Space Telescope', index: 1, extract: 'The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy. It is the largest telescope in space.' },
      { title: 'Hubble Space Telescope', index: 3, extract: 'The Hubble Space Telescope (HST) is a space telescope that was launched into low Earth orbit in 1990 and remains in operation.' },
      { title: 'Webb (surname)', index: 4, extract: 'Webb is an English surname, a variant of Webber, a weaver, which is found in many families across the English-speaking world.' },
    ],
  },
}
const WASM_RESPONSE = {
  query: {
    pages: [
      { title: 'Single-page application', index: 1, extract: 'A single-page application (SPA) is a web application that interacts with the user by dynamically rewriting the current web page with new data.' },
      { title: 'WebAssembly', index: 2, extract: 'WebAssembly (Wasm) is a portable binary-code format and a corresponding text format for executable programs, defined as a web standard.' },
    ],
  },
}

describe('parseWikipedia: only articles about the topic', () => {
  const webb = searchTerms('the James Webb Space Telescope')

  it('drops the person the telescope is named after, and a surname page, when the topic is not a person', () => {
    expect(parseWikipedia(WEBB_RESPONSE, webb).map(item => item.title)).toEqual(['James Webb Space Telescope', 'Hubble Space Telescope'])
  })

  it('keeps person pages when the best search hit is a person', () => {
    const person = {
      query: { pages: [
        { title: 'James E. Webb', index: 1, extract: WEBB_RESPONSE.query.pages[0]?.extract },
        { title: 'James Webb Space Telescope', index: 2, extract: WEBB_RESPONSE.query.pages[1]?.extract },
      ] },
    }
    expect(parseWikipedia(person, searchTerms('James E. Webb')).map(item => item.title)).toEqual(['James E. Webb', 'James Webb Space Telescope'])
  })

  it('drops an article whose title shares no word with the topic, however high it ranks', () => {
    expect(parseWikipedia(WASM_RESPONSE, searchTerms('WebAssembly')).map(item => item.title)).toEqual(['WebAssembly'])
  })

  it('drops an article whose opening shares too few topic words', () => {
    const response = { query: { pages: [{ title: 'Rust', index: 1, extract: 'Rust is an iron oxide, a usually reddish-brown oxide formed by the reaction of iron and oxygen in the catalytic presence of water.' }] } }
    expect(parseWikipedia(response, RUST_TERMS)).toEqual([])
  })

  it('puts the article whose title covers most of the topic first, whatever its search rank', () => {
    const response = { query: { pages: [
      { title: 'Memory safety', index: 1, extract: WIKIPEDIA_RESPONSE.query.pages[0]?.extract },
      { title: 'Rust (programming language)', index: 2, extract: WIKIPEDIA_RESPONSE.query.pages[1]?.extract },
    ] } }
    expect(parseWikipedia(response, RUST_TERMS).map(item => item.title)).toEqual(['Rust (programming language)', 'Memory safety'])
  })
})

describe('topicHits and isPersonLead', () => {
  it('counts topic words by their first four letters', () => {
    expect(topicHits('Rust (programming language)', RUST_TERMS)).toBe(3)
    expect(topicHits('Cooking', RUST_TERMS)).toBe(0)
  })

  it('recognises a lifespan in the opening line and nothing else', () => {
    expect(isPersonLead('James Edwin Webb (October 7, 1906 \u2013 March 27, 1992) was an American official.')).toBe(true)
    expect(isPersonLead('Alan Turing (born 23 June 1912) was an English mathematician.')).toBe(true)
    expect(isPersonLead('The sunshield cools to 40 kelvins (-233 \u00b0C) and was deployed on January 4, 2022.')).toBe(false)
    expect(isPersonLead('Rust is a language first released in 2010 (version 1.0 in 2015).')).toBe(false)
  })
})

describe('parseWikipedia', () => {
  it('orders articles by search rank and skips stubs, disambiguation pages and entries with no text', () => {
    const titles = parseWikipedia(WIKIPEDIA_RESPONSE, RUST_TERMS).map(item => item.title)
    expect(titles).toEqual(['Rust (programming language)', 'Memory safety', 'Rust for Linux'])
  })

  it('returns title, link and extract for each article', () => {
    expect(parseWikipedia(WIKIPEDIA_RESPONSE, RUST_TERMS)[0]).toEqual({
      kind: 'wikipedia',
      title: 'Rust (programming language)',
      url: 'https://en.wikipedia.org/wiki/Rust_%28programming_language%29',
      summary: 'Rust is a general-purpose programming language that emphasizes performance, type safety, concurrency, and memory safety.',
    })
  })

  it('returns nothing for an answer without pages, such as no matches or an error body', () => {
    expect(parseWikipedia({ batchcomplete: true }, RUST_TERMS)).toEqual([])
    expect(parseWikipedia({ error: { code: 'x' } }, RUST_TERMS)).toEqual([])
    expect(parseWikipedia(null, RUST_TERMS)).toEqual([])
    expect(parseWikipedia('text', RUST_TERMS)).toEqual([])
    expect(parseWikipedia({ query: { pages: 'no' } }, RUST_TERMS)).toEqual([])
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
