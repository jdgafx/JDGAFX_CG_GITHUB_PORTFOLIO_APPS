import { afterEach, beforeAll, beforeEach, vi } from 'vitest'

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
  totalMs: number
}

export interface SentBody {
  model: string
  max_tokens: number
  reasoning: { enabled: boolean }
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
export const api: { handler: Handler | null } = { handler: null }
/** The function under test, loaded in beforeAll with the origin allowlist pinned. */
export const handler: Handler = (req) => (api.handler as Handler)(req)
let ipCounter = 0

/** Registers the shared hooks in the test file that calls it. */
export function installHooks(): void {
beforeAll(async () => {
  // The origin allowlist is read once, when the module loads, so pin it before the import.
  vi.stubEnv('ALLOWED_ORIGINS', `${ORIGIN},https://jdgafx-app-03-ai-code-review.netlify.app`)
  api.handler = (await import('../../netlify/functions/ai')).default
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', PLACEHOLDER_KEY)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchStub.mockReset()
  fetchStub.mockRejectedValue(new Error('unexpected provider call'))
  vi.stubGlobal('fetch', fetchStub)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
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
}

export function buildRequest(method: string, body: string | undefined, options: RequestOptions): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-nf-client-connection-ip': options.ip ?? nextIp(),
  }
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN
  return new Request('http://localhost/api/ai', { method, headers: { ...headers, ...options.headers }, body })
}

/** A POST whose body is the JSON of `payload`, or the raw text when a string is given. */
export function post(payload: unknown, options: RequestOptions = {}): Request {
  return buildRequest('POST', typeof payload === 'string' ? payload : JSON.stringify(payload), options)
}

/** One chat completion as the provider returns it. A new Response per call, so a retry reads its own body. */
export function providerReply(content: string, finish = 'stop', usage: Usage = DEFAULT_USAGE): Response {
  const body = { model: SERVED_MODEL, choices: [{ message: { content }, finish_reason: finish }], usage }
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
export const keep = (id: number, line: number, evidence: string, reason = 'The code does what the comment says.', support = evidence) => ({ id, verdict: 'keep', line, evidence, support, reason })

/** The adversarial read's answer when it finds nothing against any comment the first read kept or moved. */
export function standsFor(verdicts: unknown[]): unknown[] {
  return (verdicts as Array<{ id: number; line: number; evidence: string }>).map((v) => ({ id: v.id, verdict: 'stands', line: v.line, evidence: v.evidence, support: '', reason: 'Nothing in the file breaks the claim.' }))
}

/** Pass 1 returns `comments`; read 1 of pass 2 returns `verdicts`; read 2 (the adversary) finds nothing unless given `adversary`. */
export function twoPasses(comments: unknown[], verdicts: unknown[], adversary: unknown[] = standsFor(verdicts)): void {
  fetchStub.mockResolvedValueOnce(providerReply(reviewJson(comments)))
  fetchStub.mockResolvedValueOnce(providerReply(verdictJson(verdicts)))
  fetchStub.mockResolvedValueOnce(providerReply(verdictJson(adversary)))
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
