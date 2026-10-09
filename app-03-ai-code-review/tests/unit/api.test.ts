import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewError, reviewCode, reviewErrorMessage, reviewPullRequest } from '../../src/lib/api'

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
    fetchStub.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await failureOf(reviewCode('x = 1', 'python'))
    expect(err).toBeInstanceOf(ReviewError)
    expect((err as ReviewError).message).toBe(NETWORK)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect((err as ReviewError).summary.trace.map((s) => [s.name, s.status, s.detail])).toEqual([
      ['Send request', 'failed', 'Could not reach the server. Retried once'],
      ['Send request', 'failed', 'Could not reach the server'],
    ])
  })

  it('retries once after a dropped connection and keeps the failed try in the trace of the run that succeeds', async () => {
    fetchStub.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchStub.mockResolvedValueOnce(jsonResponse({ success: true, result: { comments: [], lineCount: 1, truncated: false, verified: true, malformed: 0, mode: 'file', pr: null }, trace: [{ name: 'Check request', status: 'ok', ms: 3, detail: 'go' }], usage: null, model: null, totalMs: 1 }))
    const run = await reviewCode('x = 1', 'python')
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(run.trace.map((s) => s.name)).toEqual(['Send request', 'Check request'])
    expect(run.trace[0]).toMatchObject({ status: 'failed', detail: 'Could not reach the server. Retried once' })
  })

  it('retries once when the reply starts and ends before its JSON does (the ERR_ABORTED case), then explains it', async () => {
    fetchStub.mockImplementation(async () => new Response('{"success":tr', { status: 200 }))
    const err = (await failureOf(reviewCode('x = 1', 'python'))) as ReviewError
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(err.message).toBe('The connection dropped before the review finished. Please try again.')
    expect(err.summary.trace.length).toBe(2)
    expect(err.summary.trace[0].detail).toMatch(/connection dropped before the reply finished \(HTTP 200\)\. Retried once/)
  })

  it.each([400, 429, 500, 502, 504])('never retries an HTTP %i answer', async (status) => {
    fetchStub.mockResolvedValue(jsonResponse({ success: false, error: 'no', trace: [], usage: null, model: null, totalMs: 1 }, status))
    await failureOf(reviewCode('x = 1', 'python'))
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('never retries a timeout', async () => {
    fetchStub.mockRejectedValue(new DOMException('Request timed out', 'TimeoutError'))
    await failureOf(reviewCode('x = 1', 'python'))
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('gives an error with an empty trace one row that says what was seen, so the trace is never blank', async () => {
    fetchStub.mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    const err = (await failureOf(reviewCode('x = 1', 'python'))) as ReviewError
    expect(err.summary.trace).toMatchObject([{ name: 'Send request', status: 'failed', detail: 'The server answered HTTP 502 without a trace' }])
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

const BASE = { lineCount: 2, truncated: false, verified: true, malformed: 0, mode: 'file', pr: null }

describe('reviewCode: a completed run', () => {
  const okRun = (overrides: Record<string, unknown> = {}) => ({
    success: true,
    result: { comments: [], lineCount: 1, truncated: false, verified: true, malformed: 0, mode: 'file', pr: null },
    trace: [],
    usage: null,
    model: null,
    totalMs: 1,
    ...overrides,
  })

  const COMMENT = {
    id: 1, line: 2, fromLine: 2, severity: 'critical', message: 'Division by zero', suggestion: 'Check b first',
    verdict: 'kept', decidedBy: 'verifier', reason: 'return a / b has no guard.', evidence: 'return a / b', code: '    return a / b', where: null,
  }

  it('returns the comments, trace, usage and model the server sent', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse(
        okRun({
          result: { comments: [COMMENT], lineCount: 2, truncated: false, verified: true, malformed: 0, mode: 'file', pr: null },
          trace: [{ name: 'Pass 1: review', status: 'ok', ms: 1200, at: 10, detail: 'Reply received', tokens: 150, cost: 0.00015 }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00015 },
          model: 'anthropic/claude-haiku-5.5',
          totalMs: 1300,
        }),
      ),
    )
    const run = await reviewCode('def divide(a, b):\n    return a / b', 'python')
    expect(run.result.comments).toEqual([COMMENT])
    expect(run.result).toMatchObject({ verified: true, mode: 'file', lineCount: 2 })
    expect(run.trace).toEqual([{ name: 'Pass 1: review', status: 'ok', ms: 1200, at: 10, detail: 'Reply received', tokens: 150, cost: 0.00015 }])
    expect(run.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00015 })
    expect(run.model).toBe('anthropic/claude-haiku-5.5')
    expect(run.totalMs).toBe(1300)
  })

  it('reports no usage when a figure is not a number', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse(okRun({ usage: { total_tokens: 'many' } })))
    const run = await reviewCode('x = 1', 'python')
    expect(run.usage).toBeNull()
    expect(run.model).toBeNull()
    expect(run.result.comments).toEqual([])
  })

  it.each([
    ['a comment with a severity the page does not show', { ...BASE, comments: [{ ...COMMENT, severity: 'praise' }] }],
    ['a comment whose line is not a number', { ...BASE, comments: [{ ...COMMENT, line: '1' }] }],
    ['a comment with a verdict the page does not know', { ...BASE, comments: [{ ...COMMENT, verdict: 'maybe' }] }],
    ['a comment that is missing its reason', { ...BASE, comments: [{ ...COMMENT, reason: undefined }] }],
    ['a result without a line count', { comments: [], truncated: false, verified: true, malformed: 0, mode: 'file', pr: null }],
    ['a result that does not say whether the second pass ran', { comments: [], lineCount: 1, truncated: false, malformed: 0, mode: 'file', pr: null }],
    ['a result whose comments are not a list', { ...BASE, comments: 'none' }],
  ])('refuses a reply with %s, so it never reaches the screen', async (_name, result) => {
    fetchStub.mockResolvedValueOnce(jsonResponse(okRun({ result })))
    const err = await failureOf(reviewCode('x = 1', 'python'))
    expect(err).toBeInstanceOf(ReviewError)
    expect((err as ReviewError).message).toBe(GENERIC)
  })

  it('refuses a success reply that carries no result at all', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse({ success: true }))
    const err = await failureOf(reviewCode('x = 1', 'python'))
    expect((err as ReviewError).message).toBe(GENERIC)
  })

  it('sends only the code and language, never a model choice', async () => {
    fetchStub.mockResolvedValueOnce(
      jsonResponse({ success: true, result: { comments: [], lineCount: 1, truncated: false, verified: true, malformed: 0, mode: 'file', pr: null }, trace: [], usage: null, model: null, totalMs: 1 }),
    )
    await reviewCode('x = 1', 'python')
    const [url, init] = fetchStub.mock.calls[0]
    expect(url).toBe('/api/ai')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ code: 'x = 1', language: 'python' })
  })

  it('sends a pull request as its chosen files, exactly as GitHub listed them', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse(okRun({ result: { ...BASE, comments: [], mode: 'pr', pr: { filesIncluded: 1, changedIncluded: 2, charsIncluded: 40, charLimit: 50000 } } })))
    const files = [{ path: 'a.go', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }]
    const run = await reviewPullRequest(files)
    expect(JSON.parse(String(fetchStub.mock.calls[0][1].body))).toEqual({ mode: 'pr', files })
    expect(run.result.pr).toEqual({ filesIncluded: 1, changedIncluded: 2, charsIncluded: 40, charLimit: 50000 })
  })

  it('refuses a pull request result whose counts are not numbers', async () => {
    fetchStub.mockResolvedValueOnce(jsonResponse(okRun({ result: { ...BASE, comments: [], mode: 'pr', pr: { filesIncluded: 'one' } } })))
    expect(((await failureOf(reviewPullRequest([]))) as ReviewError).message).toBe(GENERIC)
  })
})
