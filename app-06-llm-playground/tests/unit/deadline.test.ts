import { afterEach, describe, expect, it, vi } from 'vitest'
import { raceAbort, withDeadline } from '../../netlify/shared/deadline'
import { chat } from '../../netlify/shared/openrouter'
import { stubFetch, TEST_KEY } from '../helpers'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A reply that sends its headers and then never produces a byte and never ends. */
function stalledBody(): Response {
  return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('withDeadline', () => {
  it('rejects with a TimeoutError at the limit even when the work ignores the abort', async () => {
    vi.useFakeTimers()
    const outcome = withDeadline(1_000, undefined, () => new Promise<string>(() => {})).catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(999)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toMatchObject({ name: 'TimeoutError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forwards a parent abort to the work and rejects with the parent reason', async () => {
    const parent = new AbortController()
    let seen: AbortSignal | undefined
    const outcome = withDeadline(60_000, parent.signal, signal => {
      seen = signal
      return new Promise<string>(() => {})
    }).catch((err: unknown) => err)
    parent.abort()
    expect(await outcome).toMatchObject({ name: 'AbortError' })
    expect(seen?.aborted).toBe(true)
  })

  it('returns the value and leaves no timer behind when the work finishes in time', async () => {
    vi.useFakeTimers()
    await expect(withDeadline(1_000, undefined, async () => 'done')).resolves.toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('raceAbort passes the work error through when the signal never aborts', async () => {
    await expect(raceAbort(Promise.reject(new Error('boom')), new AbortController().signal)).rejects.toThrow('boom')
  })
})

describe('stalled bodies end at the limit with the existing timeout message', () => {
  it('a chat reply whose body never finishes becomes the provider timeout message', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    stubFetch(async () => stalledBody())
    const pending = chat(TEST_KEY, { model: 'vendor/x', messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 }, { timeoutMs: 5_000 })
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toEqual({ ok: false, error: 'The AI provider did not answer in time', latencyMs: 5_000, retryable: true })
  })

  it('a catalogue reply whose body never finishes falls back to the curated list at the limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubFetch(async () => stalledBody())
    vi.resetModules()
    const catalogue = await import('../../netlify/shared/catalogue')
    const pending = catalogue.catalogueView()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toMatchObject({ source: 'fallback' })
  })
})
