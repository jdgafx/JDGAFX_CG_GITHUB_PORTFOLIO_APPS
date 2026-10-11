import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL } from '../../netlify/shared/models'
import { newestModel, servedCheck } from '../../netlify/shared/newest-model'
import { loadModelList, MODELS_URL, parseModelList, PRICE_TTL_MS, resetPriceCache, USER_AGENT } from '../../netlify/shared/prices'
import { modelsResponse, RECORDED_LIST, SERVED_MODEL } from '../helpers/prices'

beforeEach(() => resetPriceCache())

const listFetch = () => vi.fn(async () => modelsResponse())

/** The recorded list with its alias entry taken out, as a list that answers but lacks the newest model. */
const listWithoutAlias = (): unknown => ({
  data: (RECORDED_LIST as { data: Array<{ id: string }> }).data.filter((entry) => entry.id !== MODEL),
})

describe('newestModel', () => {
  it('reads the alias_target of the entry whose id is the requested alias', () => {
    expect(newestModel(parseModelList(RECORDED_LIST))).toBe(SERVED_MODEL)
  })

  it('is null when the list has no entry for the alias', () => {
    expect(newestModel(parseModelList(listWithoutAlias()))).toBeNull()
  })

  it('is null when there is no list', () => {
    expect(newestModel(null)).toBeNull()
  })
})

describe('loadModelList and the newest model', () => {
  it('fetches the public list once with the portfolio User-Agent and no key, and names the newest model', async () => {
    const fetchImpl = listFetch()

    const list = await loadModelList({ fetchImpl, now: 1_000 })

    expect(newestModel(list)).toBe(SERVED_MODEL)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(MODELS_URL)
    expect(init.headers).toMatchObject({ 'User-Agent': USER_AGENT })
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i)
  })

  it('keeps a list that names the newest model for an hour, then fetches again', async () => {
    const fetchImpl = listFetch()

    await loadModelList({ fetchImpl, now: 1_000 })
    await loadModelList({ fetchImpl, now: 1_000 + PRICE_TTL_MS - 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await loadModelList({ fetchImpl, now: 1_000 + PRICE_TTL_MS })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not keep a list that lacks the alias entry, so the next run fetches again and can find the newest model', async () => {
    const lacking = vi.fn(async () => new Response(JSON.stringify(listWithoutAlias()), { status: 200 }))
    expect(newestModel(await loadModelList({ fetchImpl: lacking as unknown as typeof fetch, now: 1_000 }))).toBeNull()

    const working = listFetch()
    expect(newestModel(await loadModelList({ fetchImpl: working, now: 1_001 }))).toBe(SERVED_MODEL)
    expect(working).toHaveBeenCalledTimes(1)
  })

  it('is null when the fetch never answers within the timeout, and the next run tries again', async () => {
    const hung = vi.fn(() => new Promise<Response>(() => undefined))
    expect(newestModel(await loadModelList({ fetchImpl: hung as unknown as typeof fetch, timeoutMs: 20 }))).toBeNull()

    expect(newestModel(await loadModelList({ fetchImpl: listFetch() }))).toBe(SERVED_MODEL)
  })

  it('is null when the body is not JSON', async () => {
    const garbled = vi.fn(async () => new Response('<html>', { status: 200 }))
    expect(newestModel(await loadModelList({ fetchImpl: garbled as unknown as typeof fetch }))).toBeNull()
  })
})

describe('servedCheck', () => {
  it('matches when the served model is the newest model', () => {
    expect(servedCheck(SERVED_MODEL, SERVED_MODEL)).toBe('match')
  })

  it('mismatches when the served model is another model', () => {
    expect(servedCheck(SERVED_MODEL, 'anthropic/claude-haiku-4.5')).toBe('mismatch')
  })

  it('is unchecked when the list names no newest model', () => {
    expect(servedCheck(null, SERVED_MODEL)).toBe('unchecked')
  })

  it('is not-reported when the reply names no model, whatever the newest model is, and never compares the requested alias', () => {
    expect(servedCheck(SERVED_MODEL, null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})
