import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import { MODEL } from '../../netlify/shared/provider'
import {
  ORIGIN,
  PLACEHOLDER,
  bodyOf,
  headerOf,
  jsonResponse,
  request,
  restoreEnv,
  sentRequest,
  setEnv,
  stubFetch,
  urlOf,
} from '../helpers'

const URL_AI = 'http://localhost/api/ai'
const EARLIER_BAD = 'The earlier messages could not be read. Clear the conversation and try again.'
const LABEL = 'The model returned a label instead of a reply. Try again.'

const OK_REPLY = {
  model: 'anthropic/claude-haiku-5.5',
  choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13, cost: 0.0000123 },
}

function replyWith(content: string, model = 'anthropic/claude-haiku-5.5') {
  return { model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }
}

describe('ai function', () => {
  beforeEach(() => {
    setEnv('OPENROUTER_API_KEY', PLACEHOLDER)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    restoreEnv()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('answers a message through the fixed model and reports tokens and cost', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { json: { message: 'Reply with the single word: pong', history: [] } }))

    expect(res.status).toBe(200)
    const body = await bodyOf(res)
    expect(body.result).toBe('pong')
    expect(body.model).toBe('anthropic/claude-haiku-5.5')
    expect(body.usage?.total_tokens).toBe(13)
    expect(body.usage?.cost).toBe(0.0000123)
    expect(body.trace?.map(step => [step.name, step.status])).toEqual([
      ['request built', 'ok'],
      ['model call', 'ok'],
      ['parse and validate', 'ok'],
    ])
    expect(body.trace?.[1]?.detail).toBe('anthropic/claude-haiku-5.5')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(urlOf(fetchMock)).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(headerOf(fetchMock, 0, 'authorization')).toBe(`Bearer ${PLACEHOLDER}`)

    const sent = sentRequest(fetchMock)
    expect(sent.model).toBe(MODEL)
    expect(sent.max_tokens).toBe(1024)
    expect(sent.usage).toEqual({ include: true })
    expect(sent.reasoning).toEqual({ enabled: false })
    expect(sent.messages.at(-1)).toEqual({ role: 'user', content: 'Reply with the single word: pong' })
  })

  it('ignores a model name sent by the browser', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    await handler(request(URL_AI, { json: { message: 'hi', model: 'vendor/other-model' } }))

    expect(sentRequest(fetchMock).model).toBe(MODEL)
  })

  it('sends earlier turns in order, then the new message', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))
    const history = [
      { role: 'user', content: 'What is two plus two?' },
      { role: 'assistant', content: 'Four.' },
    ]

    await handler(request(URL_AI, { json: { message: 'And times three?', history } }))

    expect(sentRequest(fetchMock).messages.slice(1)).toEqual([...history, { role: 'user', content: 'And times three?' }])
  })

  it('answers a preflight from an allowed origin with 204', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { method: 'OPTIONS' }))

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 405 to a GET request', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { method: 'GET' }))

    expect(res.status).toBe(405)
    expect((await bodyOf(res)).error).toBe('Method not allowed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 403 for an origin that is not allowed', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { json: { message: 'hi' }, origin: 'https://evil.example' }))

    expect(res.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('Origin not allowed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing message', {}, 'Type or say a message first.'],
    ['a message of spaces only', { message: '   ' }, 'Type or say a message first.'],
    ['a message that is not text', { message: 42 }, 'Type or say a message first.'],
    ['a message over the limit', { message: 'x'.repeat(5001) }, 'Keep messages under 5000 characters.'],
    ['a history that is not a list', { message: 'hi', history: 'nope' }, EARLIER_BAD],
    ['a history entry with another role', { message: 'hi', history: [{ role: 'system', content: 'x' }] }, EARLIER_BAD],
    ['a history entry without text', { message: 'hi', history: [{ role: 'user', content: 5 }] }, EARLIER_BAD],
    ['a history entry that is not an object', { message: 'hi', history: ['hi'] }, EARLIER_BAD],
  ])('answers 400 for %s', async (_label, payload, expected) => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { json: payload }))

    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe(expected)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 when the body is not JSON', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { body: 'not json' }))

    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe('The request was not valid JSON.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 when the declared body is larger than the limit', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { json: { message: 'hi' }, headers: { 'content-length': '999999999' } }))

    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe('That conversation is too large to send. Clear it and try again.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 400 when the measured body is larger than the limit', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { json: { message: 'hi', padding: 'x'.repeat(700_000) } }))

    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe('That conversation is too large to send. Clear it and try again.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 402 from the provider with plain copy and no vendor text', async () => {
    stubFetch(async () => jsonResponse({ error: { message: 'Insufficient credits for account acct_7781' } }, 402))

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))
    const text = JSON.stringify(await bodyOf(res))

    expect(res.status).toBe(502)
    expect(text).toContain('The AI provider rejected the key or is out of credit.')
    expect(text).not.toContain('Insufficient')
    expect(text).not.toContain('acct_7781')
  })

  it('answers a provider 500 with the did-not-answer copy and no vendor text', async () => {
    stubFetch(async () => new Response('internal boom', { status: 500 }))

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))
    const body = await bodyOf(res)

    expect(res.status).toBe(503)
    expect(body.error).toBe('The AI provider did not answer in time.')
    expect(JSON.stringify(body)).not.toContain('boom')
  })

  it.each(['AbortError', 'TimeoutError'])('answers a %s deadline with the did-not-answer copy', async name => {
    stubFetch(async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name })
    })

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))

    expect(res.status).toBe(503)
    expect((await bodyOf(res)).error).toBe('The AI provider did not answer in time.')
  })

  it('answers 503 when the provider cannot be reached', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))

    expect(res.status).toBe(503)
    expect((await bodyOf(res)).error).toBe('The AI provider could not be reached. Try again in a moment.')
  })

  it('retries once when the first reply is empty and adds up both attempts', async () => {
    const empty = {
      model: 'anthropic/claude-haiku-5.5',
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, cost: 0.00001 },
    }
    let calls = 0
    const fetchMock = stubFetch(async () => {
      calls += 1
      return jsonResponse(calls === 1 ? empty : OK_REPLY)
    })

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))
    const body = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(body.result).toBe('pong')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(body.usage?.total_tokens).toBe(23)
    expect(body.usage?.prompt_tokens).toBe(22)
    expect(body.trace?.find(step => step.name === 'model call')?.detail).toBe(
      'anthropic/claude-haiku-5.5, retried once after an empty reply',
    )
  })

  it('answers 502 when both replies are empty', async () => {
    const empty = { model: 'anthropic/claude-haiku-5.5', choices: [{ message: { content: '  ' } }] }
    const fetchMock = stubFetch(async () => jsonResponse(empty))

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))

    expect(res.status).toBe(502)
    expect((await bodyOf(res)).error).toBe('The assistant returned an empty response. Try again.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a reply that is a safety label', async () => {
    stubFetch(async () => jsonResponse(replyWith('Safety: safe')))

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))

    expect(res.status).toBe(502)
    expect((await bodyOf(res)).error).toBe(LABEL)
  })

  it('keeps a reply that happens to start with a category word', async () => {
    stubFetch(async () => jsonResponse(replyWith('Category: fruit. Apples are sweet.')))

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))

    expect(res.status).toBe(200)
    expect((await bodyOf(res)).result).toBe('Category: fruit. Apples are sweet.')
  })

  it('refuses a reply served by a moderation model', async () => {
    stubFetch(async () => jsonResponse(replyWith('Hello there.', 'meta-llama/llama-guard-3-8b')))

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))

    expect(res.status).toBe(502)
    expect((await bodyOf(res)).error).toBe(LABEL)
  })

  it('answers 500 when no provider key is configured, without calling the provider', async () => {
    setEnv('OPENROUTER_API_KEY', '')
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))

    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))

    expect(res.status).toBe(500)
    expect((await bodyOf(res)).error).toBe('The assistant is not configured on this deployment.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 500 with a generic message when reading the request fails', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(OK_REPLY))
    const broken = new Request(URL_AI, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error('socket reset'))
        },
      }),
      duplex: 'half',
    } as RequestInit)

    const res = await handler(broken)
    const text = JSON.stringify(await bodyOf(res))

    expect(res.status).toBe(500)
    expect(text).toContain('The assistant failed. Try again in a moment.')
    expect(text).not.toContain('socket reset')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
