import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A provider that sends its headers and then stalls must end at the 25 second run deadline
// with the existing timeout message, even though the stubbed fetch ignores the abort signal.
const BODY = { code: 'def divide(a, b):\n    return a / b', language: 'python' }

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-only-placeholder')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ai function deadline', () => {
  it('answers 504 with the timeout message when the provider body never finishes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stalled = new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => stalled))
    const handler = (await import('../../netlify/functions/ai')).default
    const request = new Request('http://localhost/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.77' },
      body: JSON.stringify(BODY),
    })

    const pending = handler(request)
    await vi.advanceTimersByTimeAsync(25_000)
    const res = await pending

    expect(res.status).toBe(504)
    const payload = (await res.json()) as { error: string; trace: Array<{ name: string; status: string; detail: string }> }
    expect(payload.error).toBe('The AI provider did not answer in time.')
    expect(payload.trace[2]).toMatchObject({ name: 'Model call', status: 'failed', detail: 'Timed out after 25 s' })
  })
})
