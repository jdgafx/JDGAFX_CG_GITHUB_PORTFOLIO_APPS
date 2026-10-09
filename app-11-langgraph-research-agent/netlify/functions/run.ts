import { DONE_FRAME, encodeFrame, type Frame } from '../shared/events'
import { allowedOrigins, clientKey, corsHeaders, createRateLimiter, originAllowed, readJsonBody, validateQuestion } from '../shared/guard'
import { SERVER_ERROR } from '../shared/errors'
import { runResearch } from '../shared/graph/stream'
import { chat, NOT_CONFIGURED_MESSAGE } from '../shared/openrouter'
import { liveWiki } from '../shared/wikipedia'

/**
 * One budget for every model and tool call in a run. The docs give synchronous functions 60 seconds, but the
 * live site closed streams near 30 seconds, so the run ends itself well before that and says why.
 */
export const RUN_BUDGET_MS = 25_000

const limiter = createRateLimiter()

function fail(message: string, status: number, headers: Record<string, string>): Response {
  return Response.json({ success: false, error: message }, { status, headers })
}

/** Starts the run and returns its SSE stream at once. Frames follow as the graph moves. */
function streamRun(question: string, headers: Record<string, string>): Response {
  const encoder = new TextEncoder()
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(), RUN_BUDGET_MS)
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (frame: Frame) => {
        if (!closed) controller.enqueue(encoder.encode(encodeFrame(frame)))
      }
      const finish = () => {
        if (closed) return
        closed = true
        clearTimeout(timer)
        controller.enqueue(encoder.encode(DONE_FRAME))
        controller.close()
      }
      void runResearch(question, { chat, wiki: liveWiki, signal: budget.signal }, emit)
        .catch(() => emit({ type: 'error', message: SERVER_ERROR }))
        .finally(finish)
    },
    cancel() {
      closed = true
      clearTimeout(timer)
      budget.abort()
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
