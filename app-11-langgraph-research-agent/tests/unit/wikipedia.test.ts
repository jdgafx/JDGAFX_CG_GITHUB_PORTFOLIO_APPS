import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalUrl,
  cleanText,
  EXTRACT_CHARS,
  pageUrl,
  parsePage,
  parseSearch,
  readWikipediaPage,
  searchUrl,
  searchWikipedia,
  TOOL_TIMEOUT_MS,
  USER_AGENT,
  WikiError,
} from '../../netlify/shared/wikipedia'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as unknown

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Wikipedia request URLs', () => {
  it('encodes the search query and keeps the fixed options', () => {
    expect(searchUrl('Expo 98 Lisbon')).toBe(
      'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=Expo%2098%20Lisbon&format=json&srlimit=5&utf8=1',
    )
  })

  it('asks for plain-text extracts and follows redirects', () => {
    expect(pageUrl("Expo '98")).toBe(
      "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=0&titles=Expo%20'98&format=json&redirects=1",
    )
  })

  it('builds the canonical article URL with underscores for spaces', () => {
    expect(canonicalUrl("Expo '98")).toBe("https://en.wikipedia.org/wiki/Expo_'98")
    expect(canonicalUrl('Lisbon (city)')).toBe('https://en.wikipedia.org/wiki/Lisbon_(city)')
  })
})

describe('cleanText', () => {
  it('strips tags, decodes named and numeric entities, and collapses spaces', () => {
    expect(cleanText('<b>Lisbon</b> &amp; &lt;Portugal&gt;   &#65; &#x42;')).toBe('Lisbon & <Portugal> A B')
  })

  it('decodes the apostrophe and quote entities that Wikipedia search uses', () => {
    expect(cleanText('Expo &#039;98 &quot;Oceans&quot;')).toBe('Expo \'98 "Oceans"')
  })
})

describe('parseSearch', () => {
  it('returns the titles in order with tags stripped and entities decoded', () => {
    expect(parseSearch(fixture('wikipedia-search.json'))).toEqual([
      {
        title: "Expo '98",
        snippet:
          'Expo \'98 was a world\'s fair held in Lisbon, Portugal, from 22 May to 30 September 1998. Its theme was "The Oceans: A Heritage for the Future".',
      },
      { title: 'Lisbon', snippet: 'Lisbon is the capital and largest city of Portugal.' },
    ])
  })

  it('returns an empty list when nothing matched', () => {
    expect(parseSearch({ batchcomplete: '', query: { search: [] } })).toEqual([])
  })

  it('throws a plain error when the API returns an error object', () => {
    expect(() => parseSearch({ error: { code: 'badvalue' } })).toThrow('Wikipedia returned an error.')
  })
})

describe('parsePage', () => {
  it('returns the canonical title, the canonical URL and the page text', () => {
    const page = parsePage(fixture('wikipedia-page.json'), 'Expo 98')
    expect(page).toEqual({
      title: "Expo '98",
      url: "https://en.wikipedia.org/wiki/Expo_'98",
      extract:
        "Expo '98 was a world's fair held in Lisbon, Portugal, from 22 May to 30 September 1998. Its theme was The Oceans: A Heritage for the Future.",
    })
  })

  it('keeps at most 2,500 characters of text', () => {
    const long = { query: { pages: { '7': { pageid: 7, title: 'Long page', extract: 'a'.repeat(4000) } } } }
    expect(parsePage(long, 'Long page').extract).toHaveLength(EXTRACT_CHARS)
    expect(EXTRACT_CHARS).toBe(2500)
  })

  it('reports a missing page with the title that was asked for', () => {
    expect(() => parsePage(fixture('wikipedia-missing.json'), 'Nonexistent page xyz')).toThrow(
      'No Wikipedia page has the title "Nonexistent page xyz".',
    )
  })

  it('reports a page with no text as a plain error', () => {
    const empty = { query: { pages: { '9': { pageid: 9, title: 'Stub', extract: '   ' } } } }
    expect(() => parsePage(empty, 'Stub')).toThrow('The Wikipedia page "Stub" has no readable text.')
  })
})

describe('Wikipedia calls', () => {
  it('sends a User-Agent that names the app and its live address, and no personal contact', async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => jsonResponse(fixture('wikipedia-search.json')))
    vi.stubGlobal('fetch', fetchStub)

    const hits = await searchWikipedia('Lisbon', new AbortController().signal)

    expect(hits.map((hit) => hit.title)).toEqual(["Expo '98", 'Lisbon'])
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const init = fetchStub.mock.calls[0]?.[1]
    expect(init?.headers).toMatchObject({ 'User-Agent': USER_AGENT })
    expect(USER_AGENT).toContain('https://jdgafx-app-11-langgraph-research-agent.netlify.app')
    expect(USER_AGENT).not.toContain('@')
  })

  it('reads a page through the page URL and returns the parsed text', async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => jsonResponse(fixture('wikipedia-page.json')))
    vi.stubGlobal('fetch', fetchStub)

    const page = await readWikipediaPage('Expo 98', new AbortController().signal)

    expect(page.url).toBe("https://en.wikipedia.org/wiki/Expo_'98")
    expect(fetchStub.mock.calls[0]?.[0]).toBe(pageUrl('Expo 98'))
  })

  it('reports an HTTP error in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 503)))
    await expect(searchWikipedia('Lisbon', new AbortController().signal)).rejects.toThrow(
      'Wikipedia returned an error.',
    )
  })

  it('reports an unreachable Wikipedia in plain words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(searchWikipedia('Lisbon', new AbortController().signal)).rejects.toThrow('Could not reach Wikipedia.')
  })

  it('gives up after six seconds and reports the timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    const pending = searchWikipedia('Lisbon', new AbortController().signal)
    const assertion = expect(pending).rejects.toThrow('The Wikipedia search timed out.')
    await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS)
    await assertion
  })

  it('stops when the run budget signal aborts, without waiting for the timer', async () => {
    const budget = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    const pending = searchWikipedia('Lisbon', budget.signal)
    budget.abort()
    await expect(pending).rejects.toBeInstanceOf(WikiError)
  })
})
