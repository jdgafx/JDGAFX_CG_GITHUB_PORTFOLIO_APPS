import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResearchError, isAbortError, processSSELines, runErrorMessage, startResearch } from '../../src/lib/api'
import type { StreamEvent } from '../../src/types'

const encoder = new TextEncoder()

function eventStream(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** Resolves to the error a rejected run produced, and fails the test if the run succeeded. */
async function failureOf(run: Promise<void>): Promise<unknown> {
  try {
    await run
  } catch (err) {
    return err
  }
  throw new Error('expected the run to fail')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('processSSELines', () => {
  it('delivers typed events, skips noise, and stops at the end marker', () => {
    const received: StreamEvent[] = []
    const ended = processSSELines(
      [
        'data: {"type":"agent_start","agent":"researcher","maxTokens":600}',
        ': keep-alive',
        'data: not json',
        'data: 42',
        'data: {"no":"type"}',
        'data: {"type":"agent_chunk","agent":"researcher","content":"Facts"}',
        'data: [DONE]',
        'data: {"type":"agent_error","agent":"system","error":"late"}',
      ],
      event => received.push(event),
    )
    expect(ended).toBe(true)
    expect(received).toEqual([
      { type: 'agent_start', agent: 'researcher', maxTokens: 600 },
      { type: 'agent_chunk', agent: 'researcher', content: 'Facts' },
    ])
  })

  it('reports no end marker when the lines do not contain one', () => {
    const received: StreamEvent[] = []
    const ended = processSSELines(
      ['data: {"type":"agent_skipped","agent":"critic","detail":"Not started."}'],
      event => received.push(event),
    )
    expect(ended).toBe(false)
    expect(received).toEqual([{ type: 'agent_skipped', agent: 'critic', detail: 'Not started.' }])
  })
})

describe('startResearch', () => {
  it('posts the query and reads frames that arrive split across chunks', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      eventStream([
        'data: {"type":"agent_start","agent":"researcher","maxTokens":600}\n\ndata: {"type":"agent_chunk","agent":"rese',
        'archer","content":"Facts"}\n\ndata: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const received: StreamEvent[] = []
    await startResearch('Why?', event => received.push(event))

    expect(received).toEqual([
      { type: 'agent_start', agent: 'researcher', maxTokens: 600 },
      { type: 'agent_chunk', agent: 'researcher', content: 'Facts' },
    ])
    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe('/.netlify/functions/ai')
    expect(call?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ query: 'Why?' })
  })

  it('shows the server plain-language error from a JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'Missing query.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const failure = await failureOf(startResearch('', () => undefined))
    expect(failure).toBeInstanceOf(ResearchError)
    expect(runErrorMessage(failure)).toBe('Missing query.')
  })

  it('never shows a raw response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>internal trace</html>', { status: 500 })),
    )
    const failure = await failureOf(startResearch('q', () => undefined))
    expect(runErrorMessage(failure)).toBe('The server could not start the run. Try again.')
  })

  it('uses the rate-limit wording for a 429 with no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    const failure = await failureOf(startResearch('q', () => undefined))
    expect(runErrorMessage(failure)).toBe('Rate limited, try again in a minute.')
  })

  it('says the server cannot be reached when the request fails in the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const failure = await failureOf(startResearch('q', () => undefined))
    expect(failure).toBeInstanceOf(ResearchError)
    expect(runErrorMessage(failure)).toBe('Could not reach the server. Check your connection and try again.')
  })

  it('refuses a 200 response that is not an event stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
    )
    const failure = await failureOf(startResearch('q', () => undefined))
    expect(runErrorMessage(failure)).toBe(
      'The research endpoint is not responding correctly. Check that the site functions are deployed.',
    )
  })

  it('ends quietly and cancels the stream when the visitor stops the run', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"agent_start","agent":"researcher","maxTokens":600}\n\n'))
      },
      cancel: cancelled,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ),
    )

    const stop = new AbortController()
    const received: StreamEvent[] = []
    await startResearch(
      'q',
      event => {
        received.push(event)
        stop.abort()
      },
      stop.signal,
    )

    expect(received).toHaveLength(1)
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it('gives up on a stream that stops sending and cancels it', async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Sends nothing, so the read timer has to end the run.
      },
      cancel: cancelled,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ),
    )

    const run = failureOf(startResearch('q', () => undefined))
    await vi.advanceTimersByTimeAsync(60_000)
    const failure = await run

    expect(runErrorMessage(failure)).toBe('The server stopped sending data. Try again.')
    expect(cancelled).toHaveBeenCalledTimes(1)
  })
})

describe('error messages', () => {
  it('shows only messages written for the visitor', () => {
    expect(runErrorMessage(new ResearchError('Rate limited, try again in a minute.'))).toBe(
      'Rate limited, try again in a minute.',
    )
    expect(runErrorMessage(new TypeError('Cannot read properties of undefined'))).toBe(
      'The run stopped unexpectedly. Try again.',
    )
  })

  it('recognises the abort that a Stop press causes', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
  })
})
