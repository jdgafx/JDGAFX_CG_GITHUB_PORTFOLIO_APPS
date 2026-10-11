import { afterEach, describe, it, expect, vi } from 'vitest'
import { createNewestSource, NEWEST_CACHE_MS, parseNewest, servedCheck, worstCheck } from '../../netlify/shared/newest-model'

const ALIAS = '~anthropic/claude-haiku-latest'
const NEWER = 'anthropic/claude-haiku-6.0'
const LIST_URL = 'https://openrouter.ai/api/v1/models'
const listing = { data: [{ id: ALIAS, alias_target: { name: 'Anthropic: Claude Haiku 6.0', slug: NEWER } }] }

/** The live source, from a fresh module so the cache of earlier tests is not kept. */
async function freshNewestModel() {
  vi.resetModules()
  return (await import('../../netlify/shared/newest-model')).newestModel
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseNewest', () => {
  it('reads the alias_target slug of the requested alias', () => {
    expect(parseNewest(listing)).toBe(NEWER)
  })

  it('returns null when the list has no alias entry, or the entry names no target', () => {
    expect(parseNewest({ data: [{ id: 'other/model', alias_target: { slug: NEWER } }] })).toBeNull()
    expect(parseNewest({ data: [{ id: ALIAS }] })).toBeNull()
    expect(parseNewest({ data: [{ id: ALIAS, alias_target: { slug: '' } }] })).toBeNull()
  })

  it('returns null when the body is not a list', () => {
    expect(parseNewest(null)).toBeNull()
    expect(parseNewest('not a list')).toBeNull()
    expect(parseNewest({ data: 'not an array' })).toBeNull()
  })
})

describe('createNewestSource', () => {
  it('keeps a resolved newest id for an hour, then reads the list again', async () => {
    let now = 0
    const load = vi.fn(async () => NEWER)
    const source = createNewestSource(load, () => now)
    expect(await source()).toBe(NEWER)
    now = NEWEST_CACHE_MS - 1
    expect(await source()).toBe(NEWER)
    expect(load).toHaveBeenCalledTimes(1)
    now = NEWEST_CACHE_MS
    expect(await source()).toBe(NEWER)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not keep a null, so a list without the alias is read again on the next call', async () => {
    const load = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(NEWER)
    const source = createNewestSource(load, () => 0)
    expect(await source()).toBeNull()
    expect(await source()).toBe(NEWER)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one read between calls that arrive together', async () => {
    const load = vi.fn(async () => NEWER)
    const source = createNewestSource(load, () => 0)
    expect(await Promise.all([source(), source()])).toEqual([NEWER, NEWER])
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('newestModel', () => {
  it('reads the public list with the portfolio User-Agent and a timeout signal', async () => {
    const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(listing)))
    vi.stubGlobal('fetch', mock)
    expect(await (await freshNewestModel())()).toBe(NEWER)
    const [url, init] = mock.mock.calls[0] ?? []
    expect(url).toBe(LIST_URL)
    expect(init?.headers).toMatchObject({ 'User-Agent': 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('reads the list once for calls within the hour', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify(listing)))
    vi.stubGlobal('fetch', mock)
    const newest = await freshNewestModel()
    expect(await newest()).toBe(NEWER)
    expect(await newest()).toBe(NEWER)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('returns null, without throwing, when the list times out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))))
    expect(await (await freshNewestModel())()).toBeNull()
  })

  it('returns null when the list is not JSON or the status is not OK', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>busy</html>', { status: 200 })))
    expect(await (await freshNewestModel())()).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await (await freshNewestModel())()).toBeNull()
  })

  it('reads the list again when the alias entry is missing, rather than keeping the null', async () => {
    const mock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(listing)))
    vi.stubGlobal('fetch', mock)
    const newest = await freshNewestModel()
    expect(await newest()).toBeNull()
    expect(await newest()).toBe(NEWER)
    expect(mock).toHaveBeenCalledTimes(2)
  })
})

describe('worstCheck', () => {
  it('takes the worst check in the order mismatch, not-reported, unchecked, match', () => {
    expect(worstCheck(['match', 'mismatch', 'not-reported'])).toBe('mismatch')
    expect(worstCheck(['match', 'unchecked', 'not-reported'])).toBe('not-reported')
    expect(worstCheck(['match', 'unchecked'])).toBe('unchecked')
    expect(worstCheck(['match', 'match'])).toBe('match')
  })

  it('is not-reported when there are no checks', () => {
    expect(worstCheck([])).toBe('not-reported')
  })
})

describe('servedCheck', () => {
  it('compares the served model with the newest one', () => {
    expect(servedCheck(NEWER, NEWER)).toBe('match')
    expect(servedCheck(NEWER, 'anthropic/claude-haiku-5-5')).toBe('mismatch')
    expect(servedCheck(null, 'anthropic/claude-haiku-5-5')).toBe('unchecked')
  })

  it('reports not-reported whenever the reply named no model', () => {
    expect(servedCheck(NEWER, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})
