import { afterEach, describe, expect, it, vi } from 'vitest'
import { finishAnswer, type Evidence } from '../../netlify/shared/citations'
import { lookupNote } from '../../netlify/shared/graph/nodes'
import { numberSources, runToolCall, toolDefinitions, type ToolBox } from '../../netlify/shared/graph/tools'
import type { ToolCall } from '../../netlify/shared/openrouter'
import { WebError, parseWebPage, parseWebSearch, siteName, WEB_KEY_ENV, webTools, type WebTools } from '../../netlify/shared/websearch'
import type { WikiTools } from '../../netlify/shared/wikipedia'

// The web search: the shapes it reads, the tools it adds, and the two rules that keep the app
// working — no key means no web tools at all, and a web page becomes a source by the same
// numbering path as a Wikipedia page, so the citation rules and the critic never change.

const SIGNAL = new AbortController().signal

const WIKI: WikiTools = {
  search: async () => [],
  page: async () => {
    throw new WebError(404, 'never used here')
  },
}

const call = (id: string, name: string, args: unknown): ToolCall =>
  typeof args === 'string' ? { id, name, args } : { id, name, args: JSON.stringify(args) }

const SEARCH_JSON = {
  query: 'lisbon expo',
  results: [
    { title: 'Expo 98 — Wikipedia', url: 'https://en.wikipedia.org/wiki/Expo_98', content: "Expo '98 was a world's fair\nheld in Lisbon in 1998." },
    // No title: the site's host stands in, so a source is never shown as a bare address.
    { url: 'https://www.example.com/expo-98', content: 'A page about the fair.' },
    { title: '', url: 'https://news.example.org/story', content: 'Coverage.' },
  ],
}

const PAGE_JSON = { results: [{ url: 'https://example.com/expo', raw_content: 'Lisbon\n  hosted  Expo 98  in 1998.' }] }

describe('parseWebSearch', () => {
  it('reads each result as a title, an address and a short excerpt', () => {
    const hits = parseWebSearch(SEARCH_JSON)
    expect(hits).toHaveLength(3)
    expect(hits[0]).toEqual({
      title: 'Expo 98 — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Expo_98',
      snippet: "Expo '98 was a world's fair held in Lisbon in 1998.",
    })
  })

  it('falls back to the site name when the search gives no title, so a source is never just an address', () => {
    const hits = parseWebSearch(SEARCH_JSON)
    expect(hits[1].title).toBe('example.com')
    expect(hits[2].title).toBe('news.example.org')
  })

  it('refuses a reply it cannot read and an error reply', () => {
    expect(() => parseWebSearch(null)).toThrow(WebError)
    expect(() => parseWebSearch({ detail: 'Unauthorized' })).toThrow(WebError)
  })
})

describe('parseWebPage', () => {
  it('reads the page text, collapses whitespace and cuts it to the shared limit', () => {
    const page = parseWebPage(PAGE_JSON, 'https://example.com/expo', 'Expo 98')
    expect(page).toEqual({ title: 'Expo 98', url: 'https://example.com/expo', extract: 'Lisbon hosted Expo 98 in 1998.' })
  })

  it('is a plain no-page error when the site sent no text', () => {
    expect(() => parseWebPage({ results: [] }, 'https://example.com/x', 'X')).toThrow(/could not be read/)
  })
})

describe('siteName', () => {
  it('drops www and keeps a plain fallback for an address it cannot parse', () => {
    expect(siteName('https://www.example.com/a/b')).toBe('example.com')
    expect(siteName('not a url')).toBe('not a url')
  })
})

describe('webTools', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is null without a key, so the app stays on Wikipedia alone', () => {
    expect(webTools(undefined)).toBeNull()
    expect(webTools('')).toBeNull()
  })

  it('reads the key from the environment name the function uses', () => {
    expect(WEB_KEY_ENV).toBe('TAVILY_API_KEY')
  })

  it('sends the key as a bearer token and posts the query it was given', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return Response.json(SEARCH_JSON)
    })
    const web = webTools('secret-key') as WebTools
    const hits = await web.search('lisbon expo', SIGNAL)
    expect(hits).toHaveLength(3)
    expect(seen[0].url).toBe('https://api.tavily.com/search')
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
    expect(JSON.parse(String(seen[0].init.body))).toMatchObject({ query: 'lisbon expo' })
  })

  it('turns a refused key and a spent free tier into plain words', async () => {
    const web = webTools('k') as WebTools
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 401 }))
    await expect(web.search('x', SIGNAL)).rejects.toThrow(/refused its key/)
    vi.stubGlobal('fetch', async () => new Response('slow down', { status: 429 }))
    await expect(web.search('x', SIGNAL)).rejects.toThrow(/free monthly limit/)
  })
})

describe('the tools offered', () => {
  it('offers the Wikipedia pair alone with no key, and all four with one', () => {
    expect(toolDefinitions(false).map((tool) => tool.function.name)).toEqual(['wikipedia_search', 'wikipedia_page'])
    expect(toolDefinitions(true).map((tool) => tool.function.name)).toEqual([
      'wikipedia_search',
      'wikipedia_page',
      'web_search',
      'web_page',
    ])
  })
})

describe('the web tools through runToolCall', () => {
  const box = (web: WebTools | null): ToolBox => ({ wiki: WIKI, web })

  const web: WebTools = {
    search: async () => parseWebSearch(SEARCH_JSON),
    page: async (url) => parseWebPage(PAGE_JSON, url, 'Expo 98'),
  }

  it('shows each result with its address, so web_page can be given one', async () => {
    const outcome = await runToolCall(call('w1', 'web_search', { query: 'lisbon expo' }), box(web), SIGNAL)
    expect(outcome.ok).toBe(true)
    expect(outcome.content.split('\n')[0]).toBe("1. Expo 98 — Wikipedia (https://en.wikipedia.org/wiki/Expo_98): Expo '98 was a world's fair held in Lisbon in 1998.")
    expect(outcome.page).toBeUndefined()
  })

  it('reads a web page and hands it back for numbering, with the title the search showed', async () => {
    const outcome = await runToolCall(call('w2', 'web_page', { url: 'https://example.com/expo', title: 'Expo 98' }), box(web), SIGNAL)
    expect(outcome).toMatchObject({ ok: true, page: { title: 'Expo 98', url: 'https://example.com/expo' } })
    const { added, messages } = numberSources([outcome], [])
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ n: 1, title: 'Expo 98', url: 'https://example.com/expo' })
    expect(messages[0].content).toContain('Source [1]: Expo 98')
  })

  it('is an unknown tool when no key is set, so the model is never told about a provider the run does not have', async () => {
    const outcome = await runToolCall(call('w3', 'web_search', { query: 'x' }), box(null), SIGNAL)
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toMatch(/Unknown tool/)
  })

  it('refuses a web page call with no address, in plain words', async () => {
    const outcome = await runToolCall(call('w4', 'web_page', {}), box(web), SIGNAL)
    expect(outcome.content).toBe('Invalid arguments: web_page needs a page address.')
  })

  it('goes through the one answer path unchanged: a web source is cited and checked like any other', () => {
    const web = (n: number): Evidence => ({ n, title: 'Expo 98', url: 'https://example.com/expo', extract: 'Lisbon hosted Expo 98 in 1998.' })
    const finished = finishAnswer('Lisbon hosted Expo 98 in 1998 [1]. It drew crowds.', [web(1)], false)
    expect(finished.sources).toEqual([{ n: 1, title: 'Expo 98', url: 'https://example.com/expo' }])
    expect(finished.citation.uncited).toEqual(['It drew crowds.'])
  })

  it('names a failed web lookup as a search, never as Wikipedia', () => {
    expect(lookupNote([{ lookup: 'web search "x"', reason: 'Could not reach the web search.' }])).toBe(
      'A search did not answer this lookup: web search "x" (Could not reach the web search). The answer uses only the pages that were read.',
    )
    expect(lookupNote([{ lookup: 'page "Lisbon"', reason: 'Could not reach Wikipedia.' }])).toBe(
      'Wikipedia did not answer this lookup: page "Lisbon" (Could not reach Wikipedia). The answer uses only the pages that were read.',
    )
  })

  it('marks a failed web lookup unreachable and names the web, not Wikipedia', async () => {
    const down: WebTools = {
      search: async () => {
        throw new WebError(502, 'Could not reach the web search.')
      },
      page: web.page,
    }
    const outcome = await runToolCall(call('w5', 'web_search', { query: 'x' }), box(down), SIGNAL)
    expect(outcome).toMatchObject({ ok: false, unreachable: true, lookup: 'web search "x"', note: 'Could not reach the web search.' })
  })
})
