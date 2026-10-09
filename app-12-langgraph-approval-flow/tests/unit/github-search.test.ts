import { afterEach, describe, expect, it, vi } from 'vitest'
import { limitMessage, parseSearch, searchedIssueFrom, searchIssues, SEARCH_TIMEOUT_MS, SearchError } from '../../netlify/shared/github-search'
import recorded from '../fixtures/vscode-334721.json'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete process.env.GITHUB_TOKEN
})

const NEVER = new AbortController().signal

describe('parseSearch on a recorded GitHub reply', () => {
  it('reads number, state, close reason, dates and body, and keeps the order', () => {
    const items = parseSearch(recorded.strict)
    expect(items).toHaveLength(10)
    expect(items[1]).toMatchObject({
      number: 334721,
      state: 'closed',
      stateReason: 'duplicate',
      htmlUrl: 'https://github.com/microsoft/vscode/issues/334721',
      title: 'Compact hamburger menu does not open when clicked',
    })
    expect(items[0].stateReason).toBeNull()
  })

  it('drops pull requests, items without the fields, and links that are not issue pages', () => {
    const good = recorded.strict.items[0]
    expect(searchedIssueFrom({ ...good, pull_request: {} })).toBeNull()
    expect(searchedIssueFrom({ ...good, state: 'merged' })).toBeNull()
    expect(searchedIssueFrom({ ...good, html_url: 'https://evil.example/microsoft/vscode/issues/1' })).toBeNull()
    expect(searchedIssueFrom({ ...good, created_at: 'yesterday' })).toBeNull()
    expect(parseSearch({ items: 'nope' })).toEqual([])
    expect(parseSearch(null)).toEqual([])
  })
})

describe('limitMessage', () => {
  const headers = (values: Record<string, string>) => new Headers(values)

  it('names the quota with and without a token and reads the wait from Retry-After', () => {
    expect(limitMessage(headers({ 'retry-after': '37' }), false)).toBe("GitHub's search limit (10 searches a minute without a token) is used up. Try again in about 37 seconds.")
    expect(limitMessage(headers({ 'retry-after': '1' }), true)).toBe("GitHub's search limit (30 searches a minute) is used up. Try again in about 1 second.")
  })

  it('falls back to the reset time of the primary limit, then to a plain minute', () => {
    const now = Date.UTC(2026, 9, 9, 12, 0, 0)
    expect(limitMessage(headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 25) }), false, now)).toContain('Try again in about 25 seconds.')
    expect(limitMessage(headers({}), false, now)).toContain('Try again in a minute.')
  })
})

describe('searchIssues', () => {
  it('sends the query with a token only when GITHUB_TOKEN is set, and parses the reply', async () => {
    const fetchStub = vi.fn(async () => Response.json(recorded.strict))
    vi.stubGlobal('fetch', fetchStub)

    expect(await searchIssues('repo:microsoft/vscode is:issue compact', NEVER)).toHaveLength(10)
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/search/issues?q=repo%3Amicrosoft%2Fvscode+is%3Aissue+compact&per_page=30')
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()

    process.env.GITHUB_TOKEN = 'token-for-test'
    await searchIssues('repo:a/b is:issue x', NEVER)
    expect(((fetchStub.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe('Bearer token-for-test')
  })

  it.each([
    [403, { 'retry-after': '12' }, true, 'Try again in about 12 seconds.'],
    [429, {}, true, 'Try again in a minute.'],
    [422, {}, false, 'GitHub would not search this repository for duplicates.'],
    [500, {}, false, "GitHub's search answered with an error (500)."],
  ])('answers %i with a plain SearchError', async (status, headers, limited, text) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"raw"}', { status, headers })))
    const err = await searchIssues('q', NEVER).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SearchError)
    expect((err as SearchError).limited).toBe(limited)
    expect((err as SearchError).message).toContain(text)
    expect((err as SearchError).message).not.toContain('raw')
  })

  it('says GitHub could not be reached when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(searchIssues('q', NEVER)).rejects.toThrow('GitHub could not be reached')
  })

  it('cuts a reply whose body never finishes at the search limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() {} }), { status: 200 })))
    const outcome = searchIssues('q', NEVER).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS)
    expect(await outcome).toMatchObject({ message: 'GitHub did not answer the duplicate search in time.' })
  })

  it('stops at once when the run is aborted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>(() => {})))
    const run = new AbortController()
    const outcome = searchIssues('q', run.signal).catch((e: unknown) => e)
    run.abort()
    expect(await outcome).toMatchObject({ message: expect.stringContaining('ran out of time') })
  })
})
