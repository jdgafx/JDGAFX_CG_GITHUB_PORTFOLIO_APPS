import { RunBudget } from './budget'
import { SERVER_MESSAGE } from './errors'
import { DONE_FRAME, encodeFrame } from './events'
import { allowedOrigins, clientKey, corsHeaders, rateLimit, readJsonBody, validateRunBody } from './guard'
import { RUN_BUDGET_MS, runPipeline } from './pipeline'

export interface HandlerOptions {
  /** Whole-run budget in milliseconds. Defaults to 50 s. */
  budgetMs?: number
  /** Per model call timeout in milliseconds. Defaults to 20 s. */
  callTimeoutMs?: number
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

/** POST /api/run. Validation failures are plain JSON 4xx responses. A started run streams SSE frames. */
export function createRunHandler(options: HandlerOptions = {}): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handleRun(req, options)
    } catch (err) {
      console.error('GraphSwarm: unexpected server error', err instanceof Error ? err.name : 'unknown')
      return fail(SERVER_MESSAGE, 500, {})
    }
  }
}

async function handleRun(req: Request, options: HandlerOptions): Promise<Response> {
  const allowed = allowedOrigins(process.env.ALLOWED_ORIGINS)
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin, allowed)
  if (origin && !allowed.includes(origin)) return fail('Origin not allowed.', 403, cors)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return fail('Method not allowed.', 405, { ...cors, Allow: 'POST, OPTIONS' })

  const limit = rateLimit(clientKey(req), Date.now())
  if (!limit.allowed) {
    return fail('Too many runs from this address. Please wait a moment and try again.', 429, {
      ...cors,
      'Retry-After': String(limit.retryAfter),
    })
  }

  if (!process.env.OPENROUTER_API_KEY) return fail('The analysis service is not configured.', 503, cors)

  const body = await readJsonBody(req)
  if (!body.ok) return fail(body.error, body.status, cors)
  const checked = validateRunBody(body.value)
  if (!checked.ok) return fail(checked.error, checked.status, cors)
  return streamRun(checked.text, options, cors)
}

/** Starts the run and returns its frames as they are produced. The stream always ends with [DONE]. */
function streamRun(text: string, options: HandlerOptions, cors: Record<string, string>): Response {
  const budget = new RunBudget(options.budgetMs ?? RUN_BUDGET_MS)
  const encoder = new TextEncoder()
  let open = true
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string): void => {
        if (open) controller.enqueue(encoder.encode(chunk))
      }
      runPipeline({
        text,
        budget,
        callTimeoutMs: options.callTimeoutMs,
        sink: (frame) => write(encodeFrame(frame)),
      })
        .catch((err: unknown) => {
          console.error('GraphSwarm: stream ended unexpectedly', err instanceof Error ? err.name : 'unknown')
        })
        .finally(() => {
          write(DONE_FRAME)
          budget.dispose()
          if (open) {
            open = false
            controller.close()
          }
        })
    },
    cancel() {
      open = false
      budget.cancel()
      budget.dispose()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      ...cors,
    },
  })
}
