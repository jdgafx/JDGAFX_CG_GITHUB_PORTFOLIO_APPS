import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkRecord, createNewestSource, NEWEST_CACHE_MS, NEWEST_TIMEOUT_MS, parseNewest, servedCheck } from '../../netlify/shared/newest-model'
import { stubFetch } from '../helpers'

const ALIAS = '~anthropic/claude-haiku-latest'
const NEWEST = 'anthropic/claude-haiku-5.5'
const LIST_URL = 'https://openrouter.ai/api/v1/models'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'
const LIST = { data: [{ id: ALIAS, pricing: { prompt: '0.000001', completion: '0.000005' }, alias_target: { slug: NEWEST } }] }

// The newest-model module keeps its id per function instance, so each live test loads a fresh copy.
async function fresh() {
  vi.resetModules()
  return import('../../netlify/shared/newest-model')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseNewest', () => {
  it('reads the model the alias resolves to', () => {
    expect(parseNewest(LIST, ALIAS)).toBe(NEWEST)
  })

  it('returns null when the list has no entry for the alias', () => {
    expect(parseNewest({ data: [{ id: 'anthropic/claude-sonnet-5' }] }, ALIAS)).toBeNull()
  })

  it('returns null when the alias entry names no target', () => {
    expect(parseNewest({ data: [{ id: ALIAS }] }, ALIAS)).toBeNull()
    expect(parseNewest({ data: [{ id: ALIAS, alias_target: { slug: '  ' } }] }, ALIAS)).toBeNull()
  })

  it('returns null for JSON that is not a list of models', () => {
    expect(parseNewest('nope', ALIAS)).toBeNull()
    expect(parseNewest({ data: 'x' }, ALIAS)).toBeNull()
    expect(parseNewest(null, ALIAS)).toBeNull()
  })
})

describe('newestModel', () => {
  it('fetches the public list with the portfolio User-Agent and returns the alias target', async () => {
    const stub = stubFetch(async () => Response.json(LIST))
    const { newestModel } = await fresh()
    expect(await newestModel()).toBe(NEWEST)
    expect(stub).toHaveBeenCalledTimes(1)
    const [url, init] = stub.mock.calls[0]
    expect(url).toBe(LIST_URL)
    expect(init?.headers).toEqual({ 'User-Agent': USER_AGENT, Accept: 'application/json' })
  })

  it('returns null when the list answers with an error status', async () => {
    stubFetch(async () => new Response('{}', { status: 503 }))
    const { newestModel } = await fresh()
    expect(await newestModel()).toBeNull()
  })

  it('returns null when the list is not readable JSON', async () => {
    stubFetch(async () => new Response('<html>not json</html>', { status: 200 }))
    const { newestModel } = await fresh()
    expect(await newestModel()).toBeNull()
  })

  it('returns null when the fetch throws', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const { newestModel } = await fresh()
    expect(await newestModel()).toBeNull()
  })

  it('returns null at the 3 second limit, even when the list never answers', async () => {
    vi.useFakeTimers()
    stubFetch(() => new Promise<Response>(() => undefined))
    const { newestModel } = await fresh()
    const pending = newestModel()
    await vi.advanceTimersByTimeAsync(NEWEST_TIMEOUT_MS)
    expect(await pending).toBeNull()
    expect(NEWEST_TIMEOUT_MS).toBe(3_000)
  })

  it('keeps the newest id, so a second call in the hour does not fetch again', async () => {
    const stub = stubFetch(async () => Response.json(LIST))
    const { newestModel } = await fresh()
    expect(await newestModel()).toBe(NEWEST)
    expect(await newestModel()).toBe(NEWEST)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('does not keep a list that lacks the alias, so the next call asks again', async () => {
    const stub = stubFetch(async () => Response.json({ data: [] }))
    const { newestModel } = await fresh()
    expect(await newestModel()).toBeNull()
    expect(await newestModel()).toBeNull()
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between calls that arrive together', async () => {
    const stub = stubFetch(async () => Response.json(LIST))
    const { newestModel } = await fresh()
    expect(await Promise.all([newestModel(), newestModel()])).toEqual([NEWEST, NEWEST])
    expect(stub).toHaveBeenCalledTimes(1)
  })
})

describe('createNewestSource', () => {
  it('keeps a found id for one hour, then asks the list again', async () => {
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

  it('does not keep a null answer', async () => {
    const load = vi.fn(async () => null)
    const source = createNewestSource(load, () => 0)
    expect(await source()).toBeNull()
    expect(await source()).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('servedCheck', () => {
  it('is match when the served id is the newest id', () => {
    expect(servedCheck(NEWEST, NEWEST)).toBe('match')
  })

  it('is mismatch when the served id is another model', () => {
    expect(servedCheck(NEWEST, 'anthropic/claude-haiku-5.4')).toBe('mismatch')
  })

  it('is unchecked when the list gave no newest id', () => {
    expect(servedCheck(null, NEWEST)).toBe('unchecked')
  })

  it('is not-reported when the reply named no model, whatever the newest id is', () => {
    expect(servedCheck(NEWEST, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})

describe('checkRecord', () => {
  it('records the newest id and the check', () => {
    expect(checkRecord(NEWEST, NEWEST, ALIAS)).toEqual({ newestModel: NEWEST, modelCheck: 'match' })
  })

  it('logs a mismatch with the served, newest and requested ids, and still records it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(checkRecord(NEWEST, 'anthropic/claude-haiku-5.4', ALIAS)).toEqual({ newestModel: NEWEST, modelCheck: 'mismatch' })
    expect(warn).toHaveBeenCalledWith(`model mismatch: served anthropic/claude-haiku-5.4, newest ${NEWEST}, requested ${ALIAS}`)
  })

  it('logs nothing for a match', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    checkRecord(NEWEST, NEWEST, ALIAS)
    expect(warn).not.toHaveBeenCalled()
  })
})
