import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planTask, RequestFailure, streamRun } from '../../src/lib/api'
import type { BotStep, RunEvent } from '../../src/types'

const NETWORK = 'Could not reach the server. Check your connection and try again.'
const UNREADABLE = 'The browser run sent a message the page could not read.'
const steps: BotStep[] = [{ action: 'navigate', target: 'Google home page', thought: 'Open it.', url: 'https://www.google.com/' }]

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A response whose body arrives as the given chunks, one read per chunk. */
function sse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function signal(): AbortSignal {
  return new AbortController().signal
}

describe('planTask', () => {
  it('posts the task and keeps only well-formed steps and trace entries', async () => {
    fetchMock.mockResolvedValueOnce(json({
      result: {
        steps: [
          { action: 'navigate', target: 'Google home page', thought: 'Open it.', url: 'https://www.google.com/' },
          { action: 'extract', target: 'page title', thought: 'Read it.', value: 'The page title' },
          { action: 'delete', target: 'file', thought: 'Not a valid action.' },
        ],
      },
      trace: [
        { name: 'Model call', status: 'ok', ms: 812, detail: 'Served by m.', tokens: 976, cost: 0.00042 },
        { name: 'Odd row', status: 'pending', ms: 1, detail: '' },
      ],
      usage: { prompt_tokens: 812, completion_tokens: 164, total_tokens: 976, cost: 0.00042 },
      model: 'anthropic/claude-haiku-5.5',
      totalMs: 1500,
    }))

    const plan = await planTask('Open google.com and report the page title.', signal())

    expect(plan.result.steps).toEqual([
      { action: 'navigate', target: 'Google home page', thought: 'Open it.', url: 'https://www.google.com/' },
      { action: 'extract', target: 'page title', thought: 'Read it.', value: 'The page title' },
    ])
    expect(plan.trace).toEqual([{ name: 'Model call', status: 'ok', ms: 812, detail: 'Served by m.', tokens: 976, cost: 0.00042 }])
    expect(plan.usage).toEqual({ prompt_tokens: 812, completion_tokens: 164, total_tokens: 976, cost: 0.00042 })
    expect(plan.model).toBe('anthropic/claude-haiku-5.5')
    expect(plan.totalMs).toBe(1500)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/ai')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ task: 'Open google.com and report the page title.' })
  })

  it('reports null usage figures as null, not as zero', async () => {
    fetchMock.mockResolvedValueOnce(json({
      result: { steps: [{ action: 'extract', target: 'page title', thought: 'Read it.' }] },
      usage: { total_tokens: 'many', cost: 'free' },
    }))
    const plan = await planTask('x', signal())
    expect(plan.usage).toEqual({ prompt_tokens: null, completion_tokens: null, total_tokens: null, cost: null })
    expect(plan.model).toBeNull()
    expect(plan.totalMs).toBe(0)
  })

  it('shows the server curated error and its trace, never a raw body', async () => {
    fetchMock.mockResolvedValueOnce(json({
      error: 'The AI provider rejected the key or is out of credit',
      trace: [{ name: 'Model call', status: 'failed', ms: 40, detail: 'The AI provider rejected the key or is out of credit' }],
    }, 502))
    const failure = await planTask('x', signal()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RequestFailure)
    expect(failure).toMatchObject({ message: 'The AI provider rejected the key or is out of credit' })
    expect((failure as RequestFailure).trace).toEqual([
      { name: 'Model call', status: 'failed', ms: 40, detail: 'The AI provider rejected the key or is out of credit', tokens: undefined, cost: undefined },
    ])
  })

  it('uses plain status copy for a server error that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>internal stack trace</html>', { status: 500 }))
    const failure = await planTask('x', signal()).catch((error: unknown) => error)
    expect(failure).toMatchObject({ message: 'The AI provider did not answer in time' })
    expect((failure as Error).message).not.toContain('stack')
  })

  it('maps a 429 with no body to the rate-limit copy', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))
    await expect(planTask('x', signal())).rejects.toMatchObject({ message: 'Rate limited, try again in a minute' })
  })

  it('names the HTTP status for any other failure without a message', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(planTask('x', signal())).rejects.toMatchObject({ message: 'The request failed with HTTP 404. Try again in a moment.' })
  })

  it('maps a dropped connection to the network copy', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(planTask('x', signal())).rejects.toMatchObject({ message: NETWORK })
  })

  it('lets a cancelled request through unchanged, so the caller can ignore it', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(() => {
      controller.abort()
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
    const error = await planTask('x', controller.signal).catch((caught: unknown) => caught)
    expect(error).not.toBeInstanceOf(RequestFailure)
    expect((error as Error).name).toBe('AbortError')
  })

  it('refuses a plan with no usable steps', async () => {
    fetchMock.mockResolvedValueOnce(json({ result: { steps: [{ action: 'delete', target: 'x', thought: 'y' }] } }))
    await expect(planTask('x', signal())).rejects.toMatchObject({ message: 'The agent returned no usable steps for this task.' })
  })
})

describe('streamRun', () => {
  it('parses events across chunk boundaries, skips comments, and delivers a final record with no blank line', async () => {
    fetchMock.mockResolvedValueOnce(sse([
      'data: {"type":"session","sessionId":"sess_1"}\n\n: ping\n\ndata: {"type":"stage",',
      '"name":"Open browser session","status":"ok","ms":12,"detail":"Browser session started."}\n\n',
      'data: {"type":"done","totalMs":88}',
    ]))
    const events: RunEvent[] = []
    await streamRun(steps, (event) => events.push(event), signal())
    expect(events).toEqual([
      { type: 'session', sessionId: 'sess_1' },
      { type: 'stage', name: 'Open browser session', status: 'ok', ms: 12, detail: 'Browser session started.' },
      { type: 'done', totalMs: 88 },
    ])
  })

  it('posts the steps to the execute route', async () => {
    fetchMock.mockResolvedValueOnce(sse([]))
    await streamRun(steps, () => undefined, signal())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/execute')
    expect(JSON.parse(String(init?.body))).toEqual({ steps })
  })

  it('reports a refused run with the server text', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'The browser provider is out of credit, so no session was started.' }, 502))
    await expect(streamRun(steps, () => undefined, signal())).rejects.toMatchObject({
      message: 'The browser provider is out of credit, so no session was started.',
    })
  })

  it('delivers the events before a malformed frame, then fails in plain words', async () => {
    fetchMock.mockResolvedValueOnce(sse(['data: {"type":"session","sessionId":"sess_2"}\n\ndata: {not json}\n\n']))
    const events: RunEvent[] = []
    await expect(streamRun(steps, (event) => events.push(event), signal())).rejects.toMatchObject({ message: UNREADABLE })
    expect(events).toEqual([{ type: 'session', sessionId: 'sess_2' }])
  })

  it('rejects an event type the page does not know', async () => {
    fetchMock.mockResolvedValueOnce(sse(['data: {"type":"mystery"}\n\n']))
    await expect(streamRun(steps, () => undefined, signal())).rejects.toMatchObject({ message: UNREADABLE })
  })

  it('treats a record cut off by the end of the stream as an early end, not as unreadable', async () => {
    fetchMock.mockResolvedValueOnce(sse(['data: {"type":"session","sessionId":"sess_3"}\n\ndata: {"type":"stage","na']))
    const events: RunEvent[] = []
    await expect(streamRun(steps, (event) => events.push(event), signal())).resolves.toBeUndefined()
    expect(events).toEqual([{ type: 'session', sessionId: 'sess_3' }])
  })

  it('cancels the body when a listener throws, so the connection is not left open', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"session","sessionId":"sess_4"}\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }))
    await expect(streamRun(steps, () => { throw new Error('listener failed') }, signal())).rejects.toThrow('listener failed')
    expect(cancelled).toBe(true)
  })

  it('maps a dropped stream to the network copy', async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError('network down'))
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(broken, { status: 200 }))
    await expect(streamRun(steps, () => undefined, signal())).rejects.toMatchObject({ message: NETWORK })
  })
})
