import { afterEach, describe, expect, it, vi } from 'vitest'
import { MODEL_TIMEOUT_MS, buildChatBody, callModel, costFor, costOf, createModelList, parseModelList } from '../../netlify/shared/openrouter'
import { CHAT_URL, KEY, LIST_URL, chatBody, installFetch, jsonResponse, listBody, sentBody } from './helpers'
import { expectedSchema } from './expectedSchema'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('request body (spec section 3)', () => {
  const schema = expectedSchema(['react', 'vite'])
  const body = buildChatBody('SYS', 'USR', schema)

  it('is exactly the contract', () => {
    expect(body).toEqual({
      model: '~anthropic/claude-haiku-latest',
      reasoning: { effort: 'medium' },
      provider: { require_parameters: true },
      response_format: { type: 'json_schema', json_schema: { name: 'explanation', strict: true, schema } },
      max_tokens: 6000,
      usage: { include: true },
      messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }],
    })
  })
  it('has no temperature, tools, tool_choice, reasoning cap, disabled thinking or low effort', () => {
    const keys = Object.keys(body)
    for (const banned of ['temperature', 'tools', 'tool_choice', 'top_p']) expect(keys).not.toContain(banned)
    expect(body.reasoning).toEqual({ effort: 'medium' })
    const text = JSON.stringify(body)
    expect(text).not.toContain('"enabled"')
    expect(text).not.toContain('"effort":"low"')
    expect(text).not.toMatch(/"reasoning":\{[^}]*max_tokens/)
  })
  it('names the alias only, never a pinned model id', () => {
    expect(body.model).toBe('~anthropic/claude-haiku-latest')
  })
})

describe('callModel', () => {
  it('sends the key as a bearer token with the portfolio user agent, and reads tokens', async () => {
    const calls = installFetch({ chat: () => jsonResponse(chatBody()) })
    const reply = await callModel(buildChatBody('s', 'u', {}), KEY)
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(calls[0]?.url).toBe(CHAT_URL)
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(headers['User-Agent']).toBe('jdgafx-portfolio-bot/1.0 (+https://github.com/jdgafx)')
    expect(sentBody(calls).max_tokens).toBe(6000)
    expect(reply).toMatchObject({ finish: 'stop', model: 'anthropic/claude-haiku-5.5', promptTokens: 2863, completionTokens: 2596, reasoningTokens: 2068, reportedCost: 0.001568457 })
  })
  it('gives null tokens and a null model when the reply names none', async () => {
    installFetch({ chat: () => jsonResponse(chatBody({ model: null, usage: null })) })
    const reply = await callModel(buildChatBody('s', 'u', {}), KEY)
    expect(reply).toMatchObject({ model: null, promptTokens: null, completionTokens: null, reasoningTokens: null, reportedCost: null })
  })
  it('throws on an upstream error status', async () => {
    installFetch({ chat: () => jsonResponse({ error: 'x' }, 500) })
    await expect(callModel(buildChatBody('s', 'u', {}), KEY)).rejects.toThrow()
  })
  it('gives up at 26 s even when the call ignores the abort', async () => {
    vi.useFakeTimers()
    installFetch({ chat: () => new Promise<Response>(() => undefined) })
    const settled = callModel(buildChatBody('s', 'u', {}), KEY).then(() => 'ok', (e: Error) => e.name)
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS - 1)
    let done = false
    void settled.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled).toBe('TimeoutError')
    expect(MODEL_TIMEOUT_MS).toBe(26_000)
  })
})

describe('cost', () => {
  const list = parseModelList(listBody())
  it('is list price times tokens, with reasoning already inside completion', () => {
    expect(costFor(list, 'anthropic/claude-haiku-5.5', 2863, 2596)).toBeCloseTo(0.0015843, 10)
  })
  it('is null, never a guess, without a list, a served model, a price or token counts', () => {
    expect(costFor(null, 'anthropic/claude-haiku-5.5', 1, 1)).toBeNull()
    expect(costFor(list, null, 1, 1)).toBeNull()
    expect(costFor(list, 'other/model', 1, 1)).toBeNull()
    expect(costFor(list, 'anthropic/claude-haiku-5.5', null, 1)).toBeNull()
    expect(costFor(list, 'anthropic/claude-haiku-5.5', 1, null)).toBeNull()
  })
})

describe('cost of a call', () => {
  const list = parseModelList(listBody())
  const reply = { content: '', finish: 'stop', model: 'anthropic/claude-haiku-5.5', promptTokens: 2863, completionTokens: 2596, reasoningTokens: 2068 }
  it('is OpenRouter\'s own reported cost when the reply carries one, even without the list', () => {
    expect(costOf({ ...reply, reportedCost: 0.001568457 }, null)).toBe(0.001568457)
    expect(costOf({ ...reply, reportedCost: 0.001568457 }, list)).toBe(0.001568457)
  })
  it('falls back to list price times usage only when no cost was reported', () => {
    expect(costOf({ ...reply, reportedCost: null }, list)).toBeCloseTo(0.0015843, 10)
    expect(costOf({ ...reply, reportedCost: null }, null)).toBeNull()
  })
})

describe('model list', () => {
  it('reads the alias target slug', () => {
    expect(parseModelList(listBody('anthropic/claude-haiku-5.6'))?.newest).toBe('anthropic/claude-haiku-5.6')
    expect(parseModelList(listBody(null))?.newest).toBeNull()
    expect(parseModelList({ nope: 1 })).toBeNull()
  })
  it('keeps a list that named the newest model for one hour, then asks again', async () => {
    let now = 1_000
    let loads = 0
    const source = createModelList(async () => { loads += 1; return parseModelList(listBody()) }, () => now)
    await source()
    now += 59 * 60 * 1000
    await source()
    expect(loads).toBe(1)
    now += 2 * 60 * 1000
    await source()
    expect(loads).toBe(2)
  })
  it('does not keep a list without a newest model or a failed fetch', async () => {
    let loads = 0
    const source = createModelList(async () => { loads += 1; return loads === 1 ? null : parseModelList(listBody(null)) }, () => 0)
    await source(); await source(); await source()
    expect(loads).toBe(3)
  })
  it('shares one fetch between callers that arrive together', async () => {
    let loads = 0
    const source = createModelList(async () => { loads += 1; return parseModelList(listBody()) }, () => 0)
    await Promise.all([source(), source(), source()])
    expect(loads).toBe(1)
  })
  it('waits at most 3 s for the list, then gives null', async () => {
    vi.useFakeTimers()
    const calls = installFetch({ list: () => new Promise<Response>(() => undefined) })
    const settled = createModelList()()
    await vi.advanceTimersByTimeAsync(2_999)
    let done = false
    void settled.then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled).toBeNull()
    expect(calls[0]?.url).toBe(LIST_URL)
  })
  it('gives null on a bad status or unreadable JSON', async () => {
    installFetch({ list: () => jsonResponse({}, 503) })
    expect(await createModelList()()).toBeNull()
    installFetch({ list: () => new Response('<html>', { status: 200 }) })
    expect(await createModelList()()).toBeNull()
  })
})
