import { afterEach, describe, expect, it, vi } from 'vitest'
import { modelListReply } from '../fixtures/openRouterList'

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

const SERVED = 'anthropic/claude-haiku-5.5'
const NEWER = 'anthropic/claude-haiku-5.6'
const HOUR_MS = 60 * 60 * 1000
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

// Each test loads a fresh copy of the module, so the per-instance cache starts empty.
async function loadModule() {
  vi.resetModules()
  return import('../../netlify/shared/newest-model')
}

function stubFetch(impl: FetchFn) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('parseNewest', () => {
  it('reads the alias_target of the requested alias entry', async () => {
    const { parseNewest } = await loadModule()
    const json = {
      data: [
        { id: 'anthropic/claude-haiku-5.5', alias_target: { slug: 'nope' } },
        { id: '~anthropic/claude-haiku-latest', alias_target: { slug: NEWER } },
      ],
    }
    expect(parseNewest(json)).toBe(NEWER)
  })

  it.each([
    ['no entry for the alias', { data: [{ id: 'anthropic/claude-haiku-5.5' }] }],
    ['an alias entry without a target', { data: [{ id: '~anthropic/claude-haiku-latest' }] }],
    ['an empty target', { data: [{ id: '~anthropic/claude-haiku-latest', alias_target: { slug: '' } }] }],
    ['a body that is not a list', { data: 'models' }],
    ['a body that is null', null],
  ])('returns null for %s', async (_name, json) => {
    const { parseNewest } = await loadModule()
    expect(parseNewest(json)).toBeNull()
  })
})

describe('newestModel', () => {
  it('asks the public list with the project user agent and returns the alias target', async () => {
    const { newestModel, MODEL_LIST_URL } = await loadModule()
    const mock = stubFetch(async () => modelListReply(NEWER))
    expect(await newestModel()).toBe(NEWER)
    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0] ?? []
    expect(url).toBe(MODEL_LIST_URL)
    expect(url).toBe('https://openrouter.ai/api/v1/models')
    expect(init?.headers).toMatchObject({ 'User-Agent': USER_AGENT })
  })

  it('returns null when the list answers with an error status', async () => {
    const { newestModel } = await loadModule()
    stubFetch(async () => new Response('{}', { status: 503 }))
    expect(await newestModel()).toBeNull()
  })

  it('returns null when the list body is not JSON', async () => {
    const { newestModel } = await loadModule()
    stubFetch(async () => new Response('not json', { status: 200 }))
    expect(await newestModel()).toBeNull()
  })

  it('returns null when the connection fails, and never throws', async () => {
    const { newestModel } = await loadModule()
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(newestModel()).resolves.toBeNull()
  })

  it('gives up at 3 seconds when the list never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { newestModel } = await loadModule()
    stubFetch(() => new Promise<Response>(() => undefined))
    const pending = newestModel()
    await vi.advanceTimersByTimeAsync(2_999)
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBeNull()
  })

  it('keeps a resolved newest model for an hour, then asks again', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
    const { newestModel } = await loadModule()
    const mock = stubFetch(async () => modelListReply(NEWER))
    expect(await newestModel()).toBe(NEWER)
    expect(await newestModel()).toBe(NEWER)
    expect(mock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date(Date.parse('2026-10-11T12:00:00Z') + HOUR_MS + 1))
    expect(await newestModel()).toBe(NEWER)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('does not keep an answer that has no entry for the alias, so the next call asks again', async () => {
    const { newestModel } = await loadModule()
    const mock = stubFetch(async () => modelListReply(null))
    expect(await newestModel()).toBeNull()
    expect(await newestModel()).toBeNull()
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between calls that arrive together', async () => {
    const { newestModel } = await loadModule()
    const mock = stubFetch(async () => modelListReply(SERVED))
    const [first, second] = await Promise.all([newestModel(), newestModel()])
    expect(first).toBe(SERVED)
    expect(second).toBe(SERVED)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('servedCheck', () => {
  it('reports match when the served model is the newest', async () => {
    const { servedCheck } = await loadModule()
    expect(servedCheck(SERVED, SERVED)).toBe('match')
  })

  it('reports mismatch when the served model is another model', async () => {
    const { servedCheck } = await loadModule()
    expect(servedCheck(NEWER, SERVED)).toBe('mismatch')
  })

  it('reports unchecked when the list could not name the newest model', async () => {
    const { servedCheck } = await loadModule()
    expect(servedCheck(null, SERVED)).toBe('unchecked')
  })

  it('reports not-reported when the reply named no model, whatever the list says', async () => {
    const { servedCheck } = await loadModule()
    expect(servedCheck(NEWER, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})

describe('runCheck', () => {
  it('gives match for a run whose every call is the newest model', async () => {
    const { runCheck } = await loadModule()
    expect(runCheck(SERVED, [SERVED, SERVED])).toEqual({ modelCheck: 'match', checkedModel: SERVED })
  })

  it('gives the mismatch of any call over a match, with the mismatching id', async () => {
    const { runCheck } = await loadModule()
    expect(runCheck(NEWER, [SERVED, NEWER])).toEqual({ modelCheck: 'mismatch', checkedModel: SERVED })
    expect(runCheck(NEWER, [NEWER, SERVED])).toEqual({ modelCheck: 'mismatch', checkedModel: SERVED })
  })

  it('ranks not-reported above unchecked and match, and unchecked above match', async () => {
    const { runCheck } = await loadModule()
    expect(runCheck(SERVED, [SERVED, null])).toEqual({ modelCheck: 'not-reported', checkedModel: null })
    expect(runCheck(null, [SERVED, null])).toEqual({ modelCheck: 'not-reported', checkedModel: null })
    expect(runCheck(null, [SERVED, SERVED])).toEqual({ modelCheck: 'unchecked', checkedModel: SERVED })
  })

  it('gives not-reported for a run with no model call', async () => {
    const { runCheck } = await loadModule()
    expect(runCheck(NEWER, [])).toEqual({ modelCheck: 'not-reported', checkedModel: null })
  })
})
