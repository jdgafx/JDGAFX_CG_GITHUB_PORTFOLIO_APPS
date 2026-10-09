import { afterEach, describe, expect, it, vi } from 'vitest'
import { ATTEMPT_MS, chatWithRetry, MIN_RETRY_MS } from '../../netlify/shared/retry'
import { stubFetch } from '../helpers'
import { reply } from '../server/fixtures'

const BODY = { model: 'vendor/x', messages: [{ role: 'user' as const, content: 'hi' }], max_tokens: 16 }
const timeout = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('chatWithRetry', () => {
  it('asks once more after a timeout and returns the second reply, marked retried', async () => {
    let calls = 0
    const stub = stubFetch(async () => {
      calls += 1
      if (calls === 1) throw timeout()
      return reply('vendor/x', 'READY')
    })
    const result = await chatWithRetry('k', BODY, { budgetMs: 20_000 })
    expect(stub).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ ok: true, retried: true })
  })

  it('retries a lost connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let calls = 0
    const stub = stubFetch(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return reply('vendor/x', 'READY')
    })
    expect(await chatWithRetry('k', BODY, { budgetMs: 20_000 })).toMatchObject({ ok: true, retried: true })
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it.each([400, 401, 402, 429, 500, 503])('never retries a %i from the provider', async status => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => new Response('{}', { status }))
    const result = await chatWithRetry('k', BODY, { budgetMs: 20_000 })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, retried: false })
  })

  it('does not retry a stop by the caller', async () => {
    const controller = new AbortController()
    const stub = stubFetch(async () => {
      controller.abort()
      throw timeout()
    })
    const result = await chatWithRetry('k', BODY, { budgetMs: 20_000, signal: controller.signal })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, retried: false, error: 'The request was stopped before the AI provider answered' })
  })

  it('does not retry when less than the minimum is left in the budget', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = stubFetch(async () => {
      throw timeout()
    })
    const result = await chatWithRetry('k', BODY, { budgetMs: MIN_RETRY_MS - 1 })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(result.retried).toBe(false)
  })

  it('caps the first try at ATTEMPT_MS and gives the second try the rest of the budget', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const stub = stubFetch(async (_url, init) => {
        // A call that hangs until its own signal aborts.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
      })
      const pending = chatWithRetry('k', BODY, { budgetMs: 24_000 })
      await vi.advanceTimersByTimeAsync(ATTEMPT_MS)
      expect(stub).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(24_000 - ATTEMPT_MS)
      const result = await pending
      expect(result).toMatchObject({ ok: false, retried: true, latencyMs: 24_000, error: 'The AI provider did not answer in time' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('first-try caps', () => {
  it('gives the pinned Haiku panel 12 s and the visitor-picked panels 16 s', async () => {
    const { ATTEMPT_OTHER_MS } = await import('../../netlify/shared/retry')
    expect(ATTEMPT_MS).toBe(12_000)
    expect(ATTEMPT_OTHER_MS).toBe(16_000)
    // Both leave at least MIN_RETRY_MS of the 24 s budget for the second try.
    expect(24_000 - ATTEMPT_OTHER_MS).toBeGreaterThanOrEqual(MIN_RETRY_MS)
  })
})

describe('panel wiring', () => {
  async function secondTryAt(slot: 'A' | 'B') {
    const { runPanel } = await import('../../netlify/shared/panel')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const stub = stubFetch(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }))
      const pending = runPanel({ key: 'k', slot, model: 'vendor/x', prompt: 'hi', prices: null, timeoutMs: 24_000 })
      await vi.advanceTimersByTimeAsync(11_999)
      const before = stub.mock.calls.length
      await vi.advanceTimersByTimeAsync(1)
      const at12 = stub.mock.calls.length
      await vi.advanceTimersByTimeAsync(4_000)
      const at16 = stub.mock.calls.length
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await pending
      return { before, at12, at16, result }
    } finally {
      vi.useRealTimers()
    }
  }

  it('retries panel A at 12 s and panel B at 16 s, and shows the retry in the trace', async () => {
    const a = await secondTryAt('A')
    expect([a.before, a.at12, a.at16]).toEqual([1, 2, 2])
    const b = await secondTryAt('B')
    expect([b.before, b.at12, b.at16]).toEqual([1, 1, 2])
    const { panelStep } = await import('../../netlify/shared/panel')
    expect(b.result.retried).toBe(true)
    expect(panelStep(b.result).detail).toBe('The AI provider did not answer in time. Retried once after the first try timed out')
  })
})
