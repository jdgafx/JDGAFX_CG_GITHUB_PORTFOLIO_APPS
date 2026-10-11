import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL } from '../../netlify/shared/models'
import {
  createNewestModelSource,
  fetchNewestModel,
  MODEL_LIST_URL,
  NEWEST_CACHE_MS,
  NEWEST_TIMEOUT_MS,
  servedCheck,
  USER_AGENT,
} from '../../netlify/shared/newest-model'

const NEWEST = 'anthropic/claude-haiku-5.5'
const LIST = {
  data: [
    { id: 'anthropic/claude-opus-5-5', alias_target: null },
    { id: MODEL, alias_target: { slug: NEWEST } },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function listOnce(body: unknown, status = 200) {
  const fetchStub = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

describe('fetchNewestModel', () => {
  it('reads the alias_target of the requested alias from the public list, with the bot User-Agent', async () => {
    const fetchStub = listOnce(LIST)

    await expect(fetchNewestModel()).resolves.toBe(NEWEST)

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(MODEL_LIST_URL)
    expect(init.headers).toMatchObject({ 'User-Agent': USER_AGENT })
    expect(JSON.stringify(init.headers)).not.toMatch(/Authorization|@/)
  })

  it('returns null when the list has no entry for the requested alias', async () => {
    listOnce({ data: [{ id: 'anthropic/claude-opus-5-5', alias_target: null }] })
    await expect(fetchNewestModel()).resolves.toBeNull()
  })

  it('returns null when the entry names no alias target', async () => {
    listOnce({ data: [{ id: MODEL, alias_target: null }] })
    await expect(fetchNewestModel()).resolves.toBeNull()
  })

  it('returns null when the list is not a list of models', async () => {
    listOnce('not a list')
    await expect(fetchNewestModel()).resolves.toBeNull()
  })

  it('returns null on a bad status', async () => {
    listOnce(LIST, 500)
    await expect(fetchNewestModel()).resolves.toBeNull()
  })

  it('returns null when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })))
    await expect(fetchNewestModel()).resolves.toBeNull()
  })

  it('returns null when the list cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(fetchNewestModel()).resolves.toBeNull()
  })

  it('gives up at the 3 s limit and returns null', async () => {
    expect(NEWEST_TIMEOUT_MS).toBe(3_000)
    const expired = new AbortController()
    expired.abort()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(expired.signal)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const fail = () => reject(new DOMException('timed out', 'TimeoutError'))
            if (init.signal?.aborted) fail()
            else init.signal?.addEventListener('abort', fail)
          }),
      ),
    )

    await expect(fetchNewestModel()).resolves.toBeNull()
    expect(timeout).toHaveBeenCalledWith(3_000)
  })
})

describe('createNewestModelSource', () => {
  it('keeps a found model for an hour, so the list is read once', async () => {
    let at = 0
    const load = vi.fn(async () => NEWEST)
    const source = createNewestModelSource(load, () => at)

    await expect(source()).resolves.toBe(NEWEST)
    at = NEWEST_CACHE_MS - 1
    await expect(source()).resolves.toBe(NEWEST)
    expect(load).toHaveBeenCalledTimes(1)

    at = NEWEST_CACHE_MS
    await expect(source()).resolves.toBe(NEWEST)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one read between callers that arrive together', async () => {
    const load = vi.fn(async () => NEWEST)
    const source = createNewestModelSource(load)

    await Promise.all([source(), source(), source()])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not keep a null answer, so the next call reads the list again', async () => {
    const load = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(NEWEST)
    const source = createNewestModelSource(load)

    await expect(source()).resolves.toBeNull()
    await expect(source()).resolves.toBe(NEWEST)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('servedCheck', () => {
  it('is a match when the reply came from the newest model', () => {
    expect(servedCheck(NEWEST, NEWEST)).toBe('match')
  })

  it('is a mismatch when the reply came from another model', () => {
    expect(servedCheck(NEWEST, 'anthropic/claude-haiku-5')).toBe('mismatch')
  })

  it('is unchecked when the list gave no newest model', () => {
    expect(servedCheck(null, NEWEST)).toBe('unchecked')
  })

  it('is not-reported when the reply named no model, even when the newest is unknown', () => {
    expect(servedCheck(NEWEST, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})
