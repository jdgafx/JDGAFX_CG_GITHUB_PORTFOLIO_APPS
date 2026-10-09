import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from '../../src/lib/limits'
import { buildDiff, MAX_DIFF_CHARS, type PrFileInput } from '../shared/diff'
import { runPipeline, type ReviewInput } from '../shared/pipeline'
import { PIPELINE, noun, padSkipped, record, sumUsage, type Run } from '../shared/trace'

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
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

// Best effort only: each warm function instance keeps its own counter, so the
// effective limit scales with instance count. Enough to blunt casual abuse of an
// unauthenticated demo endpoint; a shared store would be needed for a real quota.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

const SERVER_ERROR = 'Something went wrong on the server. Please try again.'

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

type Checked =
  | { ok: true; input: ReviewInput; apiKey: string; summary: string }
  | { ok: false; status: number; error: string; headers?: Record<string, string> }

const MAX_FILES = 300
const MAX_PATH_CHARS = 300

function bad(error: string, status = 400): Checked {
  return { ok: false, status, error }
}

/** Validates the file list of a pull request review. Nothing is truncated: a list over the limit is refused. */
function checkFiles(value: unknown): { ok: true; files: PrFileInput[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: 'Choose at least one pull request file to review.' }
  if (value.length > MAX_FILES) return { ok: false, error: `A review reads up to ${MAX_FILES} files.` }
  const files: PrFileInput[] = []
  for (const item of value) {
    const f = item as { path?: unknown; status?: unknown; patch?: unknown } | null
    if (!f || typeof f.path !== 'string' || !f.path || f.path.length > MAX_PATH_CHARS || typeof f.patch !== 'string' || !f.patch.trim()) {
      return { ok: false, error: 'A pull request file was missing its path or its patch.' }
    }
    files.push({ path: f.path, status: typeof f.status === 'string' ? f.status.slice(0, 20) : 'modified', patch: f.patch })
  }
  return { ok: true, files }
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

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return bad('The review service is not configured.', 500)

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return bad('Request is too large.', 413)

  // Measure the bytes actually received, because Content-Length can be missing or wrong.
  type Body = { mode?: unknown; code?: unknown; language?: unknown; files?: unknown }
  let body: Body | null
  try {
    const bytes = await req.arrayBuffer()
    if (bytes.byteLength > MAX_BODY_BYTES) return bad('Request is too large.', 413)
    body = JSON.parse(new TextDecoder().decode(bytes)) as Body | null
  } catch {
    return bad('Request body was not valid JSON.')
  }

  // The client may send a model field; it is ignored. The chat model is fixed in provider.ts.
  const { mode, code, language, files } = body ?? {}

  if (mode === 'pr') {
    const checked = checkFiles(files)
    if (!checked.ok) return bad(checked.error)
    const built = buildDiff(checked.files)
    if (built.chars > MAX_DIFF_CHARS) {
      return bad(`The selected files are ${built.chars.toLocaleString('en-US')} characters of diff. A review reads up to ${MAX_DIFF_CHARS.toLocaleString('en-US')}: untick a file.`)
    }
    if (built.changed === 0) return bad('The selected files have no added or removed lines to review.')
    return {
      ok: true,
      apiKey,
      input: { kind: 'pr', files: checked.files },
      summary: `Pull request, ${noun(checked.files.length, 'file')}, ${noun(built.changed, 'changed line')}, ${built.chars.toLocaleString('en-US')} characters of diff`,
    }
  }

  if (!code || typeof code !== 'string' || !code.trim()) return bad('Paste some code to review.')
  if (code.length > MAX_CODE_LENGTH) return bad(`${OVER_LIMIT_MESSAGE}.`)
  const lang = typeof language === 'string' && /^[a-z0-9+#. -]{1,24}$/i.test(language) ? language : 'code'
  const lines = code.split('\n')
  return {
    ok: true,
    apiKey,
    input: { kind: 'file', lang, lines },
    summary: `${lang}, ${noun(lines.length, 'line')}, ${code.length.toLocaleString('en-US')} characters`,
  }
}

function endWithError(run: Run, error: string, status: number, headers: Record<string, string> = {}): Response {
  if (run.trace.length > 0) padSkipped(run)
  return json(
    { success: false, error, trace: run.trace, usage: sumUsage(run.usages), model: run.model, totalMs: Date.now() - run.started },
    status,
    { ...run.headers, ...headers },
  )
}

/** One review run after its record exists: check the request, then run both passes and answer. */
async function handle(req: Request, run: Run): Promise<Response> {
  const checkAt = Date.now()
  const checked = await checkRequest(req)
  if (!checked.ok) {
    record(run, 'Check request', 'failed', checkAt, checked.error)
    return endWithError(run, checked.error, checked.status, checked.headers)
  }
  record(run, 'Check request', 'ok', checkAt, checked.summary)

  const outcome = await runPipeline(run, checked.input, checked.apiKey)
  if (!outcome.ok) return endWithError(run, outcome.error, outcome.status, outcome.headers)
  return json(
    {
      success: true,
      result: outcome.result,
      trace: run.trace,
      usage: sumUsage(run.usages),
      model: outcome.model,
      totalMs: Date.now() - run.started,
    },
    200,
    run.headers,
  )
}

export default async (req: Request): Promise<Response> => {
  let headers: Record<string, string> = {}
  let run: Run | null = null
  try {
    const origin = req.headers.get('origin')
    headers = corsHeaders(origin)
    const originAllowed = !origin || ALLOWED_ORIGINS.includes(origin)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: originAllowed ? 204 : 403, headers })
    }
    if (!originAllowed) {
      return fail('Origin not allowed.', 403, headers)
    }
    if (req.method !== 'POST') {
      return fail('Method not allowed.', 405, headers)
    }

    run = { headers, started: Date.now(), trace: [], usages: [], model: null }
    return await handle(req, run)
  } catch (err) {
    console.error('CodeLens: unexpected server error', err)
    if (!run) return json({ success: false, error: SERVER_ERROR }, 500, headers)
    const next = PIPELINE.find((name) => !run!.trace.some((step) => step.name === name))
    if (next) run.trace.push({ name: next, status: 'failed', ms: 0, at: Date.now() - run.started, detail: 'Unexpected server error' })
    return endWithError(run, SERVER_ERROR, 500)
  }
}

export const config = {
  path: '/api/ai',
}
