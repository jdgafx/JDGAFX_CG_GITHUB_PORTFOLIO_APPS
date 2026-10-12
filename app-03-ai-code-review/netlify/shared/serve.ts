import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from '../../src/lib/limits'
import { buildDiff, MAX_DIFF_CHARS, type PrFileInput } from './diff'
import { HANDOFF_EXPIRED, HANDOFF_REFUSED, openHandoff } from './handoff'
import { checkRate, reviewId } from './ratelimit'
import { runFirstPass, runRead, settleModel, type ReviewInput } from './pipeline'
import { PIPELINE, noun, padSkipped, record, sumUsage, type Run } from './trace'

/** The three requests of one review: pass 1, then the two reads of pass 2. Each is its own function with its own time budget. */
export type Stage = 'review' | 'read-1' | 'read-2'

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
const SERVER_ERROR = 'Something went wrong on the server. Please try again.'

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
  | { ok: true; input: ReviewInput; apiKey: string; summary: string; handoff: unknown }
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

/** The batch number in a read's query string (`?batch=2`): a whole number, or null for anything else. */
function readBatch(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get('batch')
  return raw !== null && /^\d{1,3}$/.test(raw) ? Number(raw) : null
}

async function checkRequest(req: Request, stage: Stage): Promise<Checked> {
  const limit = checkRate(stage, clientKey(req), reviewId(req))
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
  type Body = { mode?: unknown; code?: unknown; language?: unknown; files?: unknown; handoff?: unknown }
  let body: Body | null
  try {
    const bytes = await req.arrayBuffer()
    if (bytes.byteLength > MAX_BODY_BYTES) return bad('Request is too large.', 413)
    body = JSON.parse(new TextDecoder().decode(bytes)) as Body | null
  } catch {
    return bad('Request body was not valid JSON.')
  }

  // The client may send a model field; it is ignored. The chat model is fixed in provider.ts.
  const { mode, code, language, files, handoff } = body ?? {}

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
      handoff,
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
    handoff,
    input: { kind: 'file', lang, lines },
    summary: `${lang}, ${noun(lines.length, 'line')}, ${code.length.toLocaleString('en-US')} characters`,
  }
}

async function endWithError(run: Run, stage: Stage, error: string, status: number, headers: Record<string, string> = {}): Promise<Response> {
  // Only the review lists the whole pipeline: a read request's trace is its own rows.
  if (stage === 'review' && run.trace.length > 0) padSkipped(run)
  const model = await settleModel(run)
  return json(
    { success: false, error, trace: run.trace, usage: sumUsage(run.usages), unreportedCalls: run.unreported, model: run.model, ...model, totalMs: Date.now() - run.started },
    status,
    { ...run.headers, ...headers },
  )
}

/** One request after its record exists: check it, run its stage and answer. */
async function handle(req: Request, run: Run, stage: Stage): Promise<Response> {
  const checkAt = Date.now()
  const checked = await checkRequest(req, stage)
  if (!checked.ok) {
    record(run, 'Check request', 'failed', checkAt, checked.error)
    return endWithError(run, stage, checked.error, checked.status, checked.headers)
  }
  // A read works from the first pass's comments, which came through the browser: only the server's own signed record, made for
  // exactly this code, this function and this batch, and made within the last three minutes, is accepted. Anything else is
  // refused before any model is called.
  const batch = stage === 'review' ? 0 : readBatch(req)
  if (batch === null) {
    record(run, 'Check request', 'failed', checkAt, 'A read needs the number of its batch.')
    return endWithError(run, stage, 'A read needs the number of its batch.', 400)
  }
  const opened = stage === 'review' ? { id: '', comments: [], batches: [] } : openHandoff(checked.apiKey, checked.input, checked.handoff, stage, batch)
  // The rate limit counted this request under the id in the query string, before the hand-off could be read. That id must be the
  // hand-off's own, or one admitted review could front for the hand-offs of others and skip their count.
  if (stage !== 'review' && opened !== null && opened !== 'expired' && reviewId(req) !== opened.id) {
    record(run, 'Check request', 'failed', checkAt, HANDOFF_REFUSED)
    return endWithError(run, stage, HANDOFF_REFUSED, 400)
  }
  if (opened === null || opened === 'expired') {
    const why = opened === null ? HANDOFF_REFUSED : HANDOFF_EXPIRED
    record(run, 'Check request', 'failed', checkAt, why)
    return endWithError(run, stage, why, 400)
  }
  // A read's trace is its model call alone: the review's own trace already holds the one Check request row.
  if (stage === 'review') record(run, 'Check request', 'ok', checkAt, checked.summary)

  if (stage === 'review') {
    const outcome = await runFirstPass(run, checked.input, checked.apiKey)
    if (!outcome.ok) return endWithError(run, stage, outcome.error, outcome.status, outcome.headers)
    const settled = await settleModel(run)
    const { result, candidates, dropped, batches, handoff, model } = outcome
    return json({ success: true, stage, result, candidates, dropped, batches, handoff, trace: run.trace, usage: sumUsage(run.usages), unreportedCalls: run.unreported, model, ...settled, totalMs: Date.now() - run.started }, 200, run.headers)
  }
  const outcome = await runRead(run, checked.input, checked.apiKey, stage === 'read-1' ? 1 : 2, opened, batch)
  if (!outcome.ok) return endWithError(run, stage, outcome.error, outcome.status, outcome.headers)
  const settled = await settleModel(run)
  return json({ success: true, stage, read: outcome.read, rows: outcome.rows, trace: run.trace, usage: sumUsage(run.usages), unreportedCalls: run.unreported, model: run.model, ...settled, totalMs: Date.now() - run.started }, 200, run.headers)
}

/** The function for one stage: the same checks and answers for all three, each with its own run and clock. */
export function serve(stage: Stage): (req: Request) => Promise<Response> {
  return async (req) => {
    let headers: Record<string, string> = {}
    let run: Run | null = null
    try {
      const origin = req.headers.get('origin')
      headers = corsHeaders(origin)
      // A deploy preview's own origin is allowed too: its URL is the request's, whatever the production list says.
      const originAllowed = !origin || ALLOWED_ORIGINS.includes(origin) || origin === new URL(req.url).origin

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: originAllowed ? 204 : 403, headers })
      }
      if (!originAllowed) {
        return fail('Origin not allowed.', 403, headers)
      }
      if (req.method !== 'POST') {
        return fail('Method not allowed.', 405, headers)
      }

      run = { headers, started: Date.now(), trace: [], usages: [], model: null, served: [], newest: null, unreported: 0 }
      return await handle(req, run, stage)
    } catch (err) {
      console.error('CodeLens: unexpected server error', err)
      if (!run) return json({ success: false, error: SERVER_ERROR }, 500, headers)
      const names: readonly string[] = stage === 'review' ? PIPELINE : [stage === 'read-1' ? 'Pass 2: verify (read 1)' : 'Pass 2: verify (read 2, adversary)']
      const next = names.find((name) => !run!.trace.some((step) => step.name.startsWith(name.replace(/\)$/, ''))))
      if (next) run.trace.push({ name: next, status: 'failed', ms: 0, at: Date.now() - run.started, detail: 'Unexpected server error' })
      return endWithError(run, stage, SERVER_ERROR, 500)
    }
  }
}
