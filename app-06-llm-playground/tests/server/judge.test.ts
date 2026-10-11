import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL, type JudgeResponse } from '../../netlify/shared/contract'
import { useTestKey } from '../helpers'
import { chatCalls, NEWEST_CATALOGUE, providerStub, reply, request, sentBody } from './fixtures'

const URL = 'http://localhost:8888/api/judge'
const ANSWERS = [
  { slot: 'A', text: 'A long answer that is correct.' },
  { slot: 'B', text: 'A short answer that is correct.' },
]
const VERDICT = '{"bestOverall":"B","perPanel":{"A":"Correct but long.","B":"Correct and short."},"caveat":"One prompt, one sample."}'

async function handler() {
  vi.resetModules()
  return (await import('../../netlify/functions/judge')).default
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('judge function', () => {
  useTestKey()

  it('returns the verdict, the judge model, usage and cost from a mocked reply', async () => {
    const stub = providerStub(() =>
      reply('anthropic/claude-haiku-5.5', VERDICT, { prompt: 300, completion: 60, cost: 0.000045 }),
    )
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Explain READY.', answers: ANSWERS }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as JudgeResponse
    expect(body).toEqual({
      ok: true,
      model: 'anthropic/claude-haiku-5.5',
      latencyMs: expect.any(Number),
      bestOverall: 'B',
      perPanel: { A: 'Correct but long.', B: 'Correct and short.' },
      caveat: 'One prompt, one sample.',
      usage: { prompt_tokens: 300, completion_tokens: 60, reasoning_tokens: null, total_tokens: 360 },
      cost: { usd: 0.000045, source: 'usage' },
      newestModel: null,
      modelCheck: 'unchecked',
      trace: [
        {
          name: 'Judge',
          status: 'ok',
          ms: expect.any(Number),
          detail: 'anthropic/claude-haiku-5.5 picked Panel B',
          tokens: 360,
          cost: { usd: 0.000045, source: 'usage' },
        },
      ],
    })
    expect(chatCalls(stub)).toHaveLength(1)
    expect(sentBody(chatCalls(stub)[0][1])).toMatchObject({
      model: MODEL,
      max_tokens: 1024,
      reasoning: { enabled: false },
      usage: { include: true },
    })
    expect(sentBody(chatCalls(stub)[0][1]).model).toBe('~anthropic/claude-haiku-latest')
    expect(sentBody(chatCalls(stub)[0][1])).not.toHaveProperty('temperature')
  })

  it('reads a verdict wrapped in a code fence', async () => {
    const stub = providerStub(() => reply('anthropic/claude-haiku-5.5', '```json\n' + VERDICT + '\n```'))
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: ANSWERS }))
    expect(await response.json()).toMatchObject({ ok: true, bestOverall: 'B' })
    expect(chatCalls(stub)).toHaveLength(1)
  })

  it('refuses an empty list of answers with a plain message, and makes no provider call', async () => {
    const stub = providerStub(() => reply('x', VERDICT))
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: [] }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Send between 1 and 3 answers' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses a repeated panel slot', async () => {
    const stub = providerStub(() => reply('x', VERDICT))
    const response = await (await handler())(
      request(URL, 'POST', {
        prompt: 'Q',
        answers: [
          { slot: 'A', text: 'x' },
          { slot: 'A', text: 'y' },
        ],
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Each answer needs a unique slot (A, B or C) and text' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses an answer over 8000 characters before any provider call', async () => {
    const stub = providerStub(() => reply('x', VERDICT))
    const response = await (await handler())(
      request(URL, 'POST', { prompt: 'Q', answers: [{ slot: 'A', text: 'x'.repeat(8001) }, { slot: 'B', text: 'y' }] }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Each answer must be 8000 characters or fewer' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses answers that together exceed 20000 characters before any provider call', async () => {
    const stub = providerStub(() => reply('x', VERDICT))
    const response = await (await handler())(
      request(URL, 'POST', {
        prompt: 'Q',
        answers: [
          { slot: 'A', text: 'a'.repeat(7000) },
          { slot: 'B', text: 'b'.repeat(7000) },
          { slot: 'C', text: 'c'.repeat(7000) },
        ],
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'The answers together must be 20000 characters or fewer' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('accepts answers at the limits: 8000 characters each and 20000 in total', async () => {
    const stub = providerStub(() => reply('anthropic/claude-haiku-5.5', VERDICT))
    const response = await (await handler())(
      request(URL, 'POST', {
        prompt: 'Q',
        answers: [
          { slot: 'A', text: 'a'.repeat(8000) },
          { slot: 'B', text: 'b'.repeat(8000) },
          { slot: 'C', text: 'c'.repeat(4000) },
        ],
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, bestOverall: 'B' })
    expect(chatCalls(stub)).toHaveLength(1)
  })

  it('refuses a body that is not JSON before any provider call', async () => {
    const stub = providerStub(() => reply('x', VERDICT))
    const response = await (await handler())(request(URL, 'POST', undefined, { raw: '[' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'The request body must be JSON' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('answers a GET with 405 before any provider call', async () => {
    const stub = providerStub(() => reply('x', VERDICT))
    const response = await (await handler())(request(URL, 'GET'))
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'Method not allowed' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('answers 503 with no provider call when the server has no key', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const stub = providerStub(() => reply('x', VERDICT))
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: ANSWERS }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'The server is missing its provider key' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('reports a reply with no JSON as a failed judge step, with the model that answered', async () => {
    const stub = providerStub(() => reply('anthropic/claude-haiku-5.5', 'Panel A is better.'))
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: ANSWERS }))
    expect(chatCalls(stub)).toHaveLength(1)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: false,
      reason: 'The judge did not return JSON',
      model: 'anthropic/claude-haiku-5.5',
      trace: [{ name: 'Judge', status: 'failed', detail: 'The judge did not return JSON' }],
    })
  })

  it('reports an empty reply as a failed judge step', async () => {
    const stub = providerStub(() => reply('anthropic/claude-haiku-5.5', '   '))
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: ANSWERS }))
    expect(chatCalls(stub)).toHaveLength(1)
    expect(await response.json()).toMatchObject({ ok: false, reason: 'The judge returned no text' })
  })

  it('reports a provider 402 as a failed judge step with no model', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = providerStub(() => new Response('{"error":"no credit"}', { status: 402 }))
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: ANSWERS }))
    expect(chatCalls(stub)).toHaveLength(1)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: false,
      reason: 'The AI provider rejected the key or is out of credit',
      model: null,
      trace: [{ name: 'Judge', status: 'failed', ms: expect.any(Number) }],
    })
  })

  it('reports a judge timeout with the timeout message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = providerStub(() => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: ANSWERS }))
    // The first try timed out, so the judge asked once more before giving up.
    expect(chatCalls(stub)).toHaveLength(2)
    expect(await response.json()).toMatchObject({ ok: false, reason: 'The AI provider did not answer in time' })
  })
})

describe('judge function, newest-model check', () => {
  useTestKey()
  const NEWEST = 'anthropic/claude-haiku-5.5'
  const withList = () => Response.json(NEWEST_CATALOGUE)

  it('shows a judge reply from another model as a mismatch, and still gives the verdict', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    providerStub(() => reply('anthropic/claude-haiku-5.4', VERDICT), withList)
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: ANSWERS }))
    expect(await response.json()).toMatchObject({ ok: true, bestOverall: 'B', model: 'anthropic/claude-haiku-5.4', newestModel: NEWEST, modelCheck: 'mismatch' })
  })

  it('reports not-reported when the judge reply names no model, and never names the alias', async () => {
    providerStub(() => new Response(JSON.stringify({ choices: [{ message: { content: VERDICT }, finish_reason: 'stop' }] })), withList)
    const response = await (await handler())(request(URL, 'POST', { prompt: 'Q', answers: ANSWERS }))
    const body = (await response.json()) as JudgeResponse
    expect(body).toMatchObject({ ok: true, model: null, modelCheck: 'not-reported' })
    expect(JSON.stringify(body)).not.toContain('claude-haiku-latest')
  })
})
