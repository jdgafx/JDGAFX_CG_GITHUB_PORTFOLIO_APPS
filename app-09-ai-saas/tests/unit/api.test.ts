import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  abortInsights,
  getInsights,
  isAbortError,
  RunError,
  type RunHandlers,
  type RunOutcome,
  type TraceStep,
} from '../../src/lib/api'
import type { Summary } from '../../netlify/shared/contract'

const STATS: Summary = {
  startDate: '2026-09-08',
  endDate: '2026-10-07',
  windowDays: 30,
  observedDays: 28,
  packages: [{ name: 'react', total: 912345678, avgPerDay: 32583774, changePct: 3.2, weekendPct: 54.1, sharePct: 100 }],
}

const NETWORK_MESSAGE = "Couldn't reach the insights service. Check your connection and try again."

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

/** Delivers one chunk, then fails the way a dropped connection does. */
function dropAfter(chunk: string): Response {
  const encoder = new TextEncoder()
  let sent = false
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(encoder.encode(chunk))
          return
        }
        controller.error(new TypeError('network error'))
      },
    }),
  )
}

interface Seen {
  steps: TraceStep[]
  text: string[]
  completes: RunOutcome[]
}

function collect(): { seen: Seen; handlers: RunHandlers } {
  const seen: Seen = { steps: [], text: [], completes: [] }
  const handlers: RunHandlers = {
    onStep: (step) => {
      seen.steps.push(step)
    },
    onText: (text) => {
      seen.text.push(text)
    },
    onComplete: (outcome) => {
      seen.completes.push(outcome)
    },
  }
  return { seen, handlers }
}

/** Runs getInsights and returns what it rejected with, or null when it resolved. */
async function failureOf(run: Promise<void>): Promise<unknown> {
  try {
    await run
    return null
  } catch (err) {
    return err
  }
}

const abortOnSignal = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  })

afterEach(() => {
  abortInsights()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('getInsights: streamed frames', () => {
  it('posts the summary, then delivers steps, text and the final outcome in order', async () => {
    const mock = stubFetch(async () =>
      sseResponse([
        'data: {"text":"Hel',
        'lo"}\n\ndata: {"step":{"name":"Stream answer","status":"ok","ms":12,"detail":"2 chunks, 5 characters","tokens":1052}}\n\n',
        'data: {"stage":"complete","result":"Hello","trace":[{"name":"Stream answer","status":"ok","ms":12,"detail":"2 chunks, 5 characters","tokens":1052}],"usage":{"prompt_tokens":812,"completion_tokens":240,"total_tokens":1052,"cost":0.000421},"model":"anthropic/claude-haiku-5.5","totalMs":640}\n\ndata: [DONE]\n\n',
      ]),
    )
    const { seen, handlers } = collect()
    await getInsights(STATS, handlers)

    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0]
    expect(url).toBe('/api/ai')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ summary: STATS })
    // The frame was cut across two network chunks and is delivered whole, as one text delta.
    expect(seen.text).toEqual(['Hello'])
    expect(seen.steps).toEqual([
      { name: 'Stream answer', status: 'ok', ms: 12, detail: '2 chunks, 5 characters', tokens: 1052 },
    ])
    expect(seen.completes).toEqual([
      {
        result: 'Hello',
        trace: [{ name: 'Stream answer', status: 'ok', ms: 12, detail: '2 chunks, 5 characters', tokens: 1052 }],
        usage: { prompt_tokens: 812, completion_tokens: 240, total_tokens: 1052, cost: 0.000421 },
        model: 'anthropic/claude-haiku-5.5',
        totalMs: 640,
      },
    ])
  })

  it('skips a broken frame and keeps reading', async () => {
    stubFetch(async () => sseResponse(['data: {"text":"A"\n\ndata: {"text":"B"}\n\ndata: [DONE]\n\n']))
    const { seen, handlers } = collect()
    await getInsights(STATS, handlers)
    expect(seen.text).toEqual(['B'])
  })

  it('rejects with the plain message from an error frame and keeps the total time', async () => {
    stubFetch(async () =>
      sseResponse([
        'data: {"error":"The AI provider is out of credit, so no analysis could be generated.","totalMs":88}\n\n',
      ]),
    )
    const { handlers } = collect()
    const failure = await failureOf(getInsights(STATS, handlers))
    expect(failure).toBeInstanceOf(RunError)
    expect(failure).toMatchObject({
      message: 'The AI provider is out of credit, so no analysis could be generated.',
      totalMs: 88,
    })
  })

  it('resolves quietly when the stream ends without a complete frame', async () => {
    stubFetch(async () => sseResponse(['data: {"text":"partial"}\n\n']))
    const { seen, handlers } = collect()
    await getInsights(STATS, handlers)
    expect(seen.text).toEqual(['partial'])
    expect(seen.completes).toEqual([])
  })

  it('reports a response with no body as a plain failure', async () => {
    stubFetch(async () => new Response(null, { status: 200 }))
    const { handlers } = collect()
    const failure = await failureOf(getInsights(STATS, handlers))
    expect(failure).toMatchObject({ message: 'The insights service returned no response. Please try again.' })
  })
})

describe('getInsights: error mapping', () => {
  it('maps HTTP failures to plain messages that never include the response body', async () => {
    const cases: { status: number; message: string }[] = [
      { status: 429, message: 'Too many requests. Try again in a minute.' },
      { status: 503, message: 'The insights service is temporarily unavailable. Please try again.' },
      { status: 400, message: 'The insights request could not be completed. Please try again.' },
    ]
    for (const { status, message } of cases) {
      stubFetch(async () => new Response('{"error":"internal detail"}', { status }))
      const { handlers } = collect()
      const failure = await failureOf(getInsights(STATS, handlers))
      expect(failure).toBeInstanceOf(RunError)
      expect(failure).toMatchObject({ message })
    }
  })

  it('reports a request that never reached the server in plain words', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { handlers } = collect()
    const failure = await failureOf(getInsights(STATS, handlers))
    expect(failure).toBeInstanceOf(RunError)
    expect(failure).toMatchObject({ message: NETWORK_MESSAGE })
  })

  it('reports a dropped connection in plain words, after the text that already arrived', async () => {
    stubFetch(async () => dropAfter('data: {"text":"Par"}\n\n'))
    const { seen, handlers } = collect()
    const failure = await failureOf(getInsights(STATS, handlers))
    expect(seen.text).toEqual(['Par'])
    expect(failure).toBeInstanceOf(RunError)
    expect(failure).toMatchObject({ message: NETWORK_MESSAGE })
  })

  it('rejects with an AbortError when the viewer stops the run', async () => {
    stubFetch(abortOnSignal)
    const { handlers } = collect()
    const run = failureOf(getInsights(STATS, handlers))
    abortInsights()
    expect(isAbortError(await run)).toBe(true)
  })

  it('gives up at the client deadline when the server never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stubFetch(abortOnSignal)
    const { handlers } = collect()
    const run = failureOf(getInsights(STATS, handlers))
    await vi.advanceTimersByTimeAsync(40_000)
    expect(await run).toMatchObject({ message: 'The insights service did not answer in time. Try again.' })
  })

  it('does not treat a RunError as an abort', () => {
    expect(isAbortError(new RunError('x'))).toBe(false)
  })
})
