import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPrices, MODELS_URL, parsePriceList, PRICE_TTL_MS, resetPriceCache } from '../../netlify/shared/prices'
import { modelsResponse, RECORDED_LIST, recordedPrices, SERVED_MODEL } from '../helpers/prices'

beforeEach(() => resetPriceCache())

const listFetch = () => vi.fn(async () => modelsResponse())

describe('parsePriceList on the recorded public list', () => {
  it('reads the served model price from pricing.prompt and pricing.completion, as USD per token', () => {
    expect(recordedPrices().get(SERVED_MODEL)).toEqual({ prompt: 0.0000001, completion: 0.0000005 })
  })

  it('finds a model by its dated canonical slug too, which is how a reply may name it', () => {
    expect(recordedPrices().get('anthropic/claude-haiku-5.5-20261007')).toEqual({ prompt: 0.0000001, completion: 0.0000005 })
  })

  it('keeps the batch variant at its own, lower price, and does not let it take over the shared slug', () => {
    const list = recordedPrices()

    expect(list.get('anthropic/claude-haiku-5.5:batch')).toEqual({ prompt: 0.00000005, completion: 0.00000025 })
    expect(list.get('anthropic/claude-haiku-5.5-20261007')?.prompt).toBe(0.0000001)
  })

  it('leaves out a variable-price router listed at -1, so it reads as unavailable and never as a negative cost', () => {
    expect(recordedPrices().has('openrouter/auto')).toBe(false)
  })

  it('skips an entry whose price is missing or empty, and keeps the rest', () => {
    const list = parsePriceList({
      data: [
        { id: 'a/none', pricing: {} },
        { id: 'a/empty', pricing: { prompt: '', completion: '0.1' } },
        { id: 'a/null', pricing: { prompt: null, completion: '0.1' } },
        { id: 'a/word', pricing: { prompt: 'cheap', completion: '0.1' } },
        { id: 'a/ok', pricing: { prompt: '0.000002', completion: '0.00001' } },
      ],
    })

    expect([...(list?.keys() ?? [])]).toEqual(['a/ok'])
  })

  it.each([[null], ['nonsense'], [{}], [{ data: 'x' }], [{ data: [] }]])('reads %j as no list', (payload) => {
    expect(parsePriceList(payload)).toBeNull()
  })
})

describe('loadPrices', () => {
  it('fetches the public models URL once, with no key, and reads the served model price', async () => {
    const fetchImpl = listFetch()

    const list = await loadPrices({ fetchImpl, now: 1_000 })

    expect(list?.get(SERVED_MODEL)?.prompt).toBe(0.0000001)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(MODELS_URL)
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i)
    expect(init.headers).toMatchObject({ 'User-Agent': 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)' })
  })

  it('keeps the list in memory for an hour and fetches again after it', async () => {
    const fetchImpl = listFetch()

    await loadPrices({ fetchImpl, now: 1_000 })
    await loadPrices({ fetchImpl, now: 1_000 + PRICE_TTL_MS - 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await loadPrices({ fetchImpl, now: 1_000 + PRICE_TTL_MS })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between runs that start together', async () => {
    const fetchImpl = listFetch()

    const [a, b] = await Promise.all([loadPrices({ fetchImpl }), loadPrices({ fetchImpl })])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it.each([
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['an HTTP 500', () => Promise.resolve(new Response('down', { status: 500 }))],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['JSON that is not a model list', () => Promise.resolve(new Response('{"data":"x"}', { status: 200 }))],
  ])('gives no list after %s, and the next run tries again instead of keeping the failure', async (_name, fail) => {
    const failing = vi.fn(fail)
    expect(await loadPrices({ fetchImpl: failing as unknown as typeof fetch })).toBeNull()

    const working = listFetch()
    expect((await loadPrices({ fetchImpl: working }))?.get(SERVED_MODEL)).toBeDefined()
    expect(working).toHaveBeenCalledTimes(1)
  })

  it('gives up on a fetch that never answers after the timeout, even if it ignores its abort signal', async () => {
    const hung = vi.fn(() => new Promise<Response>(() => undefined))

    expect(await loadPrices({ fetchImpl: hung as unknown as typeof fetch, timeoutMs: 20 })).toBeNull()
  })
})

describe('no static price table', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : [join(dir, e.name)]))

  it('leaves no price table or hard-coded served model in netlify/ or src/', () => {
    const files = [...sources('netlify'), ...sources('src')].filter((f) => /\.(ts|tsx)$/.test(f))
    expect(files.length).toBeGreaterThan(30)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/\bPRICES\b|inPerM|outPerM|SERVED_MODEL/)
      expect(text, file).not.toMatch(/claude-haiku-5\.5/)
    }
  })

  it('keeps the recorded list a fixture: only tests read it', () => {
    expect(RECORDED_LIST).toBeTruthy()
    const users = [...sources('netlify'), ...sources('src')].filter((f) => readFileSync(f, 'utf8').includes('openrouter-models'))
    expect(users).toEqual([])
  })
})
