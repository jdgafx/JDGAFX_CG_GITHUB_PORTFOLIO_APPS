import { afterEach, beforeEach, vi } from 'vitest'

const PLACEHOLDER = 'test-only-placeholder'
export const ORIGIN = 'http://localhost:5173'
export const SERVED = 'anthropic/claude-haiku-5-5'
const previousKey = process.env.OPENROUTER_API_KEY

export const VALID = {
  question: 'In what year was the Harbor Station opened?',
  chunks: ['[Chunk 0]:\nThe port handles freight.', '[Chunk 3]:\nThe Harbor Station was opened in 1987 in Lisbon.'],
  documentTitle: 'harbor.pdf',
}

export interface StepJson {
  name: string
  status: string
  detail: string
  ms: number
  tokens?: number | null
  cost?: number | null
}

export interface RunJson {
  result: { answer: string; source_chunk_indices: number[]; confidence: number }
  trace: StepJson[]
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number; cost_source: string }
  model: string
  totalMs: number
}

export interface Frame {
  type: string
  name?: string
  step?: StepJson
  run?: RunJson
  error?: string
  trace?: StepJson[]
  totalMs?: number
}

// Each request gets its own client address, so the per-address rate limit never trips here.
let clientCount = 0

// The provider stub for the test in progress. Every test starts with one that has no replies,
// so an unplanned provider call fails inside the stub and never reaches the network.
let current: ReturnType<typeof stubProvider>

/** The stub for the test in progress, for asserting whether the provider was called. */
export const upstream = () => current

export function chatBody(content: string, options: { finish?: string; cost?: boolean } = {}) {
  const usage: Record<string, number> = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
  if (options.cost !== false) usage['cost'] = 0.00012
  return { model: SERVED, choices: [{ finish_reason: options.finish ?? 'stop', message: { content } }], usage }
}

export function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface RequestOptions {
  origin?: string
  headers?: Record<string, string>
  rawBody?: string
  signal?: AbortSignal
}

export function request(body: unknown, options: RequestOptions = {}): Request {
  clientCount += 1
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: options.origin ?? ORIGIN,
    'x-nf-client-connection-ip': `10.1.${Math.floor(clientCount / 256)}.${clientCount % 256}`,
    ...options.headers,
  }
  return new Request('http://localhost/api/ai', {
    method: 'POST',
    headers,
    body: options.rawBody ?? JSON.stringify(body),
    signal: options.signal,
  })
}

/** Each provider call takes the next reply in order. Replies are factories, since a Response body can be read once. */
export function stubProvider(...replies: Array<() => Response>) {
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const next = replies.shift()
    if (!next) throw new Error('The test made an unexpected provider call.')
    return next()
  })
  vi.stubGlobal('fetch', mock)
  current = mock
  return mock
}

/** Replaces the stub with one the test built itself, so `upstream()` still reports on it. */
export function useStub(mock: ReturnType<typeof stubProvider>) {
  vi.stubGlobal('fetch', mock)
  current = mock
}

export function sentBody(mock: ReturnType<typeof stubProvider>, call: number): Record<string, unknown> {
  return JSON.parse(String(mock.mock.calls[call]?.[1]?.body)) as Record<string, unknown>
}

export async function readFrames(res: Response): Promise<{ frames: Frame[]; lastLine: string }> {
  const lines = (await res.text()).split('\n\n').filter(line => line !== '').map(line => line.replace(/^data: /, ''))
  return {
    frames: lines.filter(line => line !== '[DONE]').map(line => JSON.parse(line) as Frame),
    lastLine: lines.at(-1) ?? '',
  }
}

/** A run always ends in one result or one error frame. This is that frame. */
export async function finalFrame(res: Response): Promise<Frame> {
  const frame = (await readFrames(res)).frames.at(-1)
  if (!frame) throw new Error('The stream had no frames.')
  return frame
}

/** The finished run from a stream, failing the test when the run ended in an error frame. */
export async function runOf(res: Response): Promise<RunJson> {
  const frame = await finalFrame(res)
  if (frame.type !== 'result' || !frame.run) throw new Error(`Expected a result frame, got ${frame.type}: ${frame.error ?? ''}`)
  return frame.run
}

/** Installs the placeholder key and a silent console for each test, and restores both after. */
export function installProviderStub() {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = PLACEHOLDER
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubProvider()
  })

  afterEach(() => {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previousKey
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
}

export const PLACEHOLDER_KEY = PLACEHOLDER
