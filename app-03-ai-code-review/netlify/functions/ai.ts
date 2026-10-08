import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from '../../src/lib/limits'
import type { StepStatus, TraceStep, Usage } from '../../src/types'
import {
  MAX_OUTPUT_TOKENS,
  chatBody,
  providerCall,
  replyCutShort,
  replyText,
  type ProviderCall,
  type ProviderReply,
  type ProviderUsage,
} from '../shared/provider'
import { buildSystemPrompt, commentBudget, parseReview, validateComments } from '../shared/review'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://jdgafx-app-03-ai-code-review.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

// JSON escaping can roughly double a payload, so allow headroom over MAX_CODE_LENGTH.
const MAX_BODY_BYTES = 256 * 1024
const UPSTREAM_TIMEOUT_MS = 25_000

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

// Best effort only: each warm function instance keeps its own counter, so the
// effective limit scales with instance count. Enough to blunt casual abuse of an
// unauthenticated demo endpoint; a shared store would be needed for a real quota.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

// Every run passes these stages in order. A run that stops early lists the rest as skipped.
const PIPELINE = ['Check request', 'Build prompt', 'Model call', 'Retry', 'Parse reply', 'Validate comments']

const USAGE_FIELDS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

interface Run {
  headers: Record<string, string>
  started: number
  trace: TraceStep[]
  usages: ProviderUsage[]
  model: string | null
}

type Checked =
  | { ok: true; code: string; lang: string; call: ProviderCall }
  | { ok: false; status: number; error: string; headers?: Record<string, string> }

type Attempt =
  | { ok: true; reply: ProviderReply }
  | { ok: false; status: number; detail: string; message: string; headers?: Record<string, string> }

function rateLimit(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k)
    }
    return { allowed: true, retryAfter: 0 }
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfter: 0 }
}

function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

function corsHeaders(origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    base['Access-Control-Allow-Origin'] = origin
  }
  return base
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function fail(error: string, status: number, headers: Record<string, string>): Response {
  return json({ success: false, error }, status, headers)
}

function noun(count: number, word: string): string {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`
}

/** Appends one finished stage to the trace, timed from `startedAt`. */
function record(
  trace: TraceStep[],
  name: string,
  status: StepStatus,
  startedAt: number,
  detail: string,
  usage?: ProviderUsage,
): void {
  trace.push({
    name,
    status,
    ms: Date.now() - startedAt,
    detail,
    ...(usage?.total_tokens !== undefined ? { tokens: usage.total_tokens } : {}),
    ...(usage?.cost !== undefined ? { cost: usage.cost } : {}),
  })
}

/** Lists the stages a run never reached, so the trace always shows the whole pipeline. */
function padSkipped(trace: TraceStep[]): void {
  for (const name of PIPELINE.slice(trace.length)) {
    trace.push({ name, status: 'skipped', ms: 0, detail: 'Not run: an earlier stage failed' })
  }
}

/** Adds up provider-reported usage. A field stays absent unless at least one call reported it. */
function sumUsage(reports: ProviderUsage[]): Usage | null {
  const total: Usage = {}
  for (const field of USAGE_FIELDS) {
    const values = reports.map((r) => r[field]).filter((v): v is number => typeof v === 'number')
    if (values.length > 0) total[field] = values.reduce((sum, v) => sum + v, 0)
  }
  return Object.keys(total).length > 0 ? total : null
}

function endWithError(run: Run, error: string, status: number, headers: Record<string, string> = {}): Response {
  if (run.trace.length > 0) padSkipped(run.trace)
  return json(
    {
      success: false,
      error,
      trace: run.trace,
      usage: sumUsage(run.usages),
      model: run.model,
      totalMs: Date.now() - run.started,
    },
    status,
    { ...run.headers, ...headers },
  )
}

async function checkRequest(req: Request): Promise<Checked> {
  const limit = rateLimit(clientKey(req))
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Too many reviews from this address. Please wait a moment and try again.',
      headers: { 'Retry-After': String(limit.retryAfter) },
    }
  }

  const call = providerCall()
  if (!call) return { ok: false, status: 500, error: 'The review service is not configured.' }

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Request is too large.' }
  }

  let body: { code?: unknown; language?: unknown }
  try {
    const rawBody = await req.text()
    if (rawBody.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'Request is too large.' }
    body = JSON.parse(rawBody) as { code?: unknown; language?: unknown }
  } catch {
    return { ok: false, status: 400, error: 'Request body was not valid JSON.' }
  }

  // The client may send a model field; it is ignored. The chat model is fixed in provider.ts.
  const { code, language } = body ?? {}
  if (!code || typeof code !== 'string' || !code.trim()) {
    return { ok: false, status: 400, error: 'Paste some code to review.' }
  }
  if (code.length > MAX_CODE_LENGTH) {
    return { ok: false, status: 400, error: `${OVER_LIMIT_MESSAGE}.` }
  }

  const lang = typeof language === 'string' && /^[a-z0-9+#. -]{1,24}$/i.test(language) ? language : 'code'
  return { ok: true, code, lang, call }
}

function providerFailure(status: number): Attempt {
  if (status === 402) {
    return {
      ok: false,
      status: 502,
      detail: 'Out of credit (HTTP 402)',
      message: 'The AI provider is out of credit, so reviews are paused. Try again later.',
    }
  }
  if (status === 429) {
    return {
      ok: false,
      status: 429,
      detail: 'Rate limited (HTTP 429)',
      message: 'The AI provider is busy right now. Wait a moment, then review again.',
      headers: { 'Retry-After': '10' },
    }
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      status: 502,
      detail: `Key rejected (HTTP ${status})`,
      message: 'The review service could not authenticate with the AI provider.',
    }
  }
  if (status >= 500) {
    return {
      ok: false,
      status: 502,
      detail: `Provider failed (HTTP ${status})`,
      message: 'The AI provider failed. Try again in a moment.',
    }
  }
  return {
    ok: false,
    status: 502,
    detail: `Request rejected (HTTP ${status})`,
    message: 'The AI provider rejected the request.',
  }
}

async function callModel(call: ProviderCall, body: string, signal: AbortSignal): Promise<Attempt> {
  try {
    const response = await fetch(call.url, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${call.apiKey}`, 'Content-Type': 'application/json' },
      body,
    })
    if (!response.ok) return providerFailure(response.status)
    return { ok: true, reply: (await response.json()) as ProviderReply }
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        detail: `Timed out after ${UPSTREAM_TIMEOUT_MS / 1000} s`,
        message: 'The review timed out. Try a shorter snippet.',
      }
    }
    if (err instanceof SyntaxError) {
      return {
        ok: false,
        status: 502,
        detail: 'Reply was not JSON',
        message: 'The AI service is unavailable right now. Try again in a moment.',
      }
    }
    console.error('CodeLens: provider call failed', err)
    return {
      ok: false,
      status: 502,
      detail: 'Could not reach the provider',
      message: 'Could not reach the review service. Please try again.',
    }
  }
}

function replyProblem(reply: ProviderReply): 'empty' | 'cut short' | null {
  if (!replyText(reply)) return 'empty'
  return replyCutShort(reply) ? 'cut short' : null
}

function noteReply(run: Run, reply: ProviderReply): void {
  run.usages.push(reply.usage ?? {})
  run.model = reply.model ?? run.model
}

function numberedLines(lines: string[]): string {
  return lines.map((line, i) => `${i + 1}\t| ${line}`).join('\n')
}

async function runReview(
  run: Run,
  checked: Extract<Checked, { ok: true }>,
  lines: string[],
  signal: AbortSignal,
): Promise<Response> {
  const { lang, call } = checked
  const lineCount = lines.length
  const maxComments = commentBudget(lineCount)

  const buildAt = Date.now()
  const body = chatBody(
    buildSystemPrompt(lang, lineCount, maxComments),
    `Review this ${lang} file (${lineCount} lines):\n\n${numberedLines(lines)}`,
  )
  record(
    run.trace,
    'Build prompt',
    'ok',
    buildAt,
    `Numbered ${noun(lineCount, 'line')}, up to ${noun(maxComments, 'comment')}, ${MAX_OUTPUT_TOKENS}-token cap, reasoning off`,
  )

  const callAt = Date.now()
  const first = await callModel(call, body, signal)
  if (!first.ok) {
    record(run.trace, 'Model call', 'failed', callAt, first.detail)
    return endWithError(run, first.message, first.status, first.headers)
  }
  record(run.trace, 'Model call', 'ok', callAt, 'Reply received', first.reply.usage)
  noteReply(run, first.reply)

  let reply = first.reply
  const problem = replyProblem(reply)
  const retryAt = Date.now()
  if (problem) {
    const retried = await callModel(call, body, signal)
    if (!retried.ok) {
      record(run.trace, 'Retry', 'failed', retryAt, `First reply was ${problem}. Retry failed: ${retried.detail}`)
      return endWithError(run, retried.message, retried.status, retried.headers)
    }
    record(run.trace, 'Retry', 'ok', retryAt, `First reply was ${problem}. Retry reply received`, retried.reply.usage)
    noteReply(run, retried.reply)
    reply = retried.reply
  } else {
    record(run.trace, 'Retry', 'skipped', Date.now(), 'Not needed: the first reply was complete')
  }

  const parseAt = Date.now()
  const text = replyText(reply)
  const truncated = replyCutShort(reply)
  if (!text) {
    record(run.trace, 'Parse reply', 'failed', parseAt, 'The reply had no content')
    return endWithError(run, 'The AI returned an empty review. Please try again.', 502)
  }
  const parsed = parseReview(text)
  if (!parsed) {
    record(
      run.trace,
      'Parse reply',
      'failed',
      parseAt,
      truncated ? 'The reply was cut short before the JSON closed' : 'The reply was not a readable JSON object',
    )
    return endWithError(
      run,
      truncated
        ? 'The review was cut short before it could be read. Try a shorter snippet.'
        : 'The AI response could not be read. Please try again.',
      502,
    )
  }
  record(run.trace, 'Parse reply', 'ok', parseAt, 'Read the JSON review')

  const validateAt = Date.now()
  const { comments, dropped } = validateComments(parsed.comments, lineCount)
  record(
    run.trace,
    'Validate comments',
    'ok',
    validateAt,
    dropped > 0
      ? `Kept ${noun(comments.length, 'comment')}, dropped ${dropped} (bad line, severity or text, or over the limit)`
      : `Kept ${noun(comments.length, 'comment')}`,
  )

  return json(
    {
      success: true,
      result: { comments, lineCount, truncated },
      trace: run.trace,
      usage: sumUsage(run.usages),
      model: reply.model ?? null,
      totalMs: Date.now() - run.started,
    },
    200,
    run.headers,
  )
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const headersOut = corsHeaders(origin)
  const originAllowed = !origin || ALLOWED_ORIGINS.includes(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: originAllowed ? 204 : 403, headers: headersOut })
  }

  if (!originAllowed) {
    return fail('Origin not allowed.', 403, headersOut)
  }

  if (req.method !== 'POST') {
    return fail('Method not allowed.', 405, headersOut)
  }

  const run: Run = { headers: headersOut, started: Date.now(), trace: [], usages: [], model: null }
  const checkAt = Date.now()
  const checked = await checkRequest(req)
  if (!checked.ok) {
    record(run.trace, 'Check request', 'failed', checkAt, checked.error)
    return endWithError(run, checked.error, checked.status, checked.headers)
  }

  const lines = checked.code.split('\n')
  record(
    run.trace,
    'Check request',
    'ok',
    checkAt,
    `${checked.lang}, ${noun(lines.length, 'line')}, ${checked.code.length.toLocaleString('en-US')} characters`,
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await runReview(run, checked, lines, controller.signal)
  } catch (err) {
    console.error('CodeLens: review failed unexpectedly', err)
    const next = PIPELINE[run.trace.length]
    if (next) run.trace.push({ name: next, status: 'failed', ms: 0, detail: 'Unexpected server error' })
    return endWithError(run, 'Could not reach the review service. Please try again.', 502)
  } finally {
    clearTimeout(timer)
  }
}

export const config = {
  path: '/api/ai',
}
