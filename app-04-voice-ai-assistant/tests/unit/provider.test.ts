import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runModelCall, type RunOptions } from '../../netlify/shared/provider'
import { createRecorder } from '../../netlify/shared/trace'
import { FORECAST_LISBON, GEOCODE_LISBON } from '../tool-fixtures'
import { NEWEST_LIST, PLACEHOLDER, fixtureChunks, isChatCall, isModelList, jsonResponse, silentResponse, sseResponse, stubFetch, type FetchMock } from '../helpers'

const TURNS = [{ role: 'user' as const, content: 'What is the weather in Lisbon right now?' }]

function options(over: Partial<RunOptions> = {}): RunOptions & { texts: string[] } {
  const texts: string[] = []
  return { maxTokens: 64, deadlineAt: Date.now() + 25_000, onText: d => texts.push(d), texts, ...over }
}

// OpenRouter answers each chat call from the next recorded stream; the tools' own hosts answer from fixtures.
function route(chats: Array<(init?: RequestInit) => Response>): FetchMock {
  let call = 0
  return stubFetch(async (input, init) => {
    const url = String(input)
    if (isModelList(url)) return jsonResponse(NEWEST_LIST)
    if (isChatCall(url)) return chats[Math.min(call++, chats.length - 1)](init)
    if (url.includes('geocoding-api')) return jsonResponse(GEOCODE_LISBON)
    if (url.includes('api.open-meteo.com')) return jsonResponse(FORECAST_LISBON)
    throw new Error(`unexpected request to ${url}`)
  })
}

const chatCalls = (mock: FetchMock) => mock.mock.calls.filter(call => isChatCall(String(call[0])))

describe('runModelCall', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('streams a plain answer and records one model call step with the first-words time', async () => {
    route([() => sseResponse(fixtureChunks('plain'))])
    const run = createRecorder()
    const o = options()
    const out = await runModelCall(PLACEHOLDER, TURNS, o, run)
    expect(out).toMatchObject({
      ok: true,
      record: { servedModel: 'anthropic/claude-haiku-5.5', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'match' },
      usage: { total_tokens: 653, cost: 0.000102267 },
    })
    expect(o.texts.join('').trim()).toBe(out.ok ? out.text : '')
    expect(run.steps.map(s => s.name)).toEqual(['model call'])
    expect(run.steps[0].detail).toMatch(/^anthropic\/claude-haiku-5\.5, first words after [\d,]+ ms$/)
    expect(run.steps[0]).toMatchObject({ servedModel: 'anthropic/claude-haiku-5.5', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'match' })
  })

  it('sends the alias as the requested model and no tool_choice on the first call', async () => {
    const mock = route([() => sseResponse(fixtureChunks('plain'))])
    await runModelCall(PLACEHOLDER, TURNS, options(), createRecorder())
    const sent = JSON.parse(String(chatCalls(mock)[0][1]?.body)) as Record<string, unknown>
    expect(sent.model).toBe('~anthropic/claude-haiku-latest')
    expect(sent).not.toHaveProperty('tool_choice')
  })

  it('records null, never the requested model, when the reply names no model', async () => {
    const unnamed = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hi there.' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ]
    route([() => sseResponse(unnamed)])
    const run = createRecorder()
    const out = await runModelCall(PLACEHOLDER, TURNS, options(), run)
    expect(out).toMatchObject({ ok: true, record: { servedModel: null, newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'not-reported' } })
    expect(run.steps[0]).toMatchObject({ servedModel: null, modelCheck: 'not-reported' })
    expect(run.steps[0].detail).toMatch(/^not reported, first words after/)
  })

  it('shows a reply from another model as a mismatch, logs it, and still answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const other = fixtureChunks('plain').map(chunk => chunk.replaceAll('anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-4.5'))
    route([() => sseResponse(other)])
    const run = createRecorder()
    const out = await runModelCall(PLACEHOLDER, TURNS, options(), run)
    expect(out).toMatchObject({ ok: true, record: { servedModel: 'anthropic/claude-haiku-4.5', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'mismatch' } })
    expect(run.steps[0]).toMatchObject({ servedModel: 'anthropic/claude-haiku-4.5', modelCheck: 'mismatch' })
    expect(warn).toHaveBeenCalledWith('model mismatch: served anthropic/claude-haiku-4.5, newest anthropic/claude-haiku-5.5, requested ~anthropic/claude-haiku-latest')
  })

  it('reports unchecked, not a guess, when the newest model cannot be read', async () => {
    vi.resetModules()
    const { runModelCall: fresh } = await import('../../netlify/shared/provider')
    stubFetch(async input => (isModelList(String(input)) ? new Response('down', { status: 503 }) : sseResponse(fixtureChunks('plain'))))
    const run = createRecorder()
    const out = await fresh(PLACEHOLDER, TURNS, options(), run)
    expect(out).toMatchObject({ ok: true, record: { servedModel: 'anthropic/claude-haiku-5.5', newestModel: null, modelCheck: 'unchecked' } })
  })

  it('runs the tool the model asked for before the answer streams, then asks again with tool_choice none', async () => {
    const mock = route([() => sseResponse(fixtureChunks('weather')), () => sseResponse(fixtureChunks('answer'))])
    const run = createRecorder()
    const o = options()
    const out = await runModelCall(PLACEHOLDER, TURNS, o, run)

    expect(run.steps.map(s => s.name)).toEqual(['model call', 'tool call', 'model answer'])
    expect(run.steps[0].detail).toContain('asked for weather')
    const tool = run.steps[1]
    expect(tool.call).toBe('weather("Lisbon")')
    expect(tool.source).toContain('api.open-meteo.com/v1/forecast')
    expect(tool.reading).toMatchObject({ time: '2026-10-09T06:00', zone: 'Europe/Lisbon', abbreviation: 'GMT+1', intervalSeconds: 900 })
    expect(new Date(tool.reading?.fetchedAt ?? '').getTime()).not.toBeNaN()

    const calls = chatCalls(mock)
    expect(calls).toHaveLength(2)
    const second = JSON.parse(String(calls[1][1]?.body)) as { tool_choice: string; messages: Array<{ role: string; tool_call_id?: string; content: string | null }> }
    expect(second.tool_choice).toBe('none')
    expect(second.messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool'])
    expect(second.messages[2].content).toContain('Weather for Lisbon, Lisbon District, Portugal')
    expect(out.ok && out.text).toContain("It's currently")
    // The streamed pieces are the answer, in order.
    expect(o.texts.join('').trim()).toBe(out.ok ? out.text : '')
    // Both calls' tokens and cost are added.
    expect(out.ok && out.usage?.total_tokens).toBeGreaterThan(605)
  })

  it('passes a failed tool to the model as plain text and still answers', async () => {
    const mock = stubFetch(async input => {
      const url = String(input)
      if (isModelList(url)) return jsonResponse(NEWEST_LIST)
      if (isChatCall(url)) return sseResponse(chatCalls(mock).length === 1 ? fixtureChunks('weather') : fixtureChunks('answer'))
      throw new TypeError('network down')
    })
    const run = createRecorder()
    const out = await runModelCall(PLACEHOLDER, TURNS, options(), run)
    expect(out.ok).toBe(true)
    expect(run.steps[1]).toMatchObject({ name: 'tool call', status: 'failed' })
    const second = JSON.parse(String(chatCalls(mock)[1][1]?.body)) as { messages: Array<{ role: string; content: string }> }
    expect(second.messages[2].content).toContain('The weather service did not answer')
  })

  it('retries once when the provider says nothing before the first-byte limit, and notes it in the step', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const mock = route([init => silentResponse(init?.signal), () => sseResponse(fixtureChunks('plain'))])
    const run = createRecorder()
    const pending = runModelCall(PLACEHOLDER, TURNS, options(), run)
    await vi.advanceTimersByTimeAsync(6_000)
    const out = await pending
    expect(out.ok).toBe(true)
    expect(chatCalls(mock)).toHaveLength(2)
    expect(run.steps[0].detail).toContain('retried once (no data before the first-byte limit)')
  })

  it('does not retry when too little of the budget is left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const mock = route([init => silentResponse(init?.signal)])
    const run = createRecorder()
    const pending = runModelCall(PLACEHOLDER, TURNS, options({ deadlineAt: Date.now() + 9_000 }), run)
    await vi.advanceTimersByTimeAsync(9_000)
    await expect(pending).resolves.toMatchObject({ ok: false, httpStatus: 503 })
    expect(chatCalls(mock)).toHaveLength(1)
    expect(run.steps[0]).toMatchObject({ name: 'model call', status: 'failed' })
  })

  it('never retries a 429', async () => {
    const mock = route([() => jsonResponse({ error: { message: 'slow down' } }, 429)])
    const out = await runModelCall(PLACEHOLDER, TURNS, options(), createRecorder())
    expect(out).toMatchObject({ ok: false, httpStatus: 429, message: 'Rate limited, try again in a minute.' })
    expect(chatCalls(mock)).toHaveLength(1)
  })

  it('retries an empty reply once and adds up both attempts', async () => {
    const empty = `data: ${JSON.stringify({ model: 'anthropic/claude-haiku-5.5', choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, cost: 0.00001 } })}\n\ndata: [DONE]\n\n`
    const mock = route([() => sseResponse([empty]), () => sseResponse(fixtureChunks('plain'))])
    const run = createRecorder()
    const out = await runModelCall(PLACEHOLDER, TURNS, options(), run)
    expect(chatCalls(mock)).toHaveLength(2)
    expect(out.ok && out.usage).toMatchObject({ total_tokens: 663 })
    expect(run.steps[0].detail).toContain('retried once (the reply was empty)')
  })

  it('records a failed model answer when the second call is refused', async () => {
    route([() => sseResponse(fixtureChunks('weather')), () => jsonResponse({}, 500)])
    const run = createRecorder()
    const out = await runModelCall(PLACEHOLDER, TURNS, options(), run)
    expect(out).toMatchObject({ ok: false, httpStatus: 503 })
    expect(run.steps.map(s => `${s.name}:${s.status}`)).toEqual(['model call:ok', 'tool call:ok', 'model answer:failed'])
  })
})
