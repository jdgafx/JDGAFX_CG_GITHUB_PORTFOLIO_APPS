import { afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { MODEL } from '../../netlify/shared/provider'
import { MODEL_LIST_URL, resetNewestModel } from '../../netlify/shared/newest-model'
import { ReviewError, reviewCode, reviewPullRequest } from '../../src/lib/api'
import type { PrFileInput } from '../../netlify/shared/diff'

// Smoke tests for netlify/functions/ai.ts. The provider is a stub: every fetch is
// replaced before the handler runs, and the key is the placeholder for the test only.

export type Handler = (req: Request) => Promise<Response>
export type FetchStub = (url: string, init: RequestInit) => Promise<Response>
export type Usage = Partial<Record<'prompt_tokens' | 'completion_tokens' | 'total_tokens' | 'cost', number>>

export interface TraceEntry {
  name: string
  status: string
  ms: number
  at?: number
  detail: string
  tokens?: number
  cost?: number
}

export interface Payload {
  success: boolean
  error?: string
  candidates?: Array<{ id: number; line: number; fromLine: number; quote: string; message: string }>
  handoff?: { text: string; seal: string } | null
  rows?: Array<Record<string, unknown>>
  result?: {
    comments: Array<{ id: number; line: number; fromLine: number; severity: string; message: string; suggestion: string; verdict: string; decidedBy: string; reason: string; evidence: string | null; code: string; where: { file: string; line: number; side: string } | null }>
    lineCount: number
    truncated: boolean
    verified: boolean
    malformed: number
    mode: string
    pr: { filesIncluded: number; changedIncluded: number; charsIncluded: number; charLimit: number } | null
  }
  trace: TraceEntry[]
  usage: Usage | null
  model: string | null
  newestModel: string | null
  modelCheck: string
  servedModels: Array<{ pass: string; model: string | null }>
  totalMs: number
}

export interface SentBody {
  model: string
  max_tokens: number
  reasoning?: { enabled?: boolean }
  usage: { include: boolean }
  response_format: { type: string }
  messages: Array<{ role: string; content: string }>
}

export const PLACEHOLDER_KEY = 'test-only-placeholder'
export const ORIGIN = 'http://localhost:5173'
export const SERVED_MODEL = 'anthropic/claude-haiku-test'
export const DIVIDE = 'def divide(a, b):\n    return a / b'
export const DIVIDE_BODY = { code: DIVIDE, language: 'python' }
export const CRITICAL_DIVIDE = {
  line: 2,
  severity: 'critical',
  message: 'Dividing by zero raises ZeroDivisionError when b is 0.',
  suggestion: 'Check that b is not 0 before dividing, and return or raise a clear error.',
}
export const DEFAULT_USAGE = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00015 }

export const fetchStub = vi.fn<FetchStub>()
/** OpenRouter's public model list, answered apart from the provider queues so their order never shifts. */
export const listStub = vi.fn<FetchStub>()
const routedFetch: FetchStub = (url, init) => (url === MODEL_LIST_URL ? listStub(url, init) : fetchStub(url, init))
export const api: { handler: Handler | null; read1: Handler | null; read2: Handler | null } = { handler: null, read1: null, read2: null }
/** The function under test (request 1, pass 1), loaded in beforeAll with the origin allowlist pinned. */
export const handler: Handler = (req) => (api.handler as Handler)(req)
/** The two read functions (requests 2 and 3). */
export const readHandler = (n: 1 | 2): Handler => (req) => (n === 1 ? (api.read1 as Handler) : (api.read2 as Handler))(req)
let ipCounter = 0

/** Registers the shared hooks in the test file that calls it. */
export function installHooks(): void {
beforeAll(async () => {
  // The origin allowlist is read once, when the module loads, so pin it before the import.
  vi.stubEnv('ALLOWED_ORIGINS', `${ORIGIN},https://jdgafx-app-03-ai-code-review.netlify.app`)
  api.handler = (await import('../../netlify/functions/ai')).default
  api.read1 = (await import('../../netlify/functions/ai-read-1')).default
  api.read2 = (await import('../../netlify/functions/ai-read-2')).default
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', PLACEHOLDER_KEY)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchStub.mockReset()
  fetchStub.mockRejectedValue(new Error('unexpected provider call'))
  listAnswers(SERVED_MODEL)
  resetNewestModel()
  vi.stubGlobal('fetch', routedFetch)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
}

/** What the model list says the alias resolves to. Null: the list gives no answer (HTTP 503). */
export function listAnswers(newest: string | null): void {
  listStub.mockImplementation(async () =>
    newest === null
      ? new Response('unavailable', { status: 503 })
      : new Response(JSON.stringify({ data: [{ id: MODEL, alias_target: { slug: newest } }, { id: 'anthropic/claude-haiku-5.5' }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
}

/** A fresh address per request, so the per-address limit never trips across tests. */
export function nextIp(): string {
  ipCounter += 1
  return `198.51.100.${(ipCounter % 250) + 1}`
}

export interface RequestOptions {
  origin?: string | null
  ip?: string
  headers?: Record<string, string>
  /** The request's own URL. Defaults to the local test address. */
  url?: string
}

export function buildRequest(method: string, body: string | undefined, options: RequestOptions): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-nf-client-connection-ip': options.ip ?? nextIp(),
  }
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN
  return new Request(options.url ?? 'http://localhost/api/ai', { method, headers: { ...headers, ...options.headers }, body })
}

/** A POST whose body is the JSON of `payload`, or the raw text when a string is given. */
export function post(payload: unknown, options: RequestOptions = {}): Request {
  return buildRequest('POST', typeof payload === 'string' ? payload : JSON.stringify(payload), options)
}

/** One chat completion as the provider returns it. A new Response per call, so a retry reads its own body. */
export function providerReply(content: string, finish = 'stop', usage: Usage = DEFAULT_USAGE, served: string | null = SERVED_MODEL): Response {
  const body = { ...(served === null ? {} : { model: served }), choices: [{ message: { content }, finish_reason: finish }], usage }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

export function reviewJson(comments: unknown[]): string {
  return JSON.stringify({ comments })
}

export async function readPayload(res: Response): Promise<Payload> {
  return (await res.json()) as Payload
}

/** The JSON body the handler sent to the provider on the given call. */
export function sentBody(call = 0): SentBody {
  return JSON.parse(String(fetchStub.mock.calls[call]?.[1].body)) as SentBody
}

export function stepSummary(payload: Payload): string[] {
  return payload.trace.map((step) => `${step.name}:${step.status}`)
}

export const HOURS = ['import os', 'import sys', '', 'def load(path):', '    data = open(path).read()', '    return data.split(",")', '', 'def main():', '    rows = load(sys.argv[1])', '    print(rows[0])', '    os.exit(0)', '']
export const HOURS_BODY = { code: HOURS.join('\n'), language: 'python' }
export const FIVE = { line: 5, quote: 'open(path)', severity: 'warning', message: 'The file handle from open(path) is never closed.', suggestion: 'Use a with block so the file is closed.', issue: true }

export const verdictJson = (items: unknown[]): string => JSON.stringify(items)
export const keep = (id: number, line: number, evidence: string, reason = 'The code does what the comment says.', support = evidence) => ({ id, verdict: 'keep', line, evidence, support, reason, claim: { kind: 'other', names: [], lines: [line], quote: evidence } })

/** The adversarial read's answer when it finds nothing against any comment the first read kept or moved. */
export function standsFor(verdicts: unknown[]): unknown[] {
  return (verdicts as Array<{ id: number; line: number; evidence: string }>).map((v) => ({ id: v.id, verdict: 'stands', line: v.line, evidence: v.evidence, support: '', reason: 'Nothing in the file breaks the claim.' }))
}

/** Pass 1 returns `comments`; read 1 of pass 2 returns `verdicts`; read 2 (the adversary) finds nothing unless given `adversary`. */
export function twoPasses(comments: unknown[], verdicts: unknown[], adversary: unknown[] = standsFor(verdicts)): void {
  script({ pass1: [reply(reviewJson(comments))], read1: [reply(verdictJson(verdicts))], read2: [reply(verdictJson(adversary))] })
}

type Step = () => Response | Error
/** A provider reply, made fresh for each call, for `script`. */
export const reply = (text: string, finish = 'stop'): Step => () => providerReply(text, finish)
export const failure = (error: Error): Step => () => error

/**
 * Answers each provider call from a queue chosen by what the call is: the review (pass 1), the first read of pass 2, or its
 * adversarial read. The two reads run side by side, so a test that retries one cannot rely on the order of the calls.
 */
export function script(queues: { pass1?: Step[]; read1?: Step[]; read2?: Step[] }): void {
  const q = { pass1: [...(queues.pass1 ?? [])], read1: [...(queues.read1 ?? [])], read2: [...(queues.read2 ?? [])] }
  fetchStub.mockImplementation(async (_url, init) => {
    const system = (JSON.parse(String(init.body)) as { messages: Array<{ content: string }> }).messages[0].content
    const kind = system.includes('adversarial reviewer') ? 'read2' : system.includes('sceptical senior engineer') ? 'read1' : 'pass1'
    const step = q[kind].shift()
    if (!step) throw new Error(`unexpected ${kind} call`)
    const out = step()
    if (out instanceof Error) throw out
    return out
  })
}

export const COMPLETE = ['Check request:ok', 'Build prompt:ok', 'Pass 1: review:ok', 'Parse reply:ok', 'Checks:ok', 'Pass 2: verify (read 1):ok', 'Pass 2: verify (read 2, adversary):ok', 'Re-validate:ok']

/**
 * One whole review the way the browser runs it: request 1, then the two reads side by side, each a separate call of the
 * handler for its own function. Answers in the single-reply shape the earlier tests read: the merged trace and the final result.
 * A failure answers with the status of the request that failed.
 */
export async function full(body: Record<string, unknown>, options: { ip?: string } = {}): Promise<Response> {
  const ip = options.ip ?? nextIp()
  let failed: { status: number; headers: Headers } | null = null
  const route: Record<string, Handler> = { '/api/ai': handler, '/api/ai/read-1': readHandler(1), '/api/ai/read-2': readHandler(2) }
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call = route[url.split('?')[0]]
    if (!call) return routedFetch(url, init)
    const res = await call(new Request(`http://localhost${url}`, { ...init, headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-nf-client-connection-ip': ip } }))
    if (!res.ok && failed === null) failed = { status: res.status, headers: res.headers }
    return res
  })
  try {
    const run = body.mode === 'pr' ? await reviewPullRequest(body.files as PrFileInput[]) : await reviewCode(body.code as string, body.language as string)
    const { result, ...rest } = run
    return new Response(JSON.stringify({ success: true, result, ...rest }), { status: 200 })
  } catch (err) {
    if (!(err instanceof ReviewError)) throw err
    return new Response(JSON.stringify({ success: false, error: err.message, ...err.summary }), { status: (failed as { status: number } | null)?.status ?? 500 })
  } finally {
    vi.stubGlobal('fetch', routedFetch)
  }
}
