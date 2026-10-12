// Test helpers for the Netlify functions: a valid wire request, an OpenRouter reply, and a fetch stub.
// Fixtures live here only; the functions carry no sample data.
import { vi } from 'vitest'

export const ORIGIN = 'https://jdgafx-app-09-ai-saas.netlify.app'
export const EXPLAIN_URL = 'https://site.test/api/explain'
export const KEY = 'sk-or-test-key-123456'

const big = (digits: string) => digits

/** The JSON a browser sends (WP1's encodeRequest: the four bigint fields travel as decimal strings). */
export function wireRequest(): Record<string, unknown> {
  const facts = (name: string, total: string) => ({
    name,
    aggregates: {
      windowTotal: big(total),
      last30Total: big('412345678'),
      peakDay: '2026-10-01',
      peakValue: 38105740,
      growth: { S1: big('412345678'), n1: 30, S0: big('350000000'), n0: 30, computable: true },
    },
    unusual: [
      { day: '2026-02-22', value: 9818293, median: 5200000, kind: 'spike', release: 'none' },
      { day: '2026-03-01', value: 1200000, median: 5100000, kind: 'drop', release: 1, version: '19.0.1' },
    ],
    possibleGaps: ['2026-06-03'],
    notAssessed: ['2025-10-20'],
  })
  return {
    target: 'react',
    names: ['react', 'vite'],
    window: {
      runDate: '2026-10-12', L: '2026-10-11', days: 365, start: '2025-10-12', noData: ['2026-05-01'],
      past: ['2026-09-12', '2026-10-11'], before: ['2026-08-13', '2026-09-11'], name: 'the past year',
    },
    facts: [facts('react', '5765986637'), facts('vite', '2345678901')],
    pastRows: {
      react: [['2026-09-12', 1000, null], ['2026-09-13', 0, 'possible-gap'], ['2026-09-14', 0, 'no-data']],
      vite: [['2026-09-12', 2000, null]],
    },
    releaseState: { react: 'ok', vite: 'failed' },
  }
}

export function explainRequest(body: unknown, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(EXPLAIN_URL, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

export const PARAGRAPH = {
  paragraph: [
    { t: 'text', s: 'react totals ' },
    { t: 'claim', kind: 'window_total', package: 'react', span: 'window', day: '', value: '5765986637' },
    { t: 'compare', package: 'react', peer: 'vite', metric: 'change_pct', relation: 'lower' },
  ],
}

export interface ChatOptions {
  content?: string | null
  finish?: string
  model?: string | null
  usage?: unknown
}

export function chatBody(o: ChatOptions = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: 'gen-1',
    choices: [{ index: 0, finish_reason: o.finish ?? 'stop', message: { role: 'assistant', content: o.content === undefined ? JSON.stringify(PARAGRAPH) : o.content } }],
    usage: o.usage === undefined
      ? { prompt_tokens: 2863, completion_tokens: 2596, cost: 0.001568457, completion_tokens_details: { reasoning_tokens: 2068 } }
      : o.usage,
  }
  if (o.model !== null) body.model = o.model ?? 'anthropic/claude-haiku-5.5'
  return body
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** The OpenRouter model list: the alias entry and the model it names, with per-token prices as strings. */
export function listBody(target: string | null = 'anthropic/claude-haiku-5.5'): unknown {
  return {
    data: [
      { id: '~anthropic/claude-haiku-latest', pricing: { prompt: '0.0000001', completion: '0.0000005' }, alias_target: target === null ? undefined : { slug: target } },
      { id: 'anthropic/claude-haiku-5.5', pricing: { prompt: '0.0000001', completion: '0.0000005' } },
    ],
  }
}

export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const LIST_URL = 'https://openrouter.ai/api/v1/models'

export interface Call { url: string; init: RequestInit | undefined }
type Handler = (call: Call) => Response | Promise<Response>

/** Routes fetch by URL and records every call. An unrouted URL fails the test by rejecting. */
export function installFetch(routes: { chat?: Handler; list?: Handler; registry?: Handler }): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call = { url, init }
    calls.push(call)
    const handler = url === CHAT_URL ? routes.chat : url === LIST_URL ? routes.list : url.startsWith('https://registry.npmjs.org/') ? routes.registry : undefined
    if (!handler) return Promise.reject(new Error(`unrouted fetch ${url}`))
    return Promise.resolve(handler(call))
  }))
  return calls
}

/** Parses the JSON body the function sent to OpenRouter. */
export function sentBody(calls: Call[]): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const chat = calls.find((c) => c.url === CHAT_URL)
  if (!chat || typeof chat.init?.body !== 'string') throw new Error('no chat call')
  return JSON.parse(chat.init.body) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}
