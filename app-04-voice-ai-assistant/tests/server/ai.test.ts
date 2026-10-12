import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import { FORECAST_LISBON, GEOCODE_LISBON } from '../tool-fixtures'
import {
  NEWEST_LIST,
  ORIGIN,
  PLACEHOLDER,
  bodyOf,
  fixtureChunks,
  isChatCall,
  isModelList,
  jsonResponse,
  readEvents,
  request,
  restoreEnv,
  setEnv,
  silentResponse,
  sseResponse,
  stubFetch,
  type FetchMock,
} from '../helpers'

const URL_AI = 'http://localhost/api/ai'
const EARLIER_BAD = 'The earlier messages could not be read. Clear the conversation and try again.'

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

const chatCallsOf = (mock: FetchMock) => mock.mock.calls.filter(call => isChatCall(String(call[0])))

const never = async () => jsonResponse({})

describe('ai function', () => {
  beforeEach(() => {
    setEnv('OPENROUTER_API_KEY', PLACEHOLDER)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    restoreEnv()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('streams a plain answer as step, delta and done events, then [DONE]', async () => {
    route([() => sseResponse(fixtureChunks('plain'))])
    const res = await handler(request(URL_AI, { json: { message: 'How does a voice assistant work?' } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-transform')
    const raw = await res.clone().text()
    expect(raw.trimEnd().endsWith('data: [DONE]')).toBe(true)

    const events = await readEvents(res)
    expect(events.map(e => e.type)).toEqual(['step', 'delta', 'delta', 'delta', 'step', 'step', 'done'])
    const names = events.filter(e => e.type === 'step').map(e => (e.step as { name: string }).name)
    expect(names).toEqual(['request built', 'model call', 'parse and validate'])
    const done = events[events.length - 1]
    const text = events.filter(e => e.type === 'delta').map(e => e.text).join('')
    expect(done).toMatchObject({ type: 'done', model: 'anthropic/claude-haiku-5.5', newestModel: 'anthropic/claude-haiku-5.5', modelCheck: 'match', usage: { total_tokens: 653 } })
    expect(String(done.result)).toBe(text.trim())
  })

  // The requested alias is never reported as the model that answered: a reply with no model says so.
  it('reports a null served model, never the requested alias, when the reply names none', async () => {
    const unnamed = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'It is warm.' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ]
    route([() => sseResponse(unnamed)])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'hi' } })))
    expect(events.find(e => e.type === 'done')).toMatchObject({ type: 'done', model: null, modelCheck: 'not-reported' })
    expect(JSON.stringify(events)).not.toContain('claude-haiku-latest')
  })

  it('sends the tool call steps before the first word of the answer', async () => {
    route([() => sseResponse(fixtureChunks('weather')), () => sseResponse(fixtureChunks('answer'))])
    const res = await handler(request(URL_AI, { json: { message: 'weather in Lisbon?' } }))
    const events = await readEvents(res)
    const order = events.map(e => (e.type === 'step' ? (e.step as { name: string }).name : String(e.type)))
    expect(order.indexOf('tool call')).toBeLessThan(order.indexOf('delta'))
    expect(order.indexOf('model call')).toBeLessThan(order.indexOf('tool call'))
    const tool = events.find(e => e.type === 'step' && (e.step as { name: string }).name === 'tool call')?.step as { call: string; reading: { time: string } }
    expect(tool.call).toBe('weather("Lisbon")')
    expect(tool.reading.time).toBe('2026-10-09T06:00')
  })

  it('sends earlier turns in order, then the new message, and ignores a model named by the browser', async () => {
    const mock = route([() => sseResponse(fixtureChunks('plain'))])
    const history = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]
    await (await handler(request(URL_AI, { json: { message: 'third', history, model: 'evil/model' } }))).text()
    const sent = JSON.parse(String(chatCallsOf(mock)[0][1]?.body)) as { model: string; messages: Array<{ role: string; content: string }> }
    expect(sent.model).toBe('~anthropic/claude-haiku-latest')
    expect(sent.messages.map(m => `${m.role}:${m.content.slice(0, 5)}`)).toEqual(['system:You a', 'user:first', 'assistant:secon', 'user:third'])
  })

  it('tells the model to call a tool without announcing it, and never to say "Let me check"', async () => {
    const mock = route([() => sseResponse(fixtureChunks('plain'))])
    await (await handler(request(URL_AI, { json: { message: 'hi' } }))).text()
    const system = (JSON.parse(String(chatCallsOf(mock)[0][1]?.body)) as { messages: Array<{ role: string; content: string }> }).messages[0].content
    expect(system).not.toContain('Let me check')
    expect(system).not.toMatch(/first say|one short sentence/)
    expect(system).toContain('Call a tool without saying anything before it')
  })

  it('sends only the final answer text as the done result when the first reply wrote text before its tool call', async () => {
    const preTool = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Let me check the weather in Lisbon.' } }] })}\n\n`
    route([() => sseResponse([preTool, ...fixtureChunks('weather')]), () => sseResponse(fixtureChunks('answer'))])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'weather in Lisbon?' } })))
    const done = events.find(e => e.type === 'done')
    expect(String(done?.result)).not.toContain('Let me check')
    expect(String(done?.result)).toContain("It's currently")
    // The card and the voice are built from the deltas, so the text before the tool call must not be streamed either.
    const streamed = events.filter(e => e.type === 'delta').map(e => e.text).join('')
    expect(streamed).not.toContain('Let me check')
    expect(streamed.trim()).toBe(String(done?.result))
  })

  // The r3-3 shape from the acceptance run: "I'll check both cities." came before the tool request and was shown and spoken.
  it('streams no text delta before the tool step when the first call wrote text and then asked for a tool', async () => {
    const preTool = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "I'll check both cities." } }] })}\n\n`
    route([() => sseResponse([preTool, ...fixtureChunks('weather')]), () => sseResponse(fixtureChunks('answer'))])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'Is it warmer in Tokyo or in Oslo today?' } })))
    const order = events.map(e => (e.type === 'step' ? (e.step as { name: string }).name : String(e.type)))
    // The first delta of the run is the answer call's, after the tool step.
    expect(order.indexOf('delta')).toBeGreaterThan(order.indexOf('tool call'))
    expect(JSON.stringify(events.filter(e => e.type === 'delta'))).not.toContain('both cities')
  })

  it('still streams the text of a no-tool answer, as deltas before the model call step', async () => {
    route([() => sseResponse(fixtureChunks('plain'))])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'How does a voice assistant work?' } })))
    const deltas = events.filter(e => e.type === 'delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.map(e => e.text).join('').trim()).toBe(String(events.find(e => e.type === 'done')?.result))
  })

  // Thinking is left on, so OpenRouter streams reasoning in its own delta fields. None of it may reach the card or the voice.
  it('shows and speaks only answer content when the streams carry reasoning deltas, and sends no reasoning override', async () => {
    const thought = (delta: Record<string, unknown>) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '', role: 'assistant', ...delta } }] })}\n\n`
    const thinking = [
      thought({ reasoning: 'The user wants Lisbon weather, so I should call the weather tool.' }),
      thought({ reasoning_details: [{ type: 'reasoning.text', text: 'Plan: call weather, then answer.' }] }),
    ]
    const mock = route([() => sseResponse([...thinking, ...fixtureChunks('weather')]), () => sseResponse([...thinking, ...fixtureChunks('answer')])])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'weather in Lisbon?' } })))
    const done = events.find(e => e.type === 'done')
    const streamed = events.filter(e => e.type === 'delta').map(e => e.text).join('')
    expect(streamed.trim()).toBe(String(done?.result))
    expect(streamed).toContain("It's currently")
    for (const leaked of ['Lisbon weather, so', 'Plan: call weather']) {
      expect(streamed).not.toContain(leaked)
      expect(String(done?.result)).not.toContain(leaked)
    }
    const calls = chatCallsOf(mock)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      const sent = JSON.parse(String(call[1]?.body)) as { max_tokens: number; reasoning?: { enabled?: boolean } }
      expect(sent.reasoning?.enabled).not.toBe(false)
      expect(sent.max_tokens).toBe(2560)
    }
  })

  it('sends a ping comment while the model has not answered yet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    route([init => silentResponse(init?.signal)])
    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const first = decoder.decode((await reader.read()).value)
    expect(first).toContain('"request built"')
    await vi.advanceTimersByTimeAsync(10_000)
    let seen = ''
    while (!seen.includes(': ping')) seen += decoder.decode((await reader.read()).value)
    expect(seen).toContain(': ping\n\n')
    await reader.cancel()
  })

  it('ends the model call when the visitor closes the stream', async () => {
    const mock = route([init => silentResponse(init?.signal)])
    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    const signal = chatCallsOf(mock)[0][1]?.signal as AbortSignal
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
  })

  it('reports a provider failure as an error event with plain copy and the failed step', async () => {
    route([() => jsonResponse({ error: { message: 'Insufficient credits for account acct_7781' } }, 402)])
    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))
    const events = await readEvents(res)
    const error = events.find(e => e.type === 'error')
    expect(error?.error).toBe('The AI provider rejected the key or is out of credit.')
    expect(JSON.stringify(events)).not.toContain('acct_7781')
    expect(events.some(e => e.type === 'step' && (e.step as { name: string; status: string }).name === 'model call' && (e.step as { status: string }).status === 'failed')).toBe(true)
  })

  it('refuses a reply that is a safety label with an error event', async () => {
    const label = `data: ${JSON.stringify({ model: 'anthropic/claude-haiku-5.5', choices: [{ index: 0, delta: { content: 'User Safety: safe' } }] })}\n\ndata: [DONE]\n\n`
    route([() => sseResponse([label])])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'hi' } })))
    expect(events.find(e => e.type === 'error')?.error).toBe('The model returned a label instead of a reply. Try again.')
    expect(events.some(e => e.type === 'delta')).toBe(false)
  })

  // A reply that stopped at the token cap (thinking plus answer used max_tokens) or that ended with no finish reason at all is cut off.
  describe('a cut-off reply', () => {
    const LENGTH_MESSAGE = 'The AI ran out of reply length before it finished the answer. Try a shorter question.'
    const NO_FINISH_MESSAGE = 'The AI reply stopped before it was finished. Try again.'
    const chunk = (delta: Record<string, unknown>, finish?: string) =>
      `data: ${JSON.stringify({ model: 'anthropic/claude-haiku-5.5', choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`
    const ended = 'data: [DONE]\n\n'
    const cutText = (finish?: string) => [chunk({ content: 'The station opened in 1987. It handles fre' }), chunk({ content: '' }, finish), ended]
    const withFinish = (chunks: string[], from: string, to: string) => chunks.map(c => c.replace(`"finish_reason":"${from}"`, `"finish_reason":"${to}"`))
    const errorOf = (events: Array<Record<string, unknown>>) => events.find(e => e.type === 'error')?.error
    const stepStatus = (events: Array<Record<string, unknown>>, name: string) =>
      events.find(e => e.type === 'step' && (e.step as { name: string }).name === name)?.step as { status: string } | undefined

    it('ends a no-tool reply that stopped at the length limit with the error event, no text and no done', async () => {
      const mock = route([() => sseResponse(cutText('length'))])
      const events = await readEvents(await handler(request(URL_AI, { json: { message: 'tell me about the station' } })))
      expect(errorOf(events)).toBe(LENGTH_MESSAGE)
      expect(events.some(e => e.type === 'delta' || e.type === 'done')).toBe(false)
      expect(stepStatus(events, 'model call')?.status).toBe('failed')
      expect(events.some(e => e.type === 'step' && (e.step as { name: string }).name === 'parse and validate')).toBe(false)
      expect(chatCallsOf(mock)).toHaveLength(1)
    })

    it('ends a stream that carries no finish reason with the error event, no text and no done', async () => {
      const mock = route([() => sseResponse([chunk({ content: 'The station opened in 1987. It handles fre' }), ended])])
      const events = await readEvents(await handler(request(URL_AI, { json: { message: 'tell me about the station' } })))
      expect(errorOf(events)).toBe(NO_FINISH_MESSAGE)
      expect(events.some(e => e.type === 'delta' || e.type === 'done')).toBe(false)
      expect(chatCallsOf(mock)).toHaveLength(1)
    })

    it('runs no tool when the tool request itself was cut off, so half-written arguments are never used', async () => {
      const mock = route([() => sseResponse(withFinish(fixtureChunks('weather'), 'tool_calls', 'length'))])
      const events = await readEvents(await handler(request(URL_AI, { json: { message: 'weather in Lisbon?' } })))
      expect(errorOf(events)).toBe(LENGTH_MESSAGE)
      expect(events.some(e => e.type === 'delta' || e.type === 'done')).toBe(false)
      expect(events.some(e => e.type === 'step' && (e.step as { name: string }).name === 'tool call')).toBe(false)
      expect(mock.mock.calls.some(call => String(call[0]).includes('open-meteo') || String(call[0]).includes('geocoding'))).toBe(false)
      expect(chatCallsOf(mock)).toHaveLength(1)
    })

    it('ends with the error event, not done, when the answer written from tool results was cut off', async () => {
      route([() => sseResponse(fixtureChunks('weather')), () => sseResponse(withFinish(fixtureChunks('answer'), 'stop', 'length'))])
      const events = await readEvents(await handler(request(URL_AI, { json: { message: 'weather in Lisbon?' } })))
      expect(errorOf(events)).toBe(LENGTH_MESSAGE)
      expect(events.some(e => e.type === 'done')).toBe(false)
      expect(events.at(-1)).toMatchObject({ type: 'error' })
      expect(stepStatus(events, 'model answer')?.status).toBe('failed')
    })

    it('still asks again once when the reply is empty and cut off, and answers from the retry', async () => {
      const mock = route([() => sseResponse([chunk({ content: '' }, 'length'), ended]), () => sseResponse(fixtureChunks('plain'))])
      const events = await readEvents(await handler(request(URL_AI, { json: { message: 'hi' } })))
      expect(events.at(-1)).toMatchObject({ type: 'done', model: 'anthropic/claude-haiku-5.5' })
      expect(chatCallsOf(mock)).toHaveLength(2)
    })

    it('names the length limit, not a timeout, when both attempts used the whole reply on thinking', async () => {
      const mock = route([() => sseResponse([chunk({ content: '' }, 'length'), ended])])
      const events = await readEvents(await handler(request(URL_AI, { json: { message: 'hi' } })))
      expect(errorOf(events)).toBe(LENGTH_MESSAGE)
      expect(events.some(e => e.type === 'done')).toBe(false)
      expect(chatCallsOf(mock)).toHaveLength(2)
    })

    it('keeps a complete reply that finished normally', async () => {
      route([() => sseResponse(cutText('stop'))])
      const events = await readEvents(await handler(request(URL_AI, { json: { message: 'tell me about the station' } })))
      expect(events.at(-1)).toMatchObject({ type: 'done', result: 'The station opened in 1987. It handles fre' })
    })
  })

  it('answers a preflight from an allowed origin with 204', async () => {
    const mock = stubFetch(never)
    const res = await handler(request(URL_AI, { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(mock).not.toHaveBeenCalled()
  })

  it("answers a POST from the function's own deploy-preview origin, not only the production URL", async () => {
    route([() => sseResponse(fixtureChunks('plain'))])
    const preview = 'https://deploy-preview-9--jdgafx-app-04-x.netlify.app'
    const res = await handler(request(`${preview}/api/ai`, { json: { message: 'hi' }, origin: preview }))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(preview)
  })

  it('answers 405 to a GET request', async () => {
    const mock = stubFetch(never)
    const res = await handler(request(URL_AI, { method: 'GET' }))
    expect(res.status).toBe(405)
    expect((await bodyOf(res)).error).toBe('Method not allowed')
    expect(mock).not.toHaveBeenCalled()
  })

  it('answers 403 for an origin that is not allowed', async () => {
    const mock = stubFetch(never)
    const res = await handler(request(URL_AI, { json: { message: 'hi' }, origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('Origin not allowed')
    expect(mock).not.toHaveBeenCalled()
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
  ])('answers 400 for %s, as JSON, before any stream starts', async (_label, payload, expected) => {
    const mock = stubFetch(never)
    const res = await handler(request(URL_AI, { json: payload }))
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await bodyOf(res)).error).toBe(expected)
    expect(mock).not.toHaveBeenCalled()
  })

  it('answers 400 when the body is not JSON', async () => {
    const mock = stubFetch(never)
    const res = await handler(request(URL_AI, { body: 'not json' }))
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).error).toBe('The request was not valid JSON.')
    expect(mock).not.toHaveBeenCalled()
  })

  it('answers 400 when the declared or the measured body is larger than the limit', async () => {
    const mock = stubFetch(never)
    const declared = await handler(request(URL_AI, { json: { message: 'hi' }, headers: { 'content-length': '999999999' } }))
    const measured = await handler(request(URL_AI, { json: { message: 'hi', padding: 'x'.repeat(700_000) } }))
    for (const res of [declared, measured]) {
      expect(res.status).toBe(400)
      expect((await bodyOf(res)).error).toBe('That conversation is too large to send. Clear it and try again.')
    }
    expect(mock).not.toHaveBeenCalled()
  })

  it('answers 500 when no provider key is configured, without calling the provider', async () => {
    setEnv('OPENROUTER_API_KEY', '')
    const mock = stubFetch(never)
    const res = await handler(request(URL_AI, { json: { message: 'hi' } }))
    expect(res.status).toBe(500)
    expect((await bodyOf(res)).error).toBe('The assistant is not configured on this deployment.')
    expect(mock).not.toHaveBeenCalled()
  })

  it('answers 500 with a generic message when reading the request fails', async () => {
    const mock = stubFetch(never)
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
    expect(mock).not.toHaveBeenCalled()
  })
  // C13 on the wire: the error event carries what the failed run spent, so the browser can show it.
  it('sends the spent usage with the error event when a reply is cut off', async () => {
    const usage = { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40, cost: 0.00004 }
    const cut = `data: ${JSON.stringify({ model: 'anthropic/claude-haiku-5.5', choices: [{ index: 0, delta: { content: 'It is warm and' }, finish_reason: 'length' }], usage })}\n\ndata: [DONE]\n\n`
    route([() => sseResponse([cut])])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'hi' } })))
    expect(events.find(e => e.type === 'error')).toMatchObject({ type: 'error', usage: { total_tokens: 40, cost: 0.00004 } })
  })

  it('sends the spent usage with the error event when the reply has no text', async () => {
    const usage = { prompt_tokens: 30, completion_tokens: 0, total_tokens: 30, cost: 0.00003 }
    const blank = `data: ${JSON.stringify({ model: 'anthropic/claude-haiku-5.5', choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`
    route([() => sseResponse([blank]), () => sseResponse([blank])])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'hi' } })))
    expect(events.find(e => e.type === 'error')).toMatchObject({ type: 'error', usage: { total_tokens: 60 } })
  })

  it('sends unreportedCalls with the error event when the call reported no usage', async () => {
    route([() => jsonResponse({}, 500), () => sseResponse(fixtureChunks('plain'))])
    const events = await readEvents(await handler(request(URL_AI, { json: { message: 'hi' } })))
    // A 500 is not retried, so the run fails; the error event still says one call was not reported.
    expect(events.find(e => e.type === 'error')).toMatchObject({ usage: { unreportedCalls: 1 } })
  })
})
