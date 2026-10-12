import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL, type CompareResponse } from '../../netlify/shared/contract'
import { TEST_KEY, useTestKey } from '../helpers'
import { chatCalls, NEWEST_CATALOGUE, providerStub, reply, request, sentBody } from './fixtures'

const URL = 'http://localhost:8888/api/compare'
const PROMPT = 'Reply with exactly the word READY.'
// The first model is ignored: panel A always runs the fixed model.
const MODELS = ['openai/ignored-by-server', 'google/gemini-2.5-flash-lite', 'anthropic/claude-sonnet-5']
const NO_ANSWER = 'The AI provider did not answer in time'
const STOPPED = 'The request was stopped before the AI provider answered'

async function handler() {
  vi.resetModules()
  return (await import('../../netlify/functions/compare')).default
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('compare function', () => {
  useTestKey()

  it('sends no reasoning override from any panel, and shows no reasoning field as an answer', async () => {
    const THOUGHT = 'PRIVATE-THINKING-TEXT'
    const stub = providerStub(model =>
      Response.json({
        model,
        choices: [{ message: { content: 'READY', reasoning: THOUGHT, reasoning_details: [{ text: THOUGHT }] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      }),
    )
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    const body = (await response.json()) as CompareResponse
    const calls = chatCalls(stub)
    expect(calls).toHaveLength(3)
    for (const call of calls) expect(sentBody(call[1])).not.toHaveProperty('reasoning')
    expect(body.panels.map(p => p.text)).toEqual(['READY', 'READY', 'READY'])
    expect(JSON.stringify(body)).not.toContain(THOUGHT)
  })

  it('answers each panel with its text, latency, usage, served model and cost, then the trace and summary', async () => {
    const stub = providerStub(model => {
      if (model === MODEL) return reply('anthropic/claude-haiku-5.5', 'READY', { completion: 3, cost: 0.000001 })
      if (model === 'google/gemini-2.5-flash-lite') {
        return reply('google/gemini-2.5-flash-lite-001', 'READY', { completion: 5, cost: 0.0000003 })
      }
      return reply('anthropic/claude-sonnet-5', 'READY', { completion: 4, cost: 0.000002 })
    })
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as CompareResponse
    expect(body.panels.map(p => p.slot)).toEqual(['A', 'B', 'C'])
    expect(body.panels.map(p => p.requestedModel)).toEqual([MODEL, 'google/gemini-2.5-flash-lite', 'anthropic/claude-sonnet-5'])
    expect(body.panels.map(p => p.servedModel)).toEqual([
      'anthropic/claude-haiku-5.5',
      'google/gemini-2.5-flash-lite-001',
      'anthropic/claude-sonnet-5',
    ])
    expect(body.panels.map(p => p.text)).toEqual(['READY', 'READY', 'READY'])
    expect(body.panels.every(p => p.ok && typeof p.latencyMs === 'number')).toBe(true)
    expect(body.panels[1].usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, reasoning_tokens: null, total_tokens: 15 })
    expect(body.panels[1].cost).toEqual({ usd: 0.0000003, source: 'usage' })
    expect(body.trace).toEqual([
      expect.objectContaining({ name: 'Panel A request', status: 'ok', tokens: 13 }),
      expect.objectContaining({
        name: 'Panel B request',
        status: 'ok',
        tokens: 15,
        detail: 'Served by google/gemini-2.5-flash-lite-001, 5 output tokens',
      }),
      expect.objectContaining({ name: 'Panel C request', status: 'ok', tokens: 14 }),
    ])
    expect(body.summary.cheapest).toEqual({ slot: 'B', model: 'google/gemini-2.5-flash-lite-001', usd: 0.0000003, source: 'usage' })
    expect(body.summary.mostOutputTokens).toEqual({ slot: 'B', model: 'google/gemini-2.5-flash-lite-001', tokens: 5 })
    expect(body.summary.fastest).not.toBeNull()
    expect(JSON.stringify(body)).not.toContain(TEST_KEY)
    expect(chatCalls(stub)).toHaveLength(3)
  })

  it('reads the catalogue once, then sends each panel with max_tokens and usage.include, panel A on the fixed model', async () => {
    const stub = providerStub(model => reply(model, 'READY'))
    await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    expect(stub.mock.calls[0][0].endsWith('/models')).toBe(true)
    const chatCalls = stub.mock.calls.filter(([url]) => url.endsWith('/chat/completions'))
    expect(chatCalls.map(([, init]) => sentBody(init).model)).toEqual([
      MODEL,
      'google/gemini-2.5-flash-lite',
      'anthropic/claude-sonnet-5',
    ])
    for (const [, init] of chatCalls) {
      expect(sentBody(init)).toMatchObject({ max_tokens: 2048, usage: { include: true } })
    }
  })

  it('runs panel A on the Haiku alias and sends no temperature when the visitor sets none', async () => {
    const stub = providerStub(model => reply(model, 'READY'))
    await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    const chatCalls = stub.mock.calls.filter(([url]) => url.endsWith('/chat/completions'))
    const panelA = sentBody(chatCalls[0][1])
    expect(panelA.model).toBe('~anthropic/claude-haiku-latest')
    expect(panelA).not.toHaveProperty('temperature')
    expect(panelA).not.toHaveProperty('provider')
  })

  it('refuses a model that is not in the list, with a plain message, before any provider call', async () => {
    const stub = providerStub(() => reply('x', 'READY'))
    const response = await (await handler())(
      request(URL, 'POST', { prompt: PROMPT, models: ['a/x', 'made/up-model', 'anthropic/claude-sonnet-5'] }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'That model is not in the model list. Choose another model.' })
    expect(stub.mock.calls.map(([url]) => url.endsWith('/models'))).toEqual([true])
  })

  it('refuses a prompt over 4000 characters without calling the catalogue or a provider', async () => {
    const stub = providerStub(() => reply('x', 'READY'))
    const response = await (await handler())(request(URL, 'POST', { prompt: 'x'.repeat(4001), models: MODELS }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Prompt must be 1 to 4000 characters' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses a body over the size limit before it is parsed', async () => {
    const stub = providerStub(() => reply('x', 'READY'))
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS, padding: 'z'.repeat(45_000) }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'The request is too large. Shorten the prompt and try again.' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON', async () => {
    const stub = providerStub(() => reply('x', 'READY'))
    const response = await (await handler())(request(URL, 'POST', undefined, { raw: '{"prompt":' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'The request body must be JSON' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('answers a GET with 405', async () => {
    const stub = providerStub(() => reply('x', 'READY'))
    const response = await (await handler())(request(URL, 'GET'))
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'Method not allowed' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('answers 503 with no provider call when the server has no key', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const stub = providerStub(() => reply('x', 'READY'))
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'The server is missing its provider key' })
    expect(stub).not.toHaveBeenCalled()
  })

  it('reports a provider 402 and a provider 500 on their own panels, and still answers the other panel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = providerStub(model => {
      if (model === 'google/gemini-2.5-flash-lite') return new Response('{"error":"no credit"}', { status: 402 })
      if (model === 'anthropic/claude-sonnet-5') return new Response('{"error":"boom"}', { status: 500 })
      return reply(model, 'READY')
    })
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    const body = (await response.json()) as CompareResponse
    expect(response.status).toBe(200)
    expect(body.panels[0]).toMatchObject({ ok: true, text: 'READY' })
    expect(body.panels[1]).toMatchObject({
      ok: false,
      error: 'The AI provider rejected the key or is out of credit',
      text: '',
      cost: null,
    })
    expect(body.panels[2]).toMatchObject({ ok: false, error: NO_ANSWER })
    expect(body.trace[1]).toMatchObject({ name: 'Panel B request', status: 'failed', detail: body.panels[1].error })
    expect(chatCalls(stub)).toHaveLength(3)
  })

  it('maps a provider 429 and a provider timeout to their plain-language messages', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = providerStub(model => {
      if (model === 'google/gemini-2.5-flash-lite') return new Response('{}', { status: 429 })
      if (model === 'anthropic/claude-sonnet-5') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
      return reply(model, 'READY')
    })
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    const body = (await response.json()) as CompareResponse
    expect(body.panels[1]).toMatchObject({ ok: false, error: 'Rate limited, try again in a minute' })
    // A timeout is retried once (panel C asks twice); a 429 is never retried.
    expect(body.panels[2]).toMatchObject({ ok: false, error: NO_ANSWER, retried: true })
    expect(body.panels[1].retried).toBe(false)
    expect(body.trace[2].detail).toBe(`${NO_ANSWER}. Retried once after the first try timed out. Usage not reported for 2 calls`)
    expect(chatCalls(stub)).toHaveLength(4)
  })

  it('passes the request abort signal to each provider call, so a stop during the first call stops every panel', async () => {
    const controller = new AbortController()
    const stub = providerStub((model, init) => {
      if (model === MODEL) {
        controller.abort()
        return reply(model, 'READY')
      }
      if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      return reply(model, 'READY')
    })
    const response = await (await handler())(
      request(URL, 'POST', { prompt: PROMPT, models: MODELS }, { signal: controller.signal }),
    )
    const body = (await response.json()) as CompareResponse
    expect(body.panels.map(p => p.error)).toEqual([STOPPED, STOPPED, STOPPED])
    expect(chatCalls(stub)).toHaveLength(3)
  })

  it('stops every panel whose call is still pending when the request is aborted', async () => {
    const controller = new AbortController()
    const answers: ((response: Response) => void)[] = []
    const stub = providerStub(() => new Promise<Response>(resolve => { answers.push(resolve) }))
    const running = (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }, { signal: controller.signal }))
    // All three panel calls are pending. The stub ignores the abort and answers only afterwards.
    await vi.waitFor(() => expect(answers).toHaveLength(3))
    controller.abort()
    for (const answer of answers) answer(reply('provider-late', 'READY'))
    const body = (await (await running).json()) as CompareResponse
    expect(body.panels.map(p => p.error)).toEqual([STOPPED, STOPPED, STOPPED])
    expect(body.panels.every(p => !p.ok)).toBe(true)
    expect(chatCalls(stub)).toHaveLength(3)
  })

  it('keeps accepting curated models when the catalogue is down, and still refuses an unknown one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stub = providerStub(
      model => reply(model, 'READY'),
      () => new Response('down', { status: 500 }),
    )
    const run = await handler()
    const curated = await run(request(URL, 'POST', { prompt: PROMPT, models: ['a/x', 'openai/gpt-5.4-nano', 'anthropic/claude-sonnet-5'] }))
    expect(curated.status).toBe(200)
    const unknown = await run(request(URL, 'POST', { prompt: PROMPT, models: ['a/x', 'openai/gpt-5.4-nano', 'made/up-model'] }))
    expect(unknown.status).toBe(400)
    // The first run makes one catalogue request and three panel calls. The refused run makes none.
    expect(chatCalls(stub)).toHaveLength(3)
  })
})

describe('compare function, newest-model check', () => {
  useTestKey()

  const NEWEST = 'anthropic/claude-haiku-5.5'
  const withList = () => Response.json(NEWEST_CATALOGUE)

  it('checks Panel A against the newest Haiku the list names, and leaves Panels B and C unchecked', async () => {
    const stub = providerStub(model => reply(model === MODEL ? NEWEST : model, 'READY'), withList)
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    const body = (await response.json()) as CompareResponse
    expect(body.panels[0]).toMatchObject({ slot: 'A', servedModel: NEWEST, newestModel: NEWEST, modelCheck: 'match' })
    for (const panel of body.panels.slice(1)) expect(panel).toMatchObject({ newestModel: null, modelCheck: null })
    expect(chatCalls(stub)).toHaveLength(3)
  })

  it('shows a Panel A reply from another model as a mismatch, and still answers the panel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    providerStub(model => reply(model === MODEL ? 'anthropic/claude-haiku-5.4' : model, 'READY'), withList)
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    const body = (await response.json()) as CompareResponse
    expect(body.panels[0]).toMatchObject({ ok: true, text: 'READY', servedModel: 'anthropic/claude-haiku-5.4', newestModel: NEWEST, modelCheck: 'mismatch' })
  })

  it('reports Panel A as not-reported when its reply names no model, and never names the alias in the summary', async () => {
    providerStub(model => (model === MODEL ? new Response(JSON.stringify({ choices: [{ message: { content: 'READY' }, finish_reason: 'stop' }] })) : reply(model, 'READY')), withList)
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    const body = (await response.json()) as CompareResponse
    expect(body.panels[0]).toMatchObject({ ok: true, servedModel: null, modelCheck: 'not-reported' })
    expect(JSON.stringify(body.summary)).not.toContain('claude-haiku-latest')
  })

  it('reports Panel A as unchecked when the list does not name the alias', async () => {
    providerStub(model => reply(model === MODEL ? NEWEST : model, 'READY'))
    const response = await (await handler())(request(URL, 'POST', { prompt: PROMPT, models: MODELS }))
    const body = (await response.json()) as CompareResponse
    expect(body.panels[0]).toMatchObject({ servedModel: NEWEST, newestModel: null, modelCheck: 'unchecked' })
  })
})
