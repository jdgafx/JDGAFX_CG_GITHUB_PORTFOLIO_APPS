import { afterEach, describe, expect, it, vi } from 'vitest'
import { askData, AnalysisRunError, CancelledError, sampleFor } from '../../src/lib/api'
import type { ParsedData } from '../../src/types'

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

const REQUEST = {
  question: 'Which product has the highest total revenue?',
  headers: ['product', 'revenue'],
  sampleRows: [{ product: 'Gadget Y', revenue: '24000' }],
  rowCount: 50,
}

const RUN = {
  trace: [{ name: 'Model call', status: 'ok', ms: 10, detail: 'Served by anthropic/claude-haiku-5.5.' }],
  usage: { total_tokens: 1200 },
  model: 'anthropic/claude-haiku-5.5',
  totalMs: 12,
}

const PLAN = { chartType: 'bar', groupBy: 'product', aggregate: { field: 'revenue', fn: 'sum' }, title: 'T', explanation: '' }

function stubFetch(impl: FetchFn) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function abortingFetch(): FetchFn {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
}

async function failureOf(promise: Promise<unknown>): Promise<AnalysisRunError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof AnalysisRunError) return err
  }
  throw new Error('Expected an AnalysisRunError')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('sampleFor', () => {
  it('sends the first five rows, each cell cut to 200 characters, and only the listed columns', () => {
    const data: ParsedData = {
      headers: ['note', 'revenue'],
      rows: [
        { note: 'x'.repeat(250), revenue: '5', unlisted: 'dropped' },
        { note: 'b', revenue: '6' },
        { note: 'c', revenue: '7' },
        { note: 'd', revenue: '8' },
        { note: 'e', revenue: '9' },
        { note: 'f', revenue: '10' },
      ],
    }
    const sample = sampleFor(data)
    expect(sample).toHaveLength(5)
    expect(sample[0]).toEqual({ note: 'x'.repeat(200), revenue: '5' })
    expect(sample[4]).toEqual({ note: 'e', revenue: '9' })
  })
})

describe('askData success', () => {
  it('returns the server body and posts the request as JSON to the same-origin endpoint', async () => {
    const body = { result: PLAN, ...RUN }
    const mock = stubFetch(async () => jsonResponse(body))
    await expect(askData(REQUEST)).resolves.toEqual(body)
    expect(mock).toHaveBeenCalledTimes(1)
    const init = mock.mock.calls[0]?.[1]
    expect(mock.mock.calls[0]?.[0]).toBe('/api/ai')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST)
  })
})

describe('askData error mapping', () => {
  it('passes the server message and its trace through when a request is refused', async () => {
    stubFetch(async () => jsonResponse({ error: 'A question is required.', ...RUN }, 400))
    const failure = await failureOf(askData(REQUEST))
    expect(failure.message).toBe('A question is required.')
    expect(failure.run.trace).toEqual(RUN.trace)
  })

  it('maps a bare 429 to the rate-limit copy with one failed client step', async () => {
    stubFetch(async () => new Response('', { status: 429 }))
    const failure = await failureOf(askData(REQUEST))
    expect(failure.message).toBe('Rate limited, try again in a minute.')
    expect(failure.run.trace).toEqual([
      { name: 'Send request', status: 'failed', ms: expect.any(Number), detail: 'Rate limited, try again in a minute.' },
    ])
  })

  it('maps a bare 504 from the platform to the did-not-answer copy', async () => {
    stubFetch(async () => new Response('<html>gateway</html>', { status: 504 }))
    const failure = await failureOf(askData(REQUEST))
    expect(failure.message).toBe('The AI provider did not answer in time.')
  })

  it('maps a bare 500 to the unavailable copy', async () => {
    stubFetch(async () => new Response('oops', { status: 500 }))
    const failure = await failureOf(askData(REQUEST))
    expect(failure.message).toBe('The analysis service is unavailable right now. Please try again.')
  })

  it('reports a network failure as a connection problem', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const failure = await failureOf(askData(REQUEST))
    expect(failure.message).toBe('Could not reach the server. Check your connection and try again.')
    expect(failure.run.trace[0]?.detail).toBe('The request did not reach the server.')
  })

  it('reports an unexpected browser error without showing its text', async () => {
    stubFetch(async () => {
      throw new RangeError('internal detail')
    })
    const failure = await failureOf(askData(REQUEST))
    expect(failure.message).toBe('The analysis could not be completed. Please try again.')
  })

  it('treats a 200 reply without a plan as unreadable', async () => {
    stubFetch(async () => jsonResponse({ trace: [] }))
    const failure = await failureOf(askData(REQUEST))
    expect(failure.message).toBe('The analysis service returned an unreadable response. Please try again.')
  })

  it('stops waiting after 30 seconds and says the service did not answer in time', async () => {
    vi.useFakeTimers()
    stubFetch(abortingFetch())
    const pending = failureOf(askData(REQUEST))
    await vi.advanceTimersByTimeAsync(30_000)
    const failure = await pending
    expect(failure.message).toBe('The analysis service did not answer in time. Try again.')
  })

  it('reports a user stop as a cancellation rather than an error', async () => {
    stubFetch(abortingFetch())
    const controller = new AbortController()
    const pending = askData(REQUEST, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(CancelledError)
  })
})
