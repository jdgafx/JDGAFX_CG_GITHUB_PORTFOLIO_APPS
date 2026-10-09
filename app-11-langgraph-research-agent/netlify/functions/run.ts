import { DONE_FRAME, encodeFrame, HEARTBEAT, type Frame } from '../shared/events'
import { allowedOrigins, clientKey, corsHeaders, createRateLimiter, originAllowed, readJsonBody, validateQuestion } from '../shared/guard'
import { SERVER_ERROR } from '../shared/errors'
import { runResearch } from '../shared/graph/stream'
import { BUDGET_MESSAGE, chat, NOT_CONFIGURED_MESSAGE } from '../shared/openrouter'
import { liveWiki } from '../shared/wikipedia'

/**
 * One budget for every model and tool call in a run. The docs give synchronous functions 60 seconds, but the
 * live site closed streams near 30 seconds, so the run ends itself well before that and says why.
 */
export const RUN_BUDGET_MS = 25_000

/** If the run has not returned this long after its budget aborted, the stream is closed with the budget message anyway. */
export const HARD_STOP_GRACE_MS = 2_000
/** How often a comment line is sent while the run works. */
export const HEARTBEAT_MS = 5_000

const limiter = createRateLimiter()

function fail(message: string, status: number, headers: Record<string, string>): Response {
  return Response.json({ success: false, error: message }, { status, headers })
}

/** Starts the run and returns its SSE stream at once. Frames follow as the graph moves. */
function streamRun(question: string, headers: Record<string, string>): Response {
  const encoder = new TextEncoder()
  const budget = new AbortController()
  const startedAt = Date.now()
  const deadline = startedAt + RUN_BUDGET_MS
  const runId = crypto.randomUUID().slice(0, 8)
  const timer = setTimeout(() => budget.abort(), RUN_BUDGET_MS)
  let hardStop: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false
  let frames = 0
  let outcome = 'ended'
  let logged = false

  // One line at the start and one at the end of every run, with no question text, so a function log can
  // tell a run that ended from a stream that was held open.
  const logEnd = () => {
    if (logged) return
    logged = true
    console.log('GraphScout: run end', JSON.stringify({ runId, outcome, totalMs: Date.now() - startedAt, frames }))
  }
  const stopTimers = () => {
    clearTimeout(timer)
    clearTimeout(hardStop)
    clearInterval(heartbeat)
  }
  console.log('GraphScout: run start', JSON.stringify({ runId }))

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (frame: Frame) => {
        if (closed) return
        frames += 1
        if (frame.type === 'result') outcome = `result:${frame.ending.kind}`
        else if (frame.type === 'error') outcome = 'error'
        controller.enqueue(encoder.encode(encodeFrame(frame)))
      }
      const finish = () => {
        if (closed) return
        closed = true
        stopTimers()
        controller.enqueue(encoder.encode(DONE_FRAME))
        controller.close()
        logEnd()
      }
      emit({ type: 'run_start', runId })
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(HEARTBEAT))
      }, HEARTBEAT_MS)
      hardStop = setTimeout(() => {
        emit({ type: 'error', message: BUDGET_MESSAGE })
        outcome = 'hard-stop'
        finish()
      }, RUN_BUDGET_MS + HARD_STOP_GRACE_MS)
      void runResearch(question, { chat, wiki: liveWiki, signal: budget.signal, deadline }, emit)
        .catch(() => emit({ type: 'error', message: SERVER_ERROR }))
        .finally(finish)
    },
    cancel() {
      closed = true
      stopTimers()
      budget.abort()
      outcome = 'cancelled'
      logEnd()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}

export default async (req: Request): Promise<Response> => {
  let headers: Record<string, string> = {}
  try {
    const origin = req.headers.get('origin')
    const allowed = allowedOrigins(process.env.ALLOWED_ORIGINS)
    headers = corsHeaders(origin, allowed)
    if (!originAllowed(origin, allowed)) return fail('Origin not allowed.', 403, headers)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') return fail('Method not allowed.', 405, headers)

    const limit = limiter.check(clientKey(req), Date.now())
    if (!limit.allowed) {
      return fail('Rate limited, try again in a minute.', 429, {
        ...headers,
        'Retry-After': String(limit.retryAfterSec),
      })
    }

    if (!process.env.OPENROUTER_API_KEY) return fail(NOT_CONFIGURED_MESSAGE, 503, headers)

    const body = await readJsonBody(req)
    if (!body.ok) return fail(body.message, body.status, headers)
    const checked = validateQuestion(body.value)
    if (!checked.ok) return fail(checked.message, 400, headers)

    return streamRun(checked.question, headers)
  } catch (err) {
    console.error('GraphScout: unexpected server error', err instanceof Error ? err.name : 'unknown')
    return fail(SERVER_ERROR, 500, headers)
  }
}

export const config = {
  path: '/api/run',
}
