import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../netlify/functions/ai'
import { modelListReply, routeFetch } from '../fixtures/openRouterList'

// The origin rules: a listed origin, the request's own origin (a deploy preview answers its own), no Origin header.
// Any other origin is refused.

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

const KEY = 'test-only-placeholder'
const SERVED = 'anthropic/claude-haiku-5.5'
const PREVIEW = 'https://deploy-preview-9--jdgafx-app-05-ai-data-analyst.netlify.app'
const PRODUCTION = 'https://jdgafx-app-05-ai-data-analyst.netlify.app'
const PLAN = {
  chartType: 'bar',
  groupBy: 'product',
  aggregate: { field: 'revenue', fn: 'sum' },
  title: 'Total revenue by product',
  explanation: 'Adds up revenue for each product.',
}
const BODY = {
  question: 'Which product has the highest total revenue?',
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

function request(body: unknown, options: { origin?: string | null; url?: string } = {}) {
  clientCounter += 1
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': `origin-client-${clientCounter}`,
  }
  if (options.origin) headers.origin = options.origin
  return new Request(options.url ?? 'https://app.example/api/ai', { method: 'POST', headers, body: JSON.stringify(body) })
}

/** A provider that always answers with the plan, and a model list that names SERVED as the newest model. */
function stubProvider() {
  const mock = vi.fn<FetchFn>(async () => {
    const content = JSON.stringify(PLAN)
    return new Response(JSON.stringify({ model: SERVED, choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', routeFetch(mock, async () => modelListReply(SERVED)))
  return mock
}

describe('ai function origin checks', () => {
  it('allows the origin of the request URL itself, so a deploy preview can call its own function', async () => {
    const mock = stubProvider()
    const response = await handler(request(BODY, { origin: PREVIEW, url: `${PREVIEW}/api/ai` }))
    expect(response.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('refuses a foreign origin even when the request itself is on a deploy preview', async () => {
    const mock = stubProvider()
    const response = await handler(request(BODY, { origin: 'https://evil.example', url: `${PREVIEW}/api/ai` }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Origin not allowed.' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('still allows the production origin', async () => {
    const mock = stubProvider()
    const response = await handler(request(BODY, { origin: PRODUCTION }))
    expect(response.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('allows a request with no Origin header, as before', async () => {
    const mock = stubProvider()
    const response = await handler(request(BODY, { origin: null }))
    expect(response.status).toBe(200)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
