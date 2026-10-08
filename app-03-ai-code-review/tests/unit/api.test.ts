import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewError, reviewCode, reviewErrorMessage } from '../../src/lib/api'

const NETWORK = 'Could not reach the server. Check your connection and try again.'
const GENERIC = 'The review service is unavailable right now. Please try again.'
const TIMEOUT = 'The AI provider did not answer in time.'
const RATE_LIMITED = 'Rate limited, try again in a minute.'

type FetchStub = (input: string, init: RequestInit) => Promise<Response>
const fetchStub = vi.fn<FetchStub>()

beforeEach(() => {
  fetchStub.mockReset()
  fetchStub.mockRejectedValue(new Error('unexpected network call'))
  vi.stubGlobal('fetch', fetchStub)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected the review to fail')
}

describe('reviewCode: failures shown to the user', () => {
  it('maps a browser network failure to the plain-language message', async () => {
    fetchStub.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await failureOf(reviewCode('x = 1', 'python'))
    expect(err).toBeInstanceOf(ReviewError)
    expect((err as ReviewError).message).toBe(NETWORK)
    expect((err as ReviewError).summary.trace[0]).toMatchObject({
      name: 'Send request',
      status: 'failed',
      detail: 'Could not reach the server',
    })
  })

  it('shows the server plain-language error for a rejected request', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Paste some code to review.', trace: [], usage: null, model: null, totalMs: 4 }, 400),
    )
    const err = await failureOf(reviewCode('   ', 'python'))
    expect((err as ReviewError).message).toBe('Paste some code to review.')
  })

  it('hides a non-JSON server failure behind the generic message', async () => {
    fetchStub.mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    const err = await failureOf(reviewCode('x = 1', 'python'))
    expect((err as ReviewError).message).toBe(GENERIC)
  })

  it('uses the rate-limit copy for a 429 that carries no message', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({}, 429))
    const err = await failureOf(reviewCode('x = 1', 'python'))
    expect((err as ReviewError).message).toBe(RATE_LIMITED)
  })

  it('uses the timeout copy and keeps the trace when the server times out', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          error: TIMEOUT,
          trace: [{ name: 'Model call', status: 'failed', ms: 25000, detail: 'Timed out after 25 s' }],
          usage: null,
          model: null,
          totalMs: 25100,
        },
        504,
      ),
    )
    const err = (await failureOf(reviewCode('x = 1', 'python'))) as ReviewError
    expect(err.message).toBe(TIMEOUT)
    expect(err.summary.trace[0]).toEqual({ name: 'Model call', status: 'failed', ms: 25000, detail: 'Timed out after 25 s' })
    expect(err.summary.totalMs).toBe(25100)
  })

  it('uses the timeout copy when the browser gives up waiting', async () => {
    fetchStub.mockRejectedValueOnce(new DOMException('Request timed out', 'TimeoutError'))
    const err = (await failureOf(reviewCode('x = 1', 'python'))) as ReviewError
    expect(err.message).toBe(TIMEOUT)
    expect(err.summary.trace[0].detail).toBe('No answer from the server in time')
  })

  it('rethrows a user cancel as an abort, not as a review error', async () => {
    const controller = new AbortController()
    fetchStub.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const pending = failureOf(reviewCode('x = 1', 'python', controller.signal))
    controller.abort()
    const err = await pending
    expect(err).not.toBeInstanceOf(ReviewError)
    expect((err as Error).name).toBe('AbortError')
  })
})

describe('reviewErrorMessage', () => {
  it('shows only a review error message and hides any other error', () => {
    expect(reviewErrorMessage(new TypeError('Failed to fetch'))).toBe(GENERIC)
    expect(reviewErrorMessage(new Error('internal detail'))).toBe(GENERIC)
    expect(reviewErrorMessage(new ReviewError(NETWORK, { trace: [], usage: null, model: null, totalMs: 0 }))).toBe(NETWORK)
  })
})

describe('reviewCode: a completed run', () => {
  it('normalises the comments, trace, usage and model the server returned', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        result: {
          comments: [
            { line: 2, severity: 'critical', message: 'Division by zero', suggestion: 'Check b first' },
            { line: 1, severity: 'praise', message: 'Not a severity we show', suggestion: 'n/a' },
          ],
          lineCount: 2,
          truncated: false,
        },
        trace: [
          { name: 'Model call', status: 'ok', ms: 1200, detail: 'Reply received', tokens: 150, cost: 0.00015 },
          { name: 'Made up', status: 'done', ms: 1, detail: '' },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00015, extra: 'ignored' },
        model: '~anthropic/claude-haiku-latest',
        totalMs: 1300,
      }),
    )
    const run = await reviewCode('def divide(a, b):\n    return a / b', 'python')
    expect(run.result).toEqual({
      comments: [{ line: 2, severity: 'critical', message: 'Division by zero', suggestion: 'Check b first' }],
      lineCount: 2,
      truncated: false,
    })
    expect(run.trace).toEqual([
      { name: 'Model call', status: 'ok', ms: 1200, detail: 'Reply received', tokens: 150, cost: 0.00015 },
    ])
    expect(run.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00015 })
    expect(run.model).toBe('~anthropic/claude-haiku-latest')
    expect(run.totalMs).toBe(1300)
  })

  it('reports no usage and no model when the provider sent no numbers or name', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        result: { comments: [], lineCount: 1, truncated: false },
        trace: [],
        usage: { total_tokens: 'many' },
        model: null,
        totalMs: 9,
      }),
    )
    const run = await reviewCode('x = 1', 'python')
    expect(run.usage).toBeNull()
    expect(run.model).toBeNull()
    expect(run.result.comments).toEqual([])
  })

  it('sends only the code and language, never a model choice', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({ success: true, result: { comments: [], lineCount: 1, truncated: false }, trace: [], usage: null, model: null, totalMs: 1 }),
    )
    await reviewCode('x = 1', 'python')
    const [url, init] = fetchStub.mock.calls[0]
    expect(url).toBe('/api/ai')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ code: 'x = 1', language: 'python' })
  })
})
