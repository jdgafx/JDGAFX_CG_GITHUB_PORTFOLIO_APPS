import { afterEach, describe, expect, it, vi } from 'vitest'
import { servedCheck } from '../../netlify/shared/newest-model'
import { NEWEST_LIST, jsonResponse, stubFetch } from '../helpers'

// The module keeps the list it read, so each test that depends on that state loads a fresh copy.
async function load() {
  vi.resetModules()
  return import('../../netlify/shared/newest-model')
}

describe('newestModel', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the alias_target of the entry for the requested alias', async () => {
    stubFetch(async () => jsonResponse(NEWEST_LIST))
    const { newestModel } = await load()
    expect(await newestModel()).toBe('anthropic/claude-haiku-5.5')
  })

  it('asks the public list with the app User-Agent, no key, and a timeout signal', async () => {
    const mock = stubFetch(async () => jsonResponse(NEWEST_LIST))
    const { newestModel, MODEL_LIST_URL } = await load()
    await newestModel()
    expect(String(mock.mock.calls[0][0])).toBe(MODEL_LIST_URL)
    const init = mock.mock.calls[0][1]
    expect(new Headers(init?.headers).get('user-agent')).toBe('jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)')
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['the list times out', async () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))],
    ['the list is not JSON', async () => new Response('<html>busy</html>', { status: 200 })],
    ['the list has no entry for the alias', async () => jsonResponse({ data: [{ id: 'other/model', alias_target: { slug: 'x' } }] })],
    ['the entry has no alias target', async () => jsonResponse({ data: [{ id: '~anthropic/claude-haiku-latest' }] })],
    ['the list answers an error status', async () => jsonResponse({}, 500)],
    ['the request fails', async () => Promise.reject(new TypeError('fetch failed'))],
  ])('returns null when %s', async (_label, reply) => {
    stubFetch(reply)
    const { newestModel } = await load()
    expect(await newestModel()).toBeNull()
  })

  it('keeps a list it read for an hour, then reads it again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const mock = stubFetch(async () => jsonResponse(NEWEST_LIST))
    const { newestModel } = await load()
    await newestModel()
    await newestModel()
    expect(mock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(59 * 60 * 1000)
    await newestModel()
    expect(mock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60 * 1000)
    await newestModel()
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('does not keep a list that could not be read, so the next run tries again', async () => {
    let calls = 0
    stubFetch(async () => (++calls === 1 ? new Response('down', { status: 503 }) : jsonResponse(NEWEST_LIST)))
    const { newestModel } = await load()
    expect(await newestModel()).toBeNull()
    expect(await newestModel()).toBe('anthropic/claude-haiku-5.5')
  })
})

describe('servedCheck', () => {
  it('reports match for the newest model and mismatch for any other', () => {
    expect(servedCheck('anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-5.5')).toBe('match')
    expect(servedCheck('anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-4.5')).toBe('mismatch')
  })

  it('reports unchecked when the newest model is not known', () => {
    expect(servedCheck(null, 'anthropic/claude-haiku-4.5')).toBe('unchecked')
  })

  it('reports not-reported when the reply named no model, whatever the list says', () => {
    expect(servedCheck('anthropic/claude-haiku-5.5', null)).toBe('not-reported')
    expect(servedCheck(null, null)).toBe('not-reported')
  })
})
