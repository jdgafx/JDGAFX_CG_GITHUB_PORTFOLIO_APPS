import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL, replyText, runModelCall, type Turn } from '../../netlify/shared/provider'
import { createRecorder } from '../../netlify/shared/trace'
import { PLACEHOLDER, headerOf, jsonResponse, sentRequest, stubFetch } from '../helpers'

const TURNS: Turn[] = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'Reply with the single word: pong' },
]

const OK_REPLY = {
  model: 'anthropic/claude-haiku-5.5',
  choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13, cost: 0.0000123 },
}

const EMPTY_REPLY = {
  model: 'anthropic/claude-haiku-5.5',
  choices: [{ message: { content: '' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, cost: 0.00001 },
}

const FIVE_SECONDS = 5_000
const TWENTY_FIVE_SECONDS = 25_000

describe('runModelCall', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends the fixed model with the token cap, usage reporting and reasoning off', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, createRecorder())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(headerOf(fetchMock, 0, 'authorization')).toBe(`Bearer ${PLACEHOLDER}`)
    expect(sentRequest(fetchMock)).toEqual({
      model: MODEL,
      max_tokens: 256,
      reasoning: { enabled: false },
      usage: { include: true },
      messages: TURNS,
    })
  })

  it('returns the reply, the served model, the usage and one model call step', async () => {
    stubFetch(async () => jsonResponse(OK_REPLY))
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, run)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected a reply')
    expect(replyText(outcome.completion)).toBe('pong')
    expect(outcome.usage).toEqual({ prompt_tokens: 12, completion_tokens: 1, total_tokens: 13, cost: 0.0000123 })
    expect(run.steps).toHaveLength(1)
    expect(run.steps[0]).toMatchObject({
      name: 'model call',
      status: 'ok',
      detail: 'anthropic/claude-haiku-5.5',
      tokens: 13,
      cost: 0.0000123,
    })
  })

  it('totals tokens and cost across an empty first reply and the retry', async () => {
    let calls = 0
    const fetchMock = stubFetch(async () => {
      calls += 1
      return jsonResponse(calls === 1 ? EMPTY_REPLY : OK_REPLY)
    })
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, run)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    if (!outcome.ok) throw new Error('expected a reply')
    expect(replyText(outcome.completion)).toBe('pong')
    expect(outcome.usage?.prompt_tokens).toBe(22)
    expect(outcome.usage?.completion_tokens).toBe(1)
    expect(outcome.usage?.total_tokens).toBe(23)
    expect(outcome.usage?.cost).toBeCloseTo(0.0000223, 12)
    expect(run.steps[0]?.tokens).toBe(23)
    expect(run.steps[0]?.detail).toBe('anthropic/claude-haiku-5.5, retried once after an empty reply')
  })

  it('does not retry when less than the retry window is left in the budget', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(EMPTY_REPLY))

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + FIVE_SECONDS }, createRecorder())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected a reply')
    expect(replyText(outcome.completion)).toBe('')
  })

  it('makes no call when the run budget is already spent', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() - 1 }, run)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(outcome).toEqual({ ok: false, httpStatus: 503, message: 'The AI provider did not answer in time.' })
    expect(run.steps[0]?.detail).toBe('No time left in the run budget')
  })

  it('maps a 402 to the key-or-credit copy and keeps the vendor text out of the outcome', async () => {
    stubFetch(async () => jsonResponse({ error: 'Insufficient credits for account acct_5530' }, 402))
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, run)

    expect(outcome).toEqual({
      ok: false,
      httpStatus: 502,
      message: 'The AI provider rejected the key or is out of credit.',
    })
    expect(JSON.stringify(outcome)).not.toContain('acct_5530')
    expect(run.steps[0]).toMatchObject({ name: 'model call', status: 'failed', detail: 'HTTP 402 from the AI provider' })
  })

  it('maps a 429 to a 429 with the rate limit copy', async () => {
    stubFetch(async () => new Response('slow down', { status: 429 }))

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, createRecorder())

    expect(outcome).toEqual({ ok: false, httpStatus: 429, message: 'Rate limited, try again in a minute.' })
  })

  it('maps a 500 to a 503 with the did-not-answer copy', async () => {
    stubFetch(async () => new Response('boom', { status: 500 }))

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, createRecorder())

    expect(outcome).toEqual({ ok: false, httpStatus: 503, message: 'The AI provider did not answer in time.' })
  })

  it.each(['TimeoutError', 'AbortError'])('maps a %s deadline to the did-not-answer copy', async name => {
    stubFetch(async () => {
      throw Object.assign(new Error('late'), { name })
    })
    const run = createRecorder()

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, run)

    expect(outcome).toEqual({ ok: false, httpStatus: 503, message: 'The AI provider did not answer in time.' })
    expect(run.steps[0]?.detail).toBe('No reply before the time limit')
  })

  it('maps a dropped connection to the could-not-be-reached copy', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed: ECONNRESET 203.0.113.9')
    })

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, createRecorder())

    expect(outcome).toEqual({
      ok: false,
      httpStatus: 503,
      message: 'The AI provider could not be reached. Try again in a moment.',
    })
  })

  it('refuses a reply that is not JSON', async () => {
    stubFetch(async () => new Response('<html>', { status: 200 }))

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, createRecorder())

    expect(outcome).toEqual({ ok: false, httpStatus: 502, message: 'The AI provider returned an unreadable response.' })
  })

  it('refuses a reply that is JSON but not an object', async () => {
    stubFetch(async () => new Response('null', { status: 200 }))

    const outcome = await runModelCall(PLACEHOLDER, TURNS, { maxTokens: 256, deadlineAt: Date.now() + TWENTY_FIVE_SECONDS }, createRecorder())

    expect(outcome).toEqual({ ok: false, httpStatus: 502, message: 'The AI provider returned an unreadable response.' })
  })
})

describe('replyText', () => {
  it('returns the trimmed text of the first choice', () => {
    expect(replyText({ choices: [{ message: { content: '  pong \n' } }] })).toBe('pong')
  })

  it('returns an empty string when there is no text', () => {
    expect(replyText({})).toBe('')
    expect(replyText({ choices: [{ message: { content: 7 } }] })).toBe('')
  })
})
