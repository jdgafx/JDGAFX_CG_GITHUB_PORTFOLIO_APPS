import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MODEL_LIST_URL,
  NEWEST_CACHE_MS,
  NEWEST_LIST_TIMEOUT_MS,
  createNewestSource,
  fetchNewest,
  parseNewest,
  servedCheck,
  worstCheck,
} from '../../netlify/shared/newest-model'

const NEWEST = 'anthropic/claude-haiku-5.5'
const USER_AGENT = 'jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)'

// The shape of OpenRouter's list: the alias entry carries alias_target, and its input_modalities list image.
const LIST = {
  data: [
    {
      id: 'anthropic/claude-haiku-5.5',
      architecture: { input_modalities: ['text', 'image', 'file'] },
      pricing: { prompt: '0.0000001', completion: '0.0000005' },
    },
    {
      id: '~anthropic/claude-haiku-latest',
      alias_target: { name: 'Anthropic: Claude Haiku 5.5', slug: NEWEST },
      architecture: { input_modalities: ['text', 'image', 'file'] },
      pricing: { prompt: '0.0000001', completion: '0.0000005' },
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(reply: () => Promise<Response>) {
  const mock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() => reply())
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('parseNewest', () => {
  it('reads the slug the alias entry names as its target', () => {
    expect(parseNewest(LIST)).toBe(NEWEST)
  })

  it('gives null when the list has no entry for the alias', () => {
    expect(parseNewest({ data: [{ id: 'anthropic/claude-haiku-5.5' }] })).toBeNull()
  })

  it('gives null when the alias entry names no target', () => {
    expect(parseNewest({ data: [{ id: '~anthropic/claude-haiku-latest' }] })).toBeNull()
    expect(parseNewest({ data: [{ id: '~anthropic/claude-haiku-latest', alias_target: { slug: '' } }] })).toBeNull()
  })

  it('gives null for something that is not a list', () => {
    expect(parseNewest('nope')).toBeNull()
    expect(parseNewest({})).toBeNull()
  })
})

describe('fetchNewest', () => {
  it('asks the public list with the app user agent and returns the newest id', async () => {
    const fetchMock = stubFetch(async () => new Response(JSON.stringify(LIST), { status: 200 }))

    await expect(fetchNewest()).resolves.toBe(NEWEST)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(MODEL_LIST_URL)
    expect(url).toBe('https://openrouter.ai/api/v1/models')
    expect(init?.headers).toMatchObject({ 'User-Agent': USER_AGENT })
  })

  it('gives null when the list does not answer in time', async () => {
    stubFetch(() => new Promise<Response>(() => {}))

    await expect(fetchNewest(20)).resolves.toBeNull()
  })

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ['a bad status', () => Promise.resolve(new Response('{}', { status: 500 }))],
    ['unreadable JSON', () => Promise.resolve(new Response('not json', { status: 200 }))],
  ])('gives null on %s and never throws', async (_label, reply) => {
    stubFetch(reply)

    await expect(fetchNewest()).resolves.toBeNull()
  })

  it('uses the three-second limit and the one-hour cache', () => {
    expect(NEWEST_LIST_TIMEOUT_MS).toBe(3_000)
    expect(NEWEST_CACHE_MS).toBe(60 * 60 * 1000)
  })
})

describe('createNewestSource', () => {
  it('keeps a resolved id for an hour and shares one read between callers that arrive together', async () => {
    let clock = 0
    const load = vi.fn(async () => NEWEST)
    const source = createNewestSource(load, () => clock)

    await expect(Promise.all([source(), source()])).resolves.toEqual([NEWEST, NEWEST])
    await expect(source()).resolves.toBe(NEWEST)
    expect(load).toHaveBeenCalledTimes(1)

    clock = NEWEST_CACHE_MS
    await expect(source()).resolves.toBe(NEWEST)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not keep a missing id, so a list that lacks the alias is read again on the next call', async () => {
    const load = vi.fn(async () => null)
    const source = createNewestSource(load, () => 0)

    await expect(source()).resolves.toBeNull()
    await expect(source()).resolves.toBeNull()

    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('servedCheck', () => {
  it.each([
    [NEWEST, NEWEST, 'match'],
    [NEWEST, 'test/other-model', 'mismatch'],
    [null, NEWEST, 'unchecked'],
    [NEWEST, null, 'not-reported'],
    [null, null, 'not-reported'],
  ])('compares newest %s with served %s as %s', (newest, served, check) => {
    expect(servedCheck(newest, served)).toBe(check)
  })
})

describe('worstCheck', () => {
  it('is match only when every check matches', () => {
    expect(worstCheck(['match', 'match'])).toBe('match')
  })

  it('ranks unchecked above match, not-reported above unchecked, and mismatch above all', () => {
    expect(worstCheck(['match', 'unchecked'])).toBe('unchecked')
    expect(worstCheck(['unchecked', 'not-reported', 'match'])).toBe('not-reported')
    expect(worstCheck(['match', 'mismatch', 'not-reported'])).toBe('mismatch')
  })
})
