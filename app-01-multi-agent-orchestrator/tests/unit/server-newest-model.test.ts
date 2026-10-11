import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL_LIST_URL, NEWEST_CACHE_MS, NEWEST_TIMEOUT_MS, createNewestSource, modelFacts, servedCheck } from '../../netlify/shared/newest-model'

const ALIAS = '~anthropic/claude-haiku-latest'
const NEWEST = 'anthropic/claude-haiku-5.5'
const OTHER = 'anthropic/claude-haiku-4.5'
const aliasEntry = { id: ALIAS, name: 'Claude Haiku latest', alias_target: { slug: NEWEST } }

function listReply(json: unknown): Response {
  return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** A fresh copy of the module, so the live source starts with an empty cache. */
async function freshModule() {
  vi.resetModules()
  return import('../../netlify/shared/newest-model')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('newestModel (live list)', () => {
  it('reads alias_target.slug of the alias entry, sends the bot User-Agent, and waits 3 s at most', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => listReply({ data: [{ id: 'other/model', alias_target: { slug: OTHER } }, aliasEntry] }))
    vi.stubGlobal('fetch', fetchMock)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const { newestModel } = await freshModule()

    expect(await newestModel()).toBe(NEWEST)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(MODEL_LIST_URL)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'User-Agent': 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)' })
    expect(NEWEST_TIMEOUT_MS).toBe(3_000)
    expect(timeout).toHaveBeenCalledWith(3_000)
  })

  it('returns null when the list times out, fails, answers badly, or has no usable alias entry', async () => {
    const replies: Array<() => Promise<Response>> = [
      () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      async () => new Response('down', { status: 503 }),
      async () => new Response('not json', { status: 200 }),
      async () => listReply({ data: [{ id: 'other/model', alias_target: { slug: OTHER } }] }),
      async () => listReply({ data: [{ id: ALIAS }] }),
    ]
    for (const reply of replies) {
      vi.stubGlobal('fetch', vi.fn(reply))
      const { newestModel } = await freshModule()
      expect(await newestModel()).toBeNull()
    }
  })

  it('keeps a resolved id, so the list is read once for the hour', async () => {
    const fetchMock = vi.fn(async () => listReply({ data: [aliasEntry] }))
    vi.stubGlobal('fetch', fetchMock)
    const { newestModel } = await freshModule()

    expect(await newestModel()).toBe(NEWEST)
    expect(await newestModel()).toBe(NEWEST)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not keep a list that lacks the alias entry, so the next call asks again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listReply({ data: [] }))
      .mockResolvedValueOnce(listReply({ data: [aliasEntry] }))
    vi.stubGlobal('fetch', fetchMock)
    const { newestModel } = await freshModule()

    expect(await newestModel()).toBeNull()
    expect(await newestModel()).toBe(NEWEST)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('createNewestSource', () => {
  it('keeps a resolved id for one hour, then loads again', async () => {
    let now = 0
    const load = vi.fn(async () => NEWEST)
    const source = createNewestSource(load, () => now)

    expect(await source()).toBe(NEWEST)
    now = NEWEST_CACHE_MS - 1
    expect(await source()).toBe(NEWEST)
    expect(load).toHaveBeenCalledTimes(1)
    now = NEWEST_CACHE_MS
    expect(await source()).toBe(NEWEST)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one load between callers who arrive together', async () => {
    const load = vi.fn(async () => NEWEST)
    const source = createNewestSource(load, () => 0)

    expect(await Promise.all([source(), source()])).toEqual([NEWEST, NEWEST])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('never keeps a null answer', async () => {
    const load = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(NEWEST)
    const source = createNewestSource(load, () => 0)

    expect(await source()).toBeNull()
    expect(await source()).toBe(NEWEST)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('servedCheck', () => {
  it('gives one of the four outcomes', () => {
    expect(servedCheck(NEWEST, NEWEST)).toBe('match')
    expect(servedCheck(NEWEST, OTHER)).toBe('mismatch')
    expect(servedCheck(null, NEWEST)).toBe('unchecked')
    expect(servedCheck(NEWEST, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})

describe('modelFacts', () => {
  it('keeps a missing served model null, never the requested alias', () => {
    expect(modelFacts(undefined, NEWEST)).toEqual({ servedModel: null, newestModel: NEWEST, modelCheck: 'not-reported' })
    expect(modelFacts(undefined, NEWEST).servedModel).not.toBe(ALIAS)
  })

  it('logs a mismatch with the served, newest and requested ids, and logs nothing for a match', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(modelFacts(NEWEST, NEWEST).modelCheck).toBe('match')
    expect(warn).not.toHaveBeenCalled()
    expect(modelFacts(OTHER, NEWEST)).toEqual({ servedModel: OTHER, newestModel: NEWEST, modelCheck: 'mismatch' })
    expect(warn).toHaveBeenCalledWith(`model mismatch: served ${OTHER}, newest ${NEWEST}, requested ${ALIAS}`)
  })
})
