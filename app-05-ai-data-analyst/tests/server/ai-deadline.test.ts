import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'

// A provider that sends its headers and then stalls must end at the 25 second run deadline
// with the existing timeout message, even though the stubbed fetch ignores the abort signal.
const BODY = {
  question: 'Which product has the highest total revenue?',
  headers: ['date', 'product', 'revenue', 'units', 'region'],
  sampleRows: [{ date: '2024-01-08', product: 'Widget A', revenue: '15200', units: '304', region: 'North' }],
  rowCount: 50,
}

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = 'test-only-placeholder'
})

afterEach(() => {
  vi.useRealTimers()
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.unstubAllGlobals()
})

describe('ai function deadline', () => {
  it('answers 504 with the timeout message when the provider body never finishes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stalled = () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    const fetchMock = vi.fn(async () => stalled())
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://app.example/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'deadline-client' },
      body: JSON.stringify(BODY),
    })

    const pending = handler(request)
    await vi.advanceTimersByTimeAsync(25_000)
    const res = await pending

    expect(res.status).toBe(504)
    expect(await res.json()).toMatchObject({ error: 'The AI provider did not answer in time.' })
    // Each try is cut at its own limit (6 s), and the one retry that fits in the budget stalls too.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
