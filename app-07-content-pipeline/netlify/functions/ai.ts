import { chat, MODEL, ProviderStatusError, type ChatReply } from '../shared/provider'
import { CONTENT_TYPES, MAX_TOPIC_CHARS, STAGE_IDS, STAGE_LABELS, TOPIC_TOO_LONG_MESSAGE, wordCount, type ModelStageId, type StageId, type TraceRow, type Usage } from '../shared/contract'
import {
  MAX_STAGE_TEXT_CHARS, STAGE_INPUTS, buildSystemPrompt, buildUserMessage, plainPreview, rejectOutput, retryFits, stageMaxTokens, stageTimeoutMs,
} from '../shared/stages'
import { withDeadline } from '../shared/deadline'
import { gatherSources } from '../shared/sources'
import { formatSourcePack, parseSourcePack, withSources, KIND_LABELS, type SourcePack } from '../shared/sourcepack'
import { clientKey, corsHeaders, originAllowed, rateLimited } from '../shared/access'

// Each stage is one request with one short model call, tried a second time if it hung, and the
// browser chains the requests. The per-stage call limits and the request budget are in stages.ts.
// Four full stage outputs, with room for UTF-8 and JSON escapes.
const MAX_BODY_BYTES = 128 * 1024

const SLOW_MESSAGE = 'The AI provider did not answer in time.'
const TOO_LARGE_MESSAGE = 'The request is too large.'

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

// Every failure has a plain message, a retry hint and one failed trace row. A call that
// reached the provider keeps its usage and model, because the provider still billed it.
function failureFor(stage: StageId, startedAt: number, origin: string | null) {
  return (
    message: string,
    status: number,
    retryable: boolean,
    attempt: { usage: Usage | null; model: string | null } = { usage: null, model: null },
    note?: string,
  ): Response => {
    const ms = Date.now() - startedAt
    const trace: TraceRow[] = [{
      name: STAGE_LABELS[stage],
      status: 'failed',
      ms,
      detail: note ? `${message} ${note}` : message,
      tokens: attempt.usage?.total_tokens,
      cost: attempt.usage?.cost,
    }]
    return json({ error: message, retryable, trace, totalMs: ms, usage: attempt.usage, model: attempt.model }, status, origin)
  }
}

// The provider's own error body is never copied out. Only its status code shapes the message.
function providerOutcome(status: number): { message: string; httpStatus: number } {
  if (status === 429) return { message: 'Rate limited, try again in a minute.', httpStatus: 429 }
  if (status === 401 || status === 402 || status === 403) {
    return { message: 'The AI provider rejected the key or is out of credit.', httpStatus: 502 }
  }
  if (status >= 500) return { message: SLOW_MESSAGE, httpStatus: 502 }
  return { message: 'The AI provider rejected this request.', httpStatus: 502 }
}

function detailFor(content: string): string {
  const words = wordCount(content)
  return `${words} ${words === 1 ? 'word' : 'words'}: ${plainPreview(content, 90)}`
}

// What the Sources row in the trace says: what was found and, honestly, what was not.
function sourcesDetail(pack: SourcePack): string {
  const found = pack.sources.length
  const notes = pack.notes.join(' ')
  if (found === 0) return `No sources found. ${notes}`.trim()
  const counts = (['wikipedia', 'hackernews'] as const)
    .map(kind => `${pack.sources.filter(source => source.kind === kind).length} ${KIND_LABELS[kind]}`)
    .join(', ')
  return `${found} ${found === 1 ? 'source' : 'sources'}: ${counts}. ${notes}`.trim()
}

function parseRunRequest(body: unknown): RunRequest | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'The request body must be a JSON object.'
  }
  const input = body as Record<string, unknown>

  const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
  if (!topic) return 'Enter a topic first.'
  if (topic.length > MAX_TOPIC_CHARS) return TOPIC_TOO_LONG_MESSAGE

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
  return err instanceof DOMException && err.name === 'AbortError'
}

// The Sources stage makes no model call. A lookup that finds nothing still answers 200 with a pack
// that says so, so the writing continues, labelled as unsourced.
async function runSources(run: RunRequest, req: Request, origin: string | null): Promise<Response> {
  const startedAt = Date.now()
  let pack: SourcePack
  try {
    pack = await gatherSources(run.topic, run.contentType, req.signal)
  } catch (err) {
    console.error(`sources lookup failed: ${err instanceof Error ? err.name : 'unknown error'}`)
    pack = { sources: [], notes: ['The source lookup failed.'] }
  }
  if (req.signal.aborted) {
    return failureFor('sources', startedAt, origin)('The run was stopped before this stage finished.', 503, false)
  }
  const ms = Date.now() - startedAt
  const row: TraceRow = { name: STAGE_LABELS.sources, status: 'ok', ms, detail: sourcesDetail(pack) }
  return json({ result: formatSourcePack(pack), trace: [row], usage: null, model: null, totalMs: ms }, 200, origin)
}

// A call that hung (our own deadline fired) or never connected is tried once more, if the request
// still has the time. A provider status (4xx, 429, 5xx), a refused reply and a stop by the user are
// never tried again here.
function retryNote(err: unknown, limitMs: number): string | null {
  if (err instanceof DOMException && err.name === 'TimeoutError') return `Retried once after a timeout of ${limitMs / 1000} s.`
  if (err instanceof TypeError) return 'Retried once after a connection failure.'
  return null
}

async function runModelStage(run: RunRequest & { stage: ModelStageId }, req: Request, origin: string | null): Promise<Response> {
  const { stage } = run
  const startedAt = Date.now()
  const fail = failureFor(stage, startedAt, origin)
  const sources = parseSourcePack(run.context.sources ?? '')
  const system = buildSystemPrompt(stage, run.topic, run.contentType, sources.sources.length)
  const user = buildUserMessage(stage, run.topic, run.contentType, run.context)
  const limitMs = stageTimeoutMs(stage)
  let retried: string | null = null

  try {
    let reply: ChatReply
    for (let attempt = 0; ; attempt += 1) {
      try {
        reply = await withDeadline(limitMs, req.signal, signal => chat(system, user, stageMaxTokens(stage), signal))
        break
      } catch (err) {
        const note = retryNote(err, limitMs)
        if (attempt > 0 || !note || req.signal.aborted || !retryFits(Date.now() - startedAt, limitMs)) {
          throw err
        }
        retried = note
      }
    }
    const ms = Date.now() - startedAt
    const attempt = { usage: reply.usage, model: reply.servedModel ?? MODEL }
    const rejection = rejectOutput(stage, reply, run.context)
    if (rejection) {
      return fail(rejection.message, 502, rejection.retryable, attempt, retried ?? undefined)
    }

    // The last stage ends the piece with its Sources list, built from the lookup and not from model text.
    const text = reply.content.trim()
    const content = stage === 'polish' ? withSources(text, sources, run.contentType) : text
    const row: TraceRow = {
      name: STAGE_LABELS[stage],
      status: 'ok',
      ms,
      detail: [retried, detailFor(content)].filter(Boolean).join(' '),
      tokens: reply.usage?.total_tokens,
      cost: reply.usage?.cost,
    }
    return json({ result: content, trace: [row], usage: reply.usage, model: attempt.model, totalMs: ms }, 200, origin)
  } catch (err) {
    if (req.signal.aborted) {
      return fail('The run was stopped before this stage finished.', 503, false)
    }
    if ((err instanceof DOMException && err.name === 'TimeoutError') || isAbortError(err)) {
      return fail(SLOW_MESSAGE, 504, false, undefined, retried ?? undefined)
    }
    if (err instanceof ProviderStatusError) {
      const { message, httpStatus } = providerOutcome(err.status)
      return fail(message, httpStatus, false)
    }
    console.error(`${stage} stage failed: ${err instanceof Error ? err.name : 'unknown error'}`)
    return fail('Could not get a usable answer from the AI provider. Try again.', 502, false, undefined, retried ?? undefined)
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
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
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
  return parsed.stage === 'sources' ? runSources(parsed, req, origin) : runModelStage({ ...parsed, stage: parsed.stage }, req, origin)
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  try {
    return await handle(req, origin)
  } catch (err) {
    console.error(`ai function failed: ${err instanceof Error ? err.name : 'unknown error'}`)
    return json({ error: 'Something went wrong on the server. Try again.', retryable: false }, 500, origin)
  }
}

export const config = { path: '/api/ai' }
