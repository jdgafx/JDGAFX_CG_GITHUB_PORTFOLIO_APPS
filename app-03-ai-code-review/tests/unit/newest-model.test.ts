import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL } from '../../netlify/shared/provider'
import { MODEL_LIST_URL, NEWEST_CACHE_MS, fetchNewest, newestModel, parseNewest, resetNewestModel, servedCheck, waitForNewest } from '../../netlify/shared/newest-model'

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const NEWER = 'anthropic/claude-haiku-5.5'
const list = (entries: unknown[]) => ({ data: entries })
const alias = (target: string) => ({ id: MODEL, alias_target: { slug: target } })
const jsonReply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('parseNewest', () => {
  it('reads the alias_target of the requested alias', () => {
    expect(parseNewest(list([{ id: 'anthropic/claude-haiku-4.5' }, alias(NEWER)]))).toBe(NEWER)
  })

  it('gives null when the list has no entry for the alias, no target, an empty target, or is not a list', () => {
    expect(parseNewest(list([{ id: 'other/model', alias_target: { slug: NEWER } }]))).toBeNull()
    expect(parseNewest(list([{ id: MODEL }]))).toBeNull()
    expect(parseNewest(list([alias('')]))).toBeNull()
    expect(parseNewest('not a list')).toBeNull()
    expect(parseNewest(null)).toBeNull()
  })
})

describe('fetchNewest', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks the public list with the app User-Agent and a timeout signal', async () => {
    const fetchMock = vi.fn<Fetch>(async () => jsonReply(list([alias(NEWER)])))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchNewest()).toBe(NEWER)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(MODEL_LIST_URL)
    expect(init.headers).toMatchObject({ 'User-Agent': 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('gives null on a bad status, unreadable JSON, or a rejected fetch, and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn<Fetch>(async () => jsonReply(list([alias(NEWER)]), 503)))
    expect(await fetchNewest()).toBeNull()
    vi.stubGlobal('fetch', vi.fn<Fetch>(async () => new Response('<html>', { status: 200 })))
    expect(await fetchNewest()).toBeNull()
    vi.stubGlobal('fetch', vi.fn<Fetch>(async () => Promise.reject(new Error('offline'))))
    expect(await fetchNewest()).toBeNull()
  })

  it('gives null when the list does not answer within the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn<Fetch>((_url, init) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))))
    expect(await fetchNewest(20)).toBeNull()
  })
})

describe('newestModel', () => {
  beforeEach(() => resetNewestModel())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps a resolved id for an hour, so the list is fetched once in that time', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<Fetch>(async () => jsonReply(list([alias(NEWER)])))
    vi.stubGlobal('fetch', fetchMock)
    expect(await newestModel()).toBe(NEWER)
    vi.advanceTimersByTime(NEWEST_CACHE_MS - 1)
    expect(await newestModel()).toBe(NEWER)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2)
    expect(await newestModel()).toBe(NEWER)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between callers that arrive together', async () => {
    const fetchMock = vi.fn<Fetch>(async () => jsonReply(list([alias(NEWER)])))
    vi.stubGlobal('fetch', fetchMock)
    expect(await Promise.all([newestModel(), newestModel()])).toEqual([NEWER, NEWER])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not keep a list that lacks the alias, so the next call asks again', async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(jsonReply(list([{ id: 'other/model' }])))
      .mockResolvedValueOnce(jsonReply(list([alias(NEWER)])))
    vi.stubGlobal('fetch', fetchMock)
    expect(await newestModel()).toBeNull()
    expect(await newestModel()).toBe(NEWER)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('servedCheck', () => {
  it('gives match, mismatch, unchecked and not-reported', () => {
    expect(servedCheck(NEWER, NEWER)).toBe('match')
    expect(servedCheck(NEWER, 'anthropic/claude-haiku-4.5')).toBe('mismatch')
    expect(servedCheck(null, NEWER)).toBe('unchecked')
    expect(servedCheck(NEWER, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})

describe('waitForNewest', () => {
  it('gives the id when the list answers in time', async () => {
    expect(await waitForNewest(Promise.resolve(NEWER), 50)).toBe(NEWER)
  })

  it('gives null when the list is slower than the bound, or the budget is already spent', async () => {
    const never = new Promise<string | null>(() => {})
    expect(await waitForNewest(never, 10)).toBeNull()
    expect(await waitForNewest(never, -5)).toBeNull()
  })
})
