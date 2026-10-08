import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat, providerKey, replyOf } from '../../netlify/shared/openrouter'
import { stubFetch, TEST_KEY, useTestKey } from '../helpers'

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const BODY = { model: 'vendor/model', messages: [{ role: 'user' as const, content: 'Hi' }], max_tokens: 2048 }
const LIMITS = { timeoutMs: 5_000 }
const UNREADABLE = 'The AI provider could not be reached or returned an unreadable reply'

// A fetch that only ends when its signal aborts, the way a provider call that never answers behaves.
function hangUntilAborted() {
  return stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
}

describe('chat', () => {
  useTestKey()
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends max_tokens and usage.include on every request, with the key as a bearer token', async () => {
    const stub = stubFetch(async () => Response.json({ model: 'vendor/model', choices: [] }))
    const result = await chat(TEST_KEY, BODY, LIMITS)
    expect(result.ok).toBe(true)
    expect(stub).toHaveBeenCalledTimes(1)
    const [url, init] = stub.mock.calls[0]
    expect(url).toBe(CHAT_URL)
    expect(init?.headers).toEqual({ Authorization: `Bearer ${TEST_KEY}`, 'Content-Type': 'application/json' })
    const sent = JSON.parse(String(init?.body)) as { max_tokens: number; usage: unknown }
    expect(sent.max_tokens).toBe(2048)
    expect(sent.usage).toEqual({ include: true })
  })

  it('returns the parsed reply with a measured latency', async () => {
    const stub = stubFetch(async () => Response.json({ model: 'vendor/model', choices: [] }))
    const result = await chat(TEST_KEY, BODY, LIMITS)
    expect(stub).toHaveBeenCalledTimes(1)
    expect(result.ok && result.data.model).toBe('vendor/model')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('maps each provider status to its plain-language message and keeps the provider body out of it', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const cases: [number, string][] = [
      [401, 'The AI provider rejected the key or is out of credit'],
      [402, 'The AI provider rejected the key or is out of credit'],
      [429, 'Rate limited, try again in a minute'],
      [500, 'The AI provider did not answer in time'],
      [503, 'The AI provider did not answer in time'],
      [404, 'The AI provider rejected the request (status 404)'],
    ]
    for (const [status, message] of cases) {
      const stub = stubFetch(async () => new Response('{"error":"secret-provider-detail"}', { status }))
      const result = await chat(TEST_KEY, BODY, LIMITS)
      expect(stub).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ ok: false, error: message })
      expect(JSON.stringify(result)).not.toContain('secret-provider-detail')
    }
    expect(logs).toHaveBeenCalledWith(expect.stringContaining('secret-provider-detail'))
  })

  it('reports a timeout with the timeout message', async () => {
    const stub = stubFetch(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    expect(await chat(TEST_KEY, BODY, LIMITS)).toMatchObject({ ok: false, error: 'The AI provider did not answer in time' })
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('ends a call that never answers when its timeout passes', async () => {
    const stub = hangUntilAborted()
    const result = await chat(TEST_KEY, BODY, { timeoutMs: 20 })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, error: 'The AI provider did not answer in time' })
    expect(result.latencyMs).toBeGreaterThanOrEqual(15)
  })

  it('still ends at its timeout while the caller signal stays open', async () => {
    const stub = hangUntilAborted()
    const open = new AbortController()
    const result = await chat(TEST_KEY, BODY, { timeoutMs: 20, signal: open.signal })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, error: 'The AI provider did not answer in time' })
    expect(open.signal.aborted).toBe(false)
  })

  it('stops at once when the caller aborts, with a stopped message rather than a timeout message', async () => {
    const controller = new AbortController()
    const stub = hangUntilAborted()
    const pending = chat(TEST_KEY, BODY, { timeoutMs: 5_000, signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({
      ok: false,
      error: 'The request was stopped before the AI provider answered',
    })
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('reports a reply that arrives after the caller stopped as stopped, not as an answer', async () => {
    const controller = new AbortController()
    const stub = stubFetch(async () => Response.json({ model: 'vendor/model', choices: [] }))
    controller.abort()
    const result = await chat(TEST_KEY, BODY, { timeoutMs: 5_000, signal: controller.signal })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, error: 'The request was stopped before the AI provider answered' })
  })

  it('reports a network failure without the raw error text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND openrouter.ai')
    })
    const result = await chat(TEST_KEY, BODY, LIMITS)
    expect(stub).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, error: UNREADABLE })
    expect(JSON.stringify(result)).not.toContain('ENOTFOUND')
  })

  it('reports a reply that is not a JSON object as unreadable', async () => {
    const stub = stubFetch(async () => new Response('"just a string"', { status: 200 }))
    expect(await chat(TEST_KEY, BODY, LIMITS)).toMatchObject({ ok: false, error: UNREADABLE })
    expect(stub).toHaveBeenCalledTimes(1)
  })
})

describe('replyOf', () => {
  it('reads the first choice text and its finish reason', () => {
    expect(replyOf({ choices: [{ message: { content: 'READY' }, finish_reason: 'stop' }] })).toEqual({
      text: 'READY',
      finishReason: 'stop',
    })
  })

  it('returns empty text when the reply has no choices', () => {
    expect(replyOf({})).toEqual({ text: '', finishReason: null })
  })
})

describe('providerKey', () => {
  useTestKey()

  it('reads the key from the environment without surrounding spaces', () => {
    process.env.OPENROUTER_API_KEY = `  ${TEST_KEY}  `
    expect(providerKey()).toBe(TEST_KEY)
  })

  it('returns null when the key is blank', () => {
    process.env.OPENROUTER_API_KEY = '   '
    expect(providerKey()).toBeNull()
  })
})
