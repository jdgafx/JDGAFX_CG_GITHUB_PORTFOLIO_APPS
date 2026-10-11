import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNewestModelSource, MODEL_LIST_URL, servedCheck } from '../../netlify/shared/newest-model'

const ALIAS = '~anthropic/claude-haiku-latest'
const NEWEST = 'anthropic/claude-haiku-5.5'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'
const GOOD = { data: [{ id: 'openai/gpt-4o', alias_target: { slug: 'openai/gpt-4o' } }, { id: ALIAS, alias_target: { slug: NEWEST } }] }

const listReply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

/** Stubs the global fetch with one reply per call, and returns the mock so the calls can be read. */
function stubFetch(reply: () => Promise<Response>) {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => reply())
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('newest model: the list entry for the requested alias', () => {
  it('reads alias_target of the entry whose id is the alias, and sends the bot user agent with no key', async () => {
    const mock = stubFetch(async () => listReply(GOOD))

    expect(await createNewestModelSource()()).toBe(NEWEST)
    const [url, init] = mock.mock.calls[0]
    expect(url).toBe(MODEL_LIST_URL)
    expect(MODEL_LIST_URL).toBe('https://openrouter.ai/api/v1/models')
    expect(init?.headers).toMatchObject({ 'User-Agent': USER_AGENT })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns null when the list request times out, without throwing', async () => {
    stubFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })

    await expect(createNewestModelSource()()).resolves.toBeNull()
  })

  it('returns null when the list is not JSON', async () => {
    stubFetch(async () => new Response('<html>busy</html>', { status: 200 }))

    await expect(createNewestModelSource()()).resolves.toBeNull()
  })

  it('returns null when the list answers with an error status', async () => {
    stubFetch(async () => new Response('unavailable', { status: 503 }))

    await expect(createNewestModelSource()()).resolves.toBeNull()
  })

  it('returns null when the list has no entry for the alias', async () => {
    stubFetch(async () => listReply({ data: [{ id: 'openai/gpt-4o', alias_target: { slug: 'openai/gpt-4o' } }] }))

    await expect(createNewestModelSource()()).resolves.toBeNull()
  })

  it('returns null when the alias entry names no target', async () => {
    stubFetch(async () => listReply({ data: [{ id: ALIAS }] }))

    await expect(createNewestModelSource()()).resolves.toBeNull()
  })
})

describe('newest model: caching', () => {
  it('keeps the answer for an hour, then asks again', async () => {
    let now = 0
    const mock = stubFetch(async () => listReply(GOOD))
    const newest = createNewestModelSource(undefined, () => now)

    expect(await newest()).toBe(NEWEST)
    now = 59 * 60 * 1000
    expect(await newest()).toBe(NEWEST)
    expect(mock).toHaveBeenCalledTimes(1)

    now = 60 * 60 * 1000
    expect(await newest()).toBe(NEWEST)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('lets callers that arrive together share one fetch', async () => {
    const mock = stubFetch(async () => listReply(GOOD))
    const newest = createNewestModelSource()

    expect(await Promise.all([newest(), newest()])).toEqual([NEWEST, NEWEST])
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('does not keep a null answer, so the next call asks again', async () => {
    const replies = [new Response('unavailable', { status: 503 }), listReply(GOOD)]
    const mock = stubFetch(async () => replies.shift() ?? listReply(GOOD))
    const newest = createNewestModelSource()

    expect(await newest()).toBeNull()
    expect(await newest()).toBe(NEWEST)
    expect(mock).toHaveBeenCalledTimes(2)
  })
})

describe('servedCheck', () => {
  it('matches the newest model, and flags any other model as a mismatch', () => {
    expect(servedCheck(NEWEST, NEWEST)).toBe('match')
    expect(servedCheck(NEWEST, 'anthropic/claude-haiku-5.4')).toBe('mismatch')
  })

  it('is unchecked when the list did not say which model is newest', () => {
    expect(servedCheck(null, NEWEST)).toBe('unchecked')
  })

  it('is not-reported when the reply named no model, whatever the list says', () => {
    expect(servedCheck(NEWEST, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})
