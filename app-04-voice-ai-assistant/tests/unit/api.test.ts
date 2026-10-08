import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunError, chat, transcribe } from '../../src/lib/api'
import { jsonResponse, stubFetch, urlOf, type FetchMock } from '../helpers'

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'
const TIMED_OUT = 'The server did not answer in time. Try again.'

async function failureOf(call: Promise<unknown>): Promise<RunError> {
  try {
    await call
  } catch (err) {
    if (err instanceof RunError) return err
    throw err
  }
  throw new Error('expected the call to fail')
}

function sentBody(mock: FetchMock): Record<string, unknown> {
  return JSON.parse(String(mock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
}

// A response body that fails partway through a read, the way a deadline or a cancel does.
function bodyFailing(name: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(Object.assign(new Error('The body read was aborted'), { name }))
    },
  })
}

describe('chat (browser side)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the reply, the served model, the usage and the server steps', async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({
        result: ' pong ',
        model: 'anthropic/claude-haiku-5.5',
        usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13, cost: 0.0000123 },
        trace: [
          { name: 'request built', status: 'ok', ms: 3, detail: '0 earlier messages, 2 characters' },
          { name: 'model call', status: 'ok', ms: 410, detail: 'anthropic/claude-haiku-5.5', tokens: 13, cost: 0.0000123 },
        ],
        totalMs: 430,
      }),
    )

    const result = await chat('hi', [])

    expect(urlOf(fetchMock)).toBe('/api/ai')
    expect(sentBody(fetchMock)).toEqual({ message: 'hi', history: [] })
    expect(result.text).toBe('pong')
    expect(result.model).toBe('anthropic/claude-haiku-5.5')
    expect(result.usage).toEqual({ prompt_tokens: 12, completion_tokens: 1, total_tokens: 13, cost: 0.0000123 })
    expect(result.trace.map(step => step.name)).toEqual(['request built', 'model call'])
    expect(result.totalMs).toBe(430)
  })

  it('drops trace steps with an unknown status', async () => {
    stubFetch(async () =>
      jsonResponse({
        result: 'ok',
        trace: [
          { name: 'odd', status: 'maybe', ms: 1, detail: 'ignored' },
          { name: 'model call', status: 'ok', ms: 2, detail: 'kept' },
        ],
      }),
    )

    const result = await chat('hi', [])

    expect(result.trace.map(step => step.name)).toEqual(['model call'])
  })

  it('reports a dropped connection with plain copy and a failed step', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await failureOf(chat('hi', []))

    expect(error.message).toBe(UNREACHABLE)
    expect(error.trace).toEqual([
      expect.objectContaining({ name: 'model call', status: 'failed', detail: 'The request did not reach the server' }),
    ])
  })

  it('reports a client deadline with the timeout copy', async () => {
    stubFetch(async () => {
      throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })
    })

    const error = await failureOf(chat('hi', []))

    expect(error.message).toBe(TIMED_OUT)
    expect(error.trace[0]?.detail).toBe('No reply before the time limit')
  })

  it('lets a cancel through as an abort rather than a failed run', async () => {
    const controller = new AbortController()
    controller.abort()
    stubFetch(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })

    const outcome = await chat('hi', [], controller.signal).catch((err: unknown) => err)

    expect(outcome).not.toBeInstanceOf(RunError)
    expect(outcome).toMatchObject({ name: 'AbortError' })
  })

  it('shows the server copy for a failed reply and keeps its steps and total', async () => {
    stubFetch(async () =>
      jsonResponse(
        {
          error: 'The AI provider rejected the key or is out of credit.',
          trace: [{ name: 'model call', status: 'failed', ms: 40, detail: 'HTTP 402 from the AI provider' }],
          totalMs: 52,
        },
        502,
      ),
    )

    const error = await failureOf(chat('hi', []))

    expect(error.message).toBe('The AI provider rejected the key or is out of credit.')
    expect(error.trace[0]?.detail).toBe('HTTP 402 from the AI provider')
    expect(error.totalMs).toBe(52)
  })

  it('falls back to plain copy when a failure is not JSON', async () => {
    stubFetch(async () => new Response('<html>Bad gateway</html>', { status: 502 }))

    const error = await failureOf(chat('hi', []))

    expect(error.message).toBe('The AI provider is unavailable right now. Try again in a moment.')
    expect(error.trace[0]).toMatchObject({ name: 'model call', status: 'failed' })
  })

  it('reads a platform 504, which is not JSON, with the did-not-answer copy', async () => {
    stubFetch(async () => new Response('<html>Gateway Timeout</html>', { status: 504 }))

    const error = await failureOf(chat('hi', []))

    expect(error.message).toBe('The AI provider did not answer in time.')
    expect(error.trace[0]).toMatchObject({ name: 'model call', status: 'failed' })
  })

  it('reports a reply body that times out while it is read as the timeout copy', async () => {
    stubFetch(async () => new Response(bodyFailing('TimeoutError'), { status: 200 }))

    const error = await failureOf(chat('hi', []))

    expect(error.message).toBe(TIMED_OUT)
    expect(error.trace[0]).toMatchObject({
      name: 'model call',
      status: 'failed',
      detail: 'No reply before the time limit',
    })
  })

  it('reports a failed reply whose body times out as the timeout copy', async () => {
    stubFetch(async () => new Response(bodyFailing('TimeoutError'), { status: 502 }))

    const error = await failureOf(chat('hi', []))

    expect(error.message).toBe(TIMED_OUT)
  })

  it('lets a cancel during the body read through as an abort', async () => {
    const controller = new AbortController()
    controller.abort()
    stubFetch(async () => new Response(bodyFailing('AbortError'), { status: 200 }))

    const outcome = await chat('hi', [], controller.signal).catch((err: unknown) => err)

    expect(outcome).not.toBeInstanceOf(RunError)
    expect(outcome).toMatchObject({ name: 'AbortError' })
  })

  it('refuses an empty reply', async () => {
    stubFetch(async () => jsonResponse({ result: '  ', trace: [] }))

    const error = await failureOf(chat('hi', []))

    expect(error.message).toBe('The assistant returned an empty response. Try again.')
  })
})

describe('transcribe (browser side)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the transcript the server heard and sends the clip as JSON', async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse({
        result: 'pong',
        model: 'nova-3',
        trace: [{ name: 'speech to text', status: 'ok', ms: 500, detail: 'nova-3' }],
        totalMs: 520,
      }),
    )

    const result = await transcribe({ data: 'AAAA', format: 'wav' })

    expect(urlOf(fetchMock)).toBe('/api/transcribe')
    expect(sentBody(fetchMock)).toEqual({ audio: 'AAAA', format: 'wav' })
    expect(result).toMatchObject({ text: 'pong', model: 'nova-3', totalMs: 520 })
  })

  it('reports a dropped connection with the same plain copy', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await failureOf(transcribe({ data: 'AAAA', format: 'wav' }))

    expect(error.message).toBe(UNREACHABLE)
    expect(error.trace[0]).toMatchObject({ name: 'speech to text', status: 'failed' })
  })

  it('reads a platform 504, which is not JSON, with the transcription copy', async () => {
    stubFetch(async () => new Response('<html>Gateway Timeout</html>', { status: 504 }))

    const error = await failureOf(transcribe({ data: 'AAAA', format: 'wav' }))

    expect(error.message).toBe('The transcription service did not answer in time.')
  })

  it('reports an upload the platform refused as too long', async () => {
    stubFetch(async () => new Response('Payload Too Large', { status: 413 }))

    const error = await failureOf(transcribe({ data: 'AAAA', format: 'wav' }))

    expect(error.message).toBe('That recording is too long to send. Try a shorter one.')
  })
})
