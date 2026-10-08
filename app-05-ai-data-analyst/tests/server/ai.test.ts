import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { config } from '../../netlify/functions/ai'

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

interface TraceStep {
  name: string
  status: string
  detail: string
  tokens?: number
}

interface Reply {
  error?: string
  result?: Record<string, unknown>
  trace?: TraceStep[]
  usage?: Record<string, number>
  model?: string | null
}

const ORIGIN = 'http://localhost:5173'
const KEY = 'test-only-placeholder'
const SERVED = 'anthropic/claude-haiku-5.5'
const QUESTION = 'Which product has the highest total revenue?'
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const COLUMN_ERROR =
  'The AI picked a group-by column ("category") that is not in this dataset. Available columns: date, product, revenue, units, region. Try naming the column you want in your question.'

const PLAN = {
  chartType: 'bar',
  groupBy: 'product',
  aggregate: { field: 'revenue', fn: 'sum' },
  title: 'Total revenue by product',
  explanation: 'Adds up revenue for each product.',
  notice: null,
}

const BODY = {
  question: QUESTION,
  headers: ['date', 'product', 'revenue', 'units', 'region'],
  sampleRows: [{ date: '2024-01-08', product: 'Widget A', revenue: '15200', units: '304', region: 'North' }],
  rowCount: 50,
}

let savedKey: string | undefined
let clientCounter = 0

beforeEach(() => {
  savedKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = KEY
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  vi.unstubAllGlobals()
})

/** A fresh client address per request keeps each test clear of the per-address rate limit. */
function request(body: unknown, options: { method?: string; origin?: string | null; raw?: string; client?: string } = {}) {
  clientCounter += 1
  const method = options.method ?? 'POST'
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': options.client ?? `client-${clientCounter}`,
  }
  const origin = options.origin === undefined ? ORIGIN : options.origin
  if (origin) headers.origin = origin
  const payload = options.raw ?? (body === undefined ? undefined : JSON.stringify(body))
  return new Request('https://app.example/api/ai', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : payload,
  })
}

function stubProvider(...replies: Array<Response | Error>) {
  const mock = vi.fn<FetchFn>()
  for (const item of replies) {
    if (item instanceof Error) mock.mockRejectedValueOnce(item)
    else mock.mockResolvedValueOnce(item)
  }
  vi.stubGlobal('fetch', mock)
  return mock
}

function modelReply(
  content: string,
  usage: Record<string, unknown> = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 },
  finish = 'stop',
): Response {
  return new Response(JSON.stringify({ model: SERVED, choices: [{ message: { content }, finish_reason: finish }], usage }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function providerStatus(status: number): Response {
  return new Response('{"error":"secret provider detail"}', { status })
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

async function readReply(response: Response): Promise<Reply> {
  return (await response.json()) as Reply
}

function stepStatuses(reply: Reply): Array<[string, string]> {
  return (reply.trace ?? []).map((step) => [step.name, step.status])
}

describe('ai function contract', () => {
  it('is served at /api/ai', () => {
    expect(config).toEqual({ path: '/api/ai' })
  })

  it('answers the browser preflight for an allowed origin', async () => {
    const mock = stubProvider()
    const response = await handler(request(undefined, { method: 'OPTIONS' }))
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(mock).not.toHaveBeenCalled()
  })

  it('answers 405 to GET without calling the provider', async () => {
    const mock = stubProvider()
    const response = await handler(request(undefined, { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(await readReply(response)).toEqual({ error: 'Method not allowed.' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('refuses an origin that is not on the allowlist', async () => {
    const mock = stubProvider()
    const response = await handler(request(BODY, { origin: 'https://elsewhere.example' }))
    expect(response.status).toBe(403)
    expect(await readReply(response)).toEqual({ error: 'Origin not allowed.' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('reports a missing server key as a 500 and never calls the provider', async () => {
    process.env.OPENROUTER_API_KEY = ''
    const mock = stubProvider()
    const response = await handler(request(BODY))
    expect(response.status).toBe(500)
    expect(await readReply(response)).toEqual({ error: 'The analysis service is not configured.' })
    expect(mock).not.toHaveBeenCalled()
  })
})

const MANY_COLUMNS = Array.from({ length: 201 }, (_, i) => `column${i}`)

const BAD_INPUTS: Array<[name: string, raw: string, error: string]> = [
  ['is not JSON', '{not json', 'Request body was not valid JSON.'],
  ['has no question', JSON.stringify({ ...BODY, question: '' }), 'A question is required.'],
  ['has only spaces as the question', JSON.stringify({ ...BODY, question: '   ' }), 'A question is required.'],
  ['has a question over 2000 characters', JSON.stringify({ ...BODY, question: 'q'.repeat(2001) }), 'Question is too long (max 2000 characters).'],
  ['has more than 200 columns', JSON.stringify({ ...BODY, headers: MANY_COLUMNS }), 'Dataset has too many columns (max 200).'],
  [
    'has a sample cell over 200 characters',
    JSON.stringify({ ...BODY, sampleRows: [{ ...BODY.sampleRows[0], product: 'p'.repeat(201) }] }),
    'A sample cell is longer than 200 characters.',
  ],
  ['sends more than five sample rows', JSON.stringify({ ...BODY, sampleRows: Array.from({ length: 6 }, () => BODY.sampleRows[0]) }), 'Too many sample rows (max 5).'],
  ['sends the row count as text', JSON.stringify({ ...BODY, rowCount: '50' }), 'The row count is not valid.'],
]

describe('ai function input checks', () => {
  it.each(BAD_INPUTS)('refuses a request that %s with a plain message and calls nothing', async (_name, raw, error) => {
    const mock = stubProvider()
    const response = await handler(request(undefined, { raw }))
    expect(response.status).toBe(400)
    expect(await readReply(response)).toEqual({ error })
    expect(mock).not.toHaveBeenCalled()
  })

  it('refuses a body larger than 128 KB before any model call', async () => {
    const mock = stubProvider()
    const response = await handler(request(undefined, { raw: JSON.stringify({ ...BODY, padding: 'x'.repeat(130 * 1024) }) }))
    expect(response.status).toBe(413)
    expect(await readReply(response)).toEqual({ error: 'Request is too large.' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('allows twenty requests a minute from one address, then answers 429', async () => {
    const client = 'limit-test-address'
    for (let i = 0; i < 20; i += 1) {
      const response = await handler(request(undefined, { raw: '{}', client }))
      expect(response.status).toBe(400)
    }
    const limited = await handler(request(undefined, { raw: '{}', client }))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await readReply(limited)).toEqual({ error: 'Rate limited, try again in a minute.' })
  })
})

describe('ai function happy path', () => {
  it('returns the plan, the served model, the token usage and the trace', async () => {
    const mock = stubProvider(modelReply(JSON.stringify(PLAN)))
    const response = await handler(request(BODY))
    expect(response.status).toBe(200)
    const reply = await readReply(response)
    expect(reply.result).toEqual({
      chartType: 'bar',
      groupBy: 'product',
      aggregate: { field: 'revenue', fn: 'sum' },
      title: 'Total revenue by product',
      explanation: 'Adds up revenue for each product.',
    })
    expect(reply.model).toBe(SERVED)
    expect(reply.usage).toEqual({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 })
    expect(stepStatuses(reply)).toEqual([
      ['Build request', 'ok'],
      ['Model call', 'ok'],
      ['Read JSON reply', 'ok'],
      ['Check plan against columns', 'ok'],
      ['Repair turn', 'skipped'],
    ])
    expect(reply.trace?.find((step) => step.name === 'Model call')).toMatchObject({
      status: 'ok',
      tokens: 1200,
      detail: `Served by ${SERVED}.`,
    })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('sends one fixed model, a token cap and usage accounting, ignoring any model the browser names', async () => {
    const mock = stubProvider(modelReply(JSON.stringify(PLAN)))
    await handler(request({ ...BODY, model: 'some/other-model' }))
    const call = mock.mock.calls[0]
    const sent = JSON.parse(String(call?.[1].body)) as { model: string; max_tokens: number; usage: unknown; messages: Array<{ content: string }> }
    expect(call?.[0]).toBe(ENDPOINT)
    expect(sent.model).toBe('~anthropic/claude-haiku-latest')
    expect(sent.max_tokens).toBe(4096)
    expect(sent.usage).toEqual({ include: true })
    expect(sent.messages[1]?.content).toContain(`Question: ${QUESTION}`)
    expect(call?.[1].headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' })
  })

  it('reads a plan wrapped in a code fence and prose', async () => {
    stubProvider(modelReply(`Here is the plan:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``))
    const reply = await readReply(await handler(request(BODY)))
    expect(reply.result).toMatchObject({ groupBy: 'product', aggregate: { field: 'revenue', fn: 'sum' } })
  })
})

describe('ai function plan check and repair', () => {
  const WRONG = JSON.stringify({ ...PLAN, groupBy: 'category' })

  it('sends one repair turn with the checker reason, then returns the repaired plan', async () => {
    const mock = stubProvider(modelReply(WRONG), modelReply(JSON.stringify(PLAN)))
    const response = await handler(request(BODY))
    expect(response.status).toBe(200)
    const reply = await readReply(response)
    expect(reply.result).toMatchObject({ groupBy: 'product' })
    expect(stepStatuses(reply)).toEqual([
      ['Build request', 'ok'],
      ['Model call', 'ok'],
      ['Read JSON reply', 'ok'],
      ['Check plan against columns', 'failed'],
      ['Repair turn', 'ok'],
    ])
    expect(reply.usage).toEqual({ prompt_tokens: 2000, completion_tokens: 400, total_tokens: 2400, cost: 0.0004 })
    expect(mock).toHaveBeenCalledTimes(2)
    const repairSent = JSON.parse(String(mock.mock.calls[1]?.[1].body)) as { messages: Array<{ content: string }> }
    expect(repairSent.messages.at(-1)?.content).toContain(`Your previous reply was rejected: ${COLUMN_ERROR}`)
  })

  it('answers 422 with the checker reason when the repair is also wrong', async () => {
    const mock = stubProvider(modelReply(WRONG), modelReply(WRONG))
    const response = await handler(request(BODY))
    expect(response.status).toBe(422)
    const reply = await readReply(response)
    expect(reply.error).toBe(COLUMN_ERROR)
    expect(reply.trace?.at(-1)).toMatchObject({ name: 'Repair turn', status: 'failed' })
    expect(mock).toHaveBeenCalledTimes(2)
  })
})

describe('ai function model replies that cannot be used', () => {
  it('retries once after an empty reply and says so in the trace', async () => {
    const mock = stubProvider(modelReply(''), modelReply(JSON.stringify(PLAN)))
    const reply = await readReply(await handler(request(BODY)))
    expect(mock).toHaveBeenCalledTimes(2)
    expect(reply.trace?.find((step) => step.name === 'Model call')?.detail).toBe(
      `Served by ${SERVED}. Retried once because the first reply was empty.`,
    )
    expect(reply.usage?.total_tokens).toBe(2400)
  })

  it('answers 502 when two replies in a row are empty', async () => {
    const mock = stubProvider(modelReply(''), modelReply(''))
    const response = await handler(request(BODY))
    expect(response.status).toBe(502)
    expect(await readReply(response)).toMatchObject({ error: 'The AI returned an empty response. Try rephrasing your question.' })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('answers 502 with a narrower-question hint when the reply is cut off', async () => {
    const mock = stubProvider(modelReply('{"chartType":"bar"', undefined, 'length'))
    const response = await handler(request(BODY))
    expect(response.status).toBe(502)
    expect(await readReply(response)).toMatchObject({
      error: 'The AI reply was cut off before the JSON finished. Try a narrower question.',
    })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('answers 502 when the reply has no JSON object', async () => {
    stubProvider(modelReply('Sorry, I cannot help with that.'))
    const response = await handler(request(BODY))
    expect(response.status).toBe(502)
    expect(await readReply(response)).toMatchObject({
      error: 'The AI response could not be read. Try rephrasing your question.',
    })
  })
})

describe('ai function provider failures', () => {
  it('maps a provider 402 to the key-or-credit message and never shows the provider body', async () => {
    const mock = stubProvider(providerStatus(402))
    const response = await handler(request(BODY))
    const text = await response.text()
    expect(response.status).toBe(502)
    expect(JSON.parse(text)).toMatchObject({ error: 'The AI provider rejected the key or is out of credit.' })
    expect(text).not.toContain('secret provider detail')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('maps a provider 500 to the did-not-answer message', async () => {
    stubProvider(providerStatus(500))
    const response = await handler(request(BODY))
    expect(response.status).toBe(502)
    expect(await readReply(response)).toMatchObject({ error: 'The AI provider did not answer in time.' })
  })

  it('maps a provider 429 to 429 with a retry hint and the rate-limit message', async () => {
    stubProvider(providerStatus(429))
    const response = await handler(request(BODY))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('10')
    expect(await readReply(response)).toMatchObject({ error: 'Rate limited, try again in a minute.' })
  })

  it('maps a timeout to 504 with the did-not-answer message', async () => {
    const mock = stubProvider(abortError())
    const response = await handler(request(BODY))
    expect(response.status).toBe(504)
    expect(await readReply(response)).toMatchObject({ error: 'The AI provider did not answer in time.' })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('maps a network failure to the could-not-reach message', async () => {
    stubProvider(new TypeError('fetch failed'))
    const response = await handler(request(BODY))
    expect(response.status).toBe(502)
    expect(await readReply(response)).toMatchObject({ error: 'Could not reach the AI provider. Try again.' })
  })
})
