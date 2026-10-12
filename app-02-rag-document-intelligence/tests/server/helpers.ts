import { afterEach, beforeEach, vi } from 'vitest'

const PLACEHOLDER = 'test-only-placeholder'
export const ORIGIN = 'http://localhost:5173'
export const SERVED = 'anthropic/claude-haiku-5-5'
export const ALIAS = '~anthropic/claude-haiku-latest'
export const LIST_URL = 'https://openrouter.ai/api/v1/models'
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

export interface UsageJson {
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  cost: number | null
  cost_source: string | null
  not_reported: number
}

export interface RunJson {
  result: { answer: string; source_chunk_indices: number[]; confidence: number }
  trace: StepJson[]
  usage: UsageJson
  servedModel: string | null
  newestModel: string | null
  modelCheck: string
  mismatchedModel: string | null
  totalMs: number
}

export interface Frame {
  type: string
  name?: string
  step?: StepJson
  run?: RunJson
  error?: string
  trace?: StepJson[]
  usage?: UsageJson | null
  totalMs?: number
}

// Each request gets its own client address, so the per-address rate limit never trips here.
let clientCount = 0

// The provider stub for the test in progress. Every test starts with one that has no replies,
// so an unplanned provider call fails inside the stub and never reaches the network.
let current: ReturnType<typeof stubProvider>

/** The stub for the test in progress, for asserting whether the provider was called. */
export const upstream = () => current

export function chatBody(content: string, options: { finish?: string; cost?: boolean; model?: string | null } = {}) {
  const usage: Record<string, number> = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
  if (options.cost !== false) usage['cost'] = 0.00012
  // `model: null` leaves the field out, as a reply that names no model does.
  const served = options.model === undefined ? SERVED : options.model
  return { ...(served === null ? {} : { model: served }), choices: [{ finish_reason: options.finish ?? 'stop', message: { content } }], usage }
}

const DEFAULT_LIST = { data: [{ id: ALIAS, alias_target: { name: 'Anthropic: Claude Haiku 5.5', slug: SERVED } }] }

// The model list the function reads for the newest model. Reset before each test; tests change it with `setList`.
let listBody: unknown = DEFAULT_LIST

/** Replaces the model list the function reads, for the test in progress. */
export function setList(body: unknown) {
  listBody = body
}

/** Answers the model list from `listBody` and sends every other call to the chat stub, so a list read never takes a chat reply. */
function dispatcher(chat: (url: string, init?: RequestInit) => Promise<Response>) {
  return async (url: string, init?: RequestInit) => (url === LIST_URL ? jsonReply(listBody) : chat(url, init))
}

export function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface RequestOptions {
  /** The Origin header. Null sends no Origin header at all. */
  origin?: string | null
  /** The request's own URL. Defaults to the local test host. */
  url?: string
  headers?: Record<string, string>
  rawBody?: string
  signal?: AbortSignal
}

export function request(body: unknown, options: RequestOptions = {}): Request {
  clientCount += 1
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-nf-client-connection-ip': `10.1.${Math.floor(clientCount / 256)}.${clientCount % 256}`,
    ...options.headers,
  }
  if (options.origin !== null) headers['Origin'] = options.origin ?? ORIGIN
  return new Request(options.url ?? 'http://localhost/api/ai', {
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
  vi.stubGlobal('fetch', dispatcher(mock))
  current = mock
  return mock
}

/** Replaces the stub with one the test built itself, so `upstream()` still reports on it. */
export function useStub(mock: ReturnType<typeof stubProvider>) {
  vi.stubGlobal('fetch', dispatcher(mock))
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
    listBody = DEFAULT_LIST
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
