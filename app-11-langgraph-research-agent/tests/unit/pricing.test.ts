import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  costFor,
  createPriceBookSource,
  parsePriceBook,
  PRICE_CACHE_MS,
  type PriceBook,
} from '../../netlify/shared/pricing'
import { fixturePriceBook, modelListJson } from '../helpers/priceBook'

// The list under test is the recorded copy in tests/fixtures. Nothing here reaches OpenRouter.

const USAGE = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }

describe('parsePriceBook', () => {
  it('reads the per-token prompt and completion price of each listed model', () => {
    const book = fixturePriceBook()
    expect(book.get('anthropic/claude-haiku-5.5')).toEqual({ inPerToken: 0.0000001, outPerToken: 0.0000005 })
    expect(book.get('anthropic/claude-haiku-4.5')).toEqual({ inPerToken: 0.000001, outPerToken: 0.000005 })
  })

  it('leaves out an entry whose price is negative, empty or not a number', () => {
    const book = parsePriceBook({
      data: [
        { id: 'router/auto', pricing: { prompt: '-1', completion: '-1' } },
        { id: 'a/empty', pricing: { prompt: '', completion: '0.1' } },
        { id: 'a/text', pricing: { prompt: 'free', completion: '0.1' } },
        { id: 'a/none' },
        { id: 'a/free', pricing: { prompt: '0', completion: '0' } },
      ],
    })
    expect([...(book?.keys() ?? [])]).toEqual(['a/free'])
  })

  it('is null for anything that is not a list with at least one usable price', () => {
    expect(parsePriceBook(null)).toBeNull()
    expect(parsePriceBook({ error: 'nope' })).toBeNull()
    expect(parsePriceBook({ data: [] })).toBeNull()
    expect(parsePriceBook({ data: [{ id: 'router/auto', pricing: { prompt: '-1', completion: '-1' } }] })).toBeNull()
  })
})

describe('costFor', () => {
  const book = fixturePriceBook()

  it('is the tokens times the list price of the model that answered', () => {
    // 1000 prompt tokens at $0.10 per 1M plus 200 completion tokens at $0.50 per 1M.
    expect(costFor(book, 'anthropic/claude-haiku-5.5', USAGE)).toBe(0.0002)
    // 1000 prompt tokens at $1 per 1M plus 200 completion tokens at $5 per 1M.
    expect(costFor(book, 'anthropic/claude-haiku-4.5', USAGE)).toBe(0.002)
  })

  it('is null when the reply named no model, even with token counts', () => {
    expect(costFor(book, null, USAGE)).toBeNull()
  })

  it('is null when the list could not be fetched', () => {
    expect(costFor(null, 'anthropic/claude-haiku-5.5', USAGE)).toBeNull()
  })

  it('is null for a model the list does not price, and does not borrow the price of another', () => {
    expect(costFor(book, 'some/unlisted-model', USAGE)).toBeNull()
    expect(costFor(book, 'openrouter/auto-beta', USAGE)).toBeNull()
  })

  it('is null without both token counts, rather than a guess', () => {
    expect(costFor(book, 'anthropic/claude-haiku-5.5', {})).toBeNull()
    expect(costFor(book, 'anthropic/claude-haiku-5.5', { prompt_tokens: 10 })).toBeNull()
  })

  it('ignores the cost OpenRouter reported on the reply', () => {
    expect(costFor(book, 'anthropic/claude-haiku-5.5', { ...USAGE, cost: 5 })).toBe(0.0002)
  })
})

describe('createPriceBookSource', () => {
  const book: PriceBook = fixturePriceBook()

  it('fetches once and keeps the list for an hour', async () => {
    let clock = 1_000
    const load = vi.fn(async () => book)
    const source = createPriceBookSource(load, () => clock)

    expect(await source()).toBe(book)
    clock += PRICE_CACHE_MS - 1
    expect(await source()).toBe(book)
    expect(load).toHaveBeenCalledTimes(1)

    clock += 1
    await source()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('lets callers that arrive together share one fetch', async () => {
    const load = vi.fn(async () => book)
    const source = createPriceBookSource(load)
    await Promise.all([source(), source(), source()])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not keep a failure: the next call tries again', async () => {
    const load = vi.fn<() => Promise<PriceBook | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(book)
    const source = createPriceBookSource(load)
    expect(await source()).toBeNull()
    expect(await source()).toBe(book)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the live fetch', () => {
  // The live source keeps its list in the module, so each test loads a fresh copy.
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  const stubFetch = (reply: () => Promise<Response> | Response) => {
    const stub = vi.fn<typeof fetch>(async () => reply())
    vi.stubGlobal('fetch', stub)
    return stub
  }

  it('reads the public list without a key', async () => {
    const stub = stubFetch(() => Response.json(modelListJson))
    const { livePriceBook } = await import('../../netlify/shared/pricing')
    const got = await livePriceBook()
    expect(got?.get('anthropic/claude-haiku-5.5')).toEqual({ inPerToken: 0.0000001, outPerToken: 0.0000005 })
    expect(stub.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/models')
    expect(JSON.stringify(stub.mock.calls[0]?.[1]?.headers)).not.toMatch(/authorization/i)
  })

  it.each([
    ['a bad status', () => new Response('down', { status: 503 })],
    ['unreadable JSON', () => new Response('<html>')],
    ['a list with no usable price', () => Response.json({ data: [] })],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
  ])('gives null on %s', async (_name, reply) => {
    stubFetch(reply)
    const { livePriceBook } = await import('../../netlify/shared/pricing')
    expect(await livePriceBook()).toBeNull()
  })
})
