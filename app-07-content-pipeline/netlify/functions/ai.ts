import { chat, MODEL, ProviderStatusError, type Usage } from '../shared/provider'
import {
  CONTENT_TYPES, MAX_STAGE_TEXT_CHARS, STAGE_IDS, STAGE_INPUTS, STAGE_LABELS, buildSystemPrompt, buildUserMessage,
  rejectOutput, wordCount, type StageId,
} from '../shared/stages'
import { clientKey, corsHeaders, originAllowed, rateLimited } from '../shared/access'

// Each stage is one short model call and the browser chains five of them. The
// timeout keeps every call inside Netlify's synchronous limit (about 10 seconds).
const MODEL_TIMEOUT_MS = 8_000
// A ceiling only. The word budgets and the timeout set the real length.
const STAGE_MAX_TOKENS = 4_096
// Four full stage outputs, with room for UTF-8 and JSON escapes.
const MAX_BODY_BYTES = 128 * 1024
const MAX_TOPIC_CHARS = 400

const SLOW_MESSAGE = 'The AI provider did not answer in time.'
const KEY_OR_CREDIT_MESSAGE = 'The AI provider rejected the key or is out of credit.'
const RATE_LIMIT_MESSAGE = 'Rate limited, try again in a minute.'
const TOO_LARGE_MESSAGE = 'The request is too large.'
const UNEXPECTED_MESSAGE = 'Something went wrong on the server. Try again.'

interface TraceRow {
  name: string
  status: 'ok' | 'failed'
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

interface RunRequest {
  topic: string
  contentType: string
  stage: StageId
  context: Partial<Record<StageId, string>>
}

// What the provider reported for a call that reached it. Empty when nothing was sent.
interface Attempt {
  usage: Usage | null
  model: string | null
}
const NO_ATTEMPT: Attempt = { usage: null, model: null }

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

// Every failure has a plain message, a retry hint and one failed trace row. A call that
// reached the provider keeps its usage and model, because the provider still billed it.
function failure(
  stage: StageId,
  message: string,
  status: number,
  retryable: boolean,
  startedAt: number,
  origin: string | null,
  attempt: Attempt = NO_ATTEMPT,
): Response {
  const ms = Date.now() - startedAt
  const trace: TraceRow[] = [{
    name: STAGE_LABELS[stage],
    status: 'failed',
    ms,
    detail: message,
    tokens: attempt.usage?.total_tokens,
    cost: attempt.usage?.cost,
  }]
  return json({ error: message, retryable, trace, totalMs: ms, usage: attempt.usage, model: attempt.model }, status, origin)
}

// The provider's own error body is never copied out. Only its status code shapes the message.
function providerFailure(stage: StageId, err: ProviderStatusError, startedAt: number, origin: string | null): Response {
  if (err.status === 429) {
    return failure(stage, RATE_LIMIT_MESSAGE, 429, false, startedAt, origin)
  }
  if (err.status === 401 || err.status === 402 || err.status === 403) {
    return failure(stage, KEY_OR_CREDIT_MESSAGE, 502, false, startedAt, origin)
  }
  if (err.status >= 500) {
    return failure(stage, SLOW_MESSAGE, 502, false, startedAt, origin)
  }
  return failure(stage, 'The AI provider rejected this request.', 502, false, startedAt, origin)
}

// Plain-text preview of the output, so the trace shows what the stage produced.
function detailFor(content: string): string {
  const words = wordCount(content)
  const preview = content.replace(/\s+/g, ' ')
  const shown = preview.length > 90 ? `${preview.slice(0, 90)}…` : preview
  return `${words} ${words === 1 ? 'word' : 'words'}: ${shown}`
}

function parseRunRequest(body: unknown): RunRequest | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'The request body must be a JSON object.'
  }
  const input = body as Record<string, unknown>

  const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
  if (!topic) return 'Enter a topic first.'
  if (topic.length > MAX_TOPIC_CHARS) return `Keep the topic to ${MAX_TOPIC_CHARS} characters or fewer.`

  const contentType = typeof input.contentType === 'string' ? input.contentType : ''
  if (!(CONTENT_TYPES as readonly string[]).includes(contentType)) return 'Choose a content type from the list.'

  const stage = STAGE_IDS.find(id => id === input.stage)
  if (!stage) return `Unknown stage. Expected one of: ${STAGE_IDS.join(', ')}.`

  // Only known stage keys are kept. Any model field the browser sends is ignored.
  const supplied: unknown = input.context ?? {}
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
    return 'The stage outputs must be a JSON object.'
  }
  const outputs = supplied as Record<string, unknown>
  const context: Partial<Record<StageId, string>> = {}
  for (const id of STAGE_IDS) {
    const value = outputs[id]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length > MAX_STAGE_TEXT_CHARS) {
      return `The ${STAGE_LABELS[id]} output is not valid.`
    }
    context[id] = value
  }

  const missing = STAGE_INPUTS[stage].filter(id => !context[id]?.trim())
  if (missing.length > 0) {
    return `The ${STAGE_LABELS[stage]} stage needs the ${missing.map(id => STAGE_LABELS[id]).join(' and ')} output first.`
  }
  return { topic, contentType, stage, context }
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError'
}

async function runStage(run: RunRequest, req: Request, origin: string | null): Promise<Response> {
  const { stage } = run
  const label = STAGE_LABELS[stage]
  const startedAt = Date.now()
  const upstream = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    upstream.abort()
  }, MODEL_TIMEOUT_MS)
  const stopWithClient = () => upstream.abort()
  req.signal.addEventListener('abort', stopWithClient)

  try {
    const reply = await chat(
      buildSystemPrompt(stage, run.topic, run.contentType),
      buildUserMessage(stage, run.topic, run.contentType, run.context),
      STAGE_MAX_TOKENS,
      upstream.signal,
    )
    const ms = Date.now() - startedAt
    const attempt: Attempt = { usage: reply.usage, model: reply.servedModel ?? MODEL }
    const rejection = rejectOutput(stage, reply, run.context)
    if (rejection) {
      return failure(stage, rejection.message, 502, rejection.retryable, startedAt, origin, attempt)
    }

    const content = reply.content.trim()
    const row: TraceRow = {
      name: label,
      status: 'ok',
      ms,
      detail: detailFor(content),
      tokens: reply.usage?.total_tokens,
      cost: reply.usage?.cost,
    }
    return json({ result: content, trace: [row], usage: reply.usage, model: attempt.model, totalMs: ms }, 200, origin)
  } catch (err) {
    if (req.signal.aborted) {
      return failure(stage, 'The run was stopped before this stage finished.', 503, false, startedAt, origin)
    }
    if (timedOut || isAbortError(err)) {
      return failure(stage, SLOW_MESSAGE, 504, false, startedAt, origin)
    }
    if (err instanceof ProviderStatusError) {
      return providerFailure(stage, err, startedAt, origin)
    }
    console.error(`${stage} stage failed: ${err instanceof Error ? err.name : 'unknown error'}`)
    return failure(stage, 'Could not get a usable answer from the AI provider. Try again.', 502, false, startedAt, origin)
  } finally {
    clearTimeout(timer)
    req.signal.removeEventListener('abort', stopWithClient)
  }
}

async function handle(req: Request, origin: string | null): Promise<Response> {
  if (!originAllowed(origin)) {
    return new Response('Origin not allowed', { status: 403, headers: corsHeaders(null) })
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) })
  }
  if (rateLimited(clientKey(req))) {
    return json({ error: 'Too many runs from this connection. Wait a minute and try again.', retryable: false }, 429, origin)
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return json({ error: 'The AI provider is not set up for this site.', retryable: false }, 500, origin)
  }

  // The declared length is checked before the body is read, and the measured length after.
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) {
    return json({ error: TOO_LARGE_MESSAGE, retryable: false }, 413, origin)
  }
  const raw = await req.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ error: TOO_LARGE_MESSAGE, retryable: false }, 413, origin)
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'The request is not valid JSON.', retryable: false }, 400, origin)
  }

  const parsed = parseRunRequest(body)
  if (typeof parsed === 'string') {
    return json({ error: parsed, retryable: false }, 400, origin)
  }
  return runStage(parsed, req, origin)
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  try {
    return await handle(req, origin)
  } catch (err) {
    console.error(`ai function failed: ${err instanceof Error ? err.name : 'unknown error'}`)
    return json({ error: UNEXPECTED_MESSAGE, retryable: false }, 500, origin)
  }
}

export const config = { path: '/api/ai' }
