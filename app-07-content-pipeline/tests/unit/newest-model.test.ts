import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LIST_URL = 'https://openrouter.ai/api/v1/models'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'
const ALIAS = '~anthropic/claude-haiku-latest'
const NEWEST = 'anthropic/claude-haiku-5.5'
const HOUR_MS = 60 * 60 * 1000

type NewestModule = typeof import('../../netlify/shared/newest-model')
let mod: NewestModule

// The newest model is kept per module instance, so each test loads a fresh copy.
beforeEach(async () => {
  vi.resetModules()
  mod = await import('../../netlify/shared/newest-model')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

// The list as OpenRouter sends it: the alias entry, next to an unrelated one.
function listNaming(slug: string | null): Response {
  return json({
    data: [
      { id: 'openai/gpt-4o', alias_target: null },
      { id: ALIAS, alias_target: slug === null ? null : { slug } },
    ],
  })
}

// Answers each list request with the next queued reply, then with the last one, and records the requests.
function listReplies(...replies: Array<() => Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const next = replies.length > 1 ? replies.shift() : replies[0]
    if (!next) throw new Error('No list reply is queued')
    return next()
  }))
  return calls
}

describe('newestModel', () => {
  it('reads the alias_target of the entry for the requested alias, from the public list with the app User-Agent', async () => {
    const calls = listReplies(() => listNaming(NEWEST))
    expect(await mod.newestModel()).toBe(NEWEST)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(LIST_URL)
    expect(calls[0].init?.headers).toMatchObject({ 'User-Agent': USER_AGENT })
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns null when the entry for the alias has no alias_target', async () => {
    listReplies(() => listNaming(null))
    expect(await mod.newestModel()).toBeNull()
  })

  it('returns null when the list has no entry for the alias', async () => {
    listReplies(() => json({ data: [{ id: 'openai/gpt-4o', alias_target: { slug: 'openai/gpt-4o-2' } }] }))
    expect(await mod.newestModel()).toBeNull()
  })

  it('returns null when the list does not answer with a success status', async () => {
    listReplies(() => new Response('unavailable', { status: 503 }))
    expect(await mod.newestModel()).toBeNull()
  })

  it('returns null when the list is not JSON', async () => {
    listReplies(() => new Response('<html>Gateway</html>', { status: 200 }))
    expect(await mod.newestModel()).toBeNull()
  })

  it('returns null, and does not throw, when the list times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }))
    await expect(mod.newestModel()).resolves.toBeNull()
  })

  it('keeps a resolved id for an hour, and asks the list again after that', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
    const calls = listReplies(() => listNaming(NEWEST))

    expect(await mod.newestModel()).toBe(NEWEST)
    expect(await mod.newestModel()).toBe(NEWEST)
    expect(calls).toHaveLength(1)

    vi.setSystemTime(new Date(Date.parse('2026-10-11T12:00:00Z') + HOUR_MS + 1))
    expect(await mod.newestModel()).toBe(NEWEST)
    expect(calls).toHaveLength(2)
  })

  it('does not keep a null, so the next call asks the list again', async () => {
    const calls = listReplies(() => json({ data: [] }), () => listNaming(NEWEST))
    expect(await mod.newestModel()).toBeNull()
    expect(await mod.newestModel()).toBe(NEWEST)
    expect(calls).toHaveLength(2)
  })
})

describe('servedCheck', () => {
  it('reports not-reported when the reply named no model, whatever the newest model is', () => {
    expect(mod.servedCheck(NEWEST, null)).toBe('not-reported')
    expect(mod.servedCheck(null, null)).toBe('not-reported')
  })

  it('reports unchecked when the newest model is unknown', () => {
    expect(mod.servedCheck(null, NEWEST)).toBe('unchecked')
  })

  it('reports match when the served model is the newest one', () => {
    expect(mod.servedCheck(NEWEST, NEWEST)).toBe('match')
  })

  it('reports mismatch when the served model is another one', () => {
    expect(mod.servedCheck(NEWEST, 'anthropic/claude-haiku-5.4')).toBe('mismatch')
  })
})
