import { chat, MODEL, ProviderStatusError, type Usage } from '../shared/provider'
import {
  CONTENT_TYPES, STAGE_IDS, STAGE_INPUTS, STAGE_LABELS, buildSystemPrompt, buildUserMessage,
  rejectOutput, wordCount, type StageId,
} from '../shared/stages'
import { clientKey, corsHeaders, originAllowed, rateLimited } from '../shared/access'

// Each stage is one short model call and the browser chains five of them. The
// timeout keeps every call inside Netlify's synchronous limit (about 10 seconds).
const MODEL_TIMEOUT_MS = 8_000
// A ceiling only. The word budgets and the timeout set the real length.
const STAGE_MAX_TOKENS = 4_096
const MAX_BODY_CHARS = 32_000
const MAX_TOPIC_CHARS = 400
const MAX_STAGE_TEXT_CHARS = 8_000

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

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

// Every failure has a plain message, a retry hint and one failed trace row.
function failure(
  stage: StageId,
  message: string,
  status: number,
  retryable: boolean,
  startedAt: number,
  origin: string | null,
): Response {
  const ms = Date.now() - startedAt
  const trace: TraceRow[] = [{ name: STAGE_LABELS[stage], status: 'failed', ms, detail: message }]
  return json({ error: message, retryable, trace, totalMs: ms }, status, origin)
}

function providerFailure(stage: StageId, err: ProviderStatusError, startedAt: number, origin: string | null): Response {
  if (err.status === 402) {
    return failure(stage, 'The AI provider is out of credit, so this stage cannot run. The site owner needs to add credit.', 503, false, startedAt, origin)
  }
  if (err.status === 429) {
    return failure(stage, 'The AI provider is rate limiting requests right now. Wait a minute and try again.', 429, false, startedAt, origin)
  }
  if (err.status === 401 || err.status === 403) {
    return failure(stage, "The AI provider rejected this site's credentials.", 502, false, startedAt, origin)
  }
  if (err.status >= 500) {
    return failure(stage, 'The AI provider failed on this request. Try again.', 502, true, startedAt, origin)
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
  if (!body || typeof body !== 'object') {
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
  const context: Partial<Record<StageId, string>> = {}
  if (input.context && typeof input.context === 'object') {
    const supplied = input.context as Record<string, unknown>
    for (const id of STAGE_IDS) {
      const value = supplied[id]
      if (value === undefined) continue
      if (typeof value !== 'string' || value.length > MAX_STAGE_TEXT_CHARS) {
        return `The ${STAGE_LABELS[id]} output is not valid.`
      }
      context[id] = value
    }
  }

  const missing = STAGE_INPUTS[stage].filter(id => !context[id]?.trim())
  if (missing.length > 0) {
    return `The ${STAGE_LABELS[stage]} stage needs the ${missing.map(id => STAGE_LABELS[id]).join(' and ')} output first.`
  }
  return { topic, contentType, stage, context }
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
    const rejection = rejectOutput(stage, reply, run.context)
    if (rejection) {
      return failure(stage, rejection.message, 502, rejection.retryable, startedAt, origin)
    }

    const content = reply.content.trim()
    const usage: Usage | null = reply.usage
    const row: TraceRow = {
      name: label,
      status: 'ok',
      ms,
      detail: detailFor(content),
      tokens: usage?.total_tokens,
      cost: usage?.cost,
    }
    return json({ result: content, trace: [row], usage, model: reply.servedModel ?? MODEL, totalMs: ms }, 200, origin)
  } catch (err) {
    if (timedOut) {
      return failure(stage, `The ${label} stage ran past ${MODEL_TIMEOUT_MS / 1000} seconds and was stopped. Try again.`, 504, true, startedAt, origin)
    }
    if (req.signal.aborted) {
      return failure(stage, 'The run was stopped before this stage finished.', 503, false, startedAt, origin)
    }
    if (err instanceof ProviderStatusError) {
      return providerFailure(stage, err, startedAt, origin)
    }
    console.error(`${stage} stage failed: ${err instanceof Error ? err.name : 'unknown error'}`)
    return failure(stage, 'Could not get a usable answer from the AI provider. Try again.', 502, true, startedAt, origin)
  } finally {
    clearTimeout(timer)
    req.signal.removeEventListener('abort', stopWithClient)
  }
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')

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

  const raw = await req.text()
  if (raw.length > MAX_BODY_CHARS) {
    return json({ error: 'The request is too large.', retryable: false }, 413, origin)
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

export const config = { path: '/api/ai' }
