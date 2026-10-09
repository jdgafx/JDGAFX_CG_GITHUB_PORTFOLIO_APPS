import { afterEach, beforeEach, vi } from 'vitest'
import { SITE_URL } from '../../netlify/shared/provider'

export const PLACEHOLDER = 'test-only-placeholder'
export const TOPIC = 'Why unit tests matter for small teams'
export const ARTICLE = 'Unit tests give a small team fast feedback. '.repeat(20)
export const NOTES = 'Notes on feedback loops and maintenance cost.'
export const KEY_MESSAGE = 'The AI provider rejected the key or is out of credit.'
export const SLOW_MESSAGE = 'The AI provider did not answer in time.'
export const LABEL_MESSAGE = 'The AI provider answered with a safety label instead of text, so this stage was discarded.'
export const EMPTY_MESSAGE = 'The AI provider returned no text for this stage.'
export const CUT_OFF_MESSAGE = 'This stage ran out of room before it finished.'
export const SHORT_MESSAGE = 'This stage returned far less text than the Edit stage it was given, so it was discarded.'
export const RATE_MESSAGE = 'Rate limited, try again in a minute.'
// A Sources stage output as the function stores it: two Wikipedia articles and one Hacker News story.
export const SOURCES = [
  '[1] Wikipedia: Unit testing',
  'URL: https://en.wikipedia.org/wiki/Unit_testing',
  'Summary: Unit testing is a software testing method in which individual units of source code are tested.',
  '',
  '[2] Wikipedia: Test-driven development',
  'URL: https://en.wikipedia.org/wiki/Test-driven_development',
  'Summary: Test-driven development is a way of developing software by writing tests first.',
  '',
  '[3] Hacker News: Multiple assertions are fine in a unit test',
  'URL: https://stackoverflow.blog/2022/11/03/multiple-assertions-per-test-are-fine/',
  'Points: 319',
  'Date: 2022-11-05',
].join('\n')

export interface Sent {
  url: string
  init: RequestInit | undefined
  body: Record<string, unknown>
}

export interface StageBody {
  result: string
  model: string
  usage: { total_tokens: number; cost?: number } | null
  trace: Array<Record<string, unknown>>
  totalMs: number
}

export interface ErrorBody {
  error: string
  retryable: boolean
  trace?: Array<Record<string, unknown>>
}

let savedKey: string | undefined
let clientCount = 0

// Registers the per-test setup: a placeholder key, and a fetch that fails any call a test did not stub.
export function installFunctionHarness(): void {
  beforeEach(() => {
    savedKey = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = PLACEHOLDER
    // A provider call that a test does not stub fails the test, so nothing reaches the network.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('The provider was called without a test stub')
    }))
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = savedKey
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
}

export interface RequestOptions {
  method?: string
  origin?: string | null
  rawBody?: string
  headers?: Record<string, string>
}

// Each request gets its own client address, so the per-client limit never carries between tests.
export function request(body: unknown, options: RequestOptions = {}): Request {
  const method = options.method ?? 'POST'
  clientCount += 1
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-nf-client-connection-ip': `203.0.113.${clientCount}`,
    ...options.headers,
  }
  if (options.origin !== null) headers.origin = options.origin ?? SITE_URL
  if (method === 'GET') return new Request('https://example.test/api/ai', { method, headers })
  const payload = options.rawBody ?? JSON.stringify(body)
  return new Request('https://example.test/api/ai', { method, headers, body: payload })
}

// Every writing stage needs the Sources output, so it is filled in unless a test sets it.
export function stageBody(stage: string, context: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const withSources = stage === 'sources' ? context : { sources: SOURCES, ...context }
  return { topic: TOPIC, contentType: 'Blog Post', stage, context: withSources, ...extra }
}

// Every provider call goes through this stub. Each call is recorded for the assertions.
export function providerWill(respond: (sent: Sent) => Response | Promise<Response>): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const record: Sent = { url: String(input), init, body: JSON.parse(String(init?.body)) as Record<string, unknown> }
    sent.push(record)
    return respond(record)
  }))
  return sent
}

export function completion(content: string, overrides: Record<string, unknown> = {}): Response {
  const payload = {
    model: 'anthropic/claude-haiku-4.5',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.0002 },
    ...overrides,
  }
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

export function words(count: number): string {
  return Array.from({ length: count }, () => 'word').join(' ')
}

