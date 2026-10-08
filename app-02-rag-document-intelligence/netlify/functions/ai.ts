import { getProvider, MODEL, type ProviderConfig } from '../shared/provider'
import { runAnswer, type AnswerInput, type RunOutcome, type RunPayload, type TraceStep } from '../shared/answer'
import { clientKey, corsHeaders, originAllowed, rateLimited, RATE_LIMIT_WINDOW_MS, validate } from '../shared/http'

export const config = { path: '/api/ai' }

/** One frame of the live stream. The browser applies them in the order they arrive. */
type StreamFrame =
  | { type: 'start'; name: string }
  | { type: 'step'; step: TraceStep }
  | { type: 'result'; run: RunPayload }
  | { type: 'error'; error: string; trace: TraceStep[]; totalMs: number }

// The brief's response shape. The client reads exactly these five fields.
function runBody(run: RunPayload): RunPayload {
  return { result: run.result, trace: run.trace, usage: run.usage, model: run.model, totalMs: run.totalMs }
}

function streamRun(input: AnswerInput, provider: ProviderConfig, started: number, headers: Record<string, string>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (frame: StreamFrame) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      try {
        const outcome = await runAnswer(input, provider, started, {
          start: name => send({ type: 'start', name }),
          step: step => send({ type: 'step', step }),
        })
        send(outcome.ok
          ? { type: 'result', run: runBody(outcome) }
          : { type: 'error', error: outcome.error, trace: outcome.trace, totalMs: outcome.totalMs })
      } catch (err) {
        console.error('DocMind run failed:', err)
        send({ type: 'error', error: 'The document assistant failed. Please try again.', trace: [], totalMs: Date.now() - started })
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}

export default async (req: Request): Promise<Response> => {
  const started = Date.now()
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)
  const json = (status: number, payload: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...headers, ...extra, 'Content-Type': 'application/json' },
    })

  if (!originAllowed(origin)) {
    return json(403, { error: 'Origin not allowed.' })
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' }, { Allow: 'POST, OPTIONS' })
  }

  if (rateLimited(clientKey(req))) {
    return json(
      429,
      { error: 'Too many requests. Please wait a moment and try again.' },
      { 'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) },
    )
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON in request body.' })
  }

  const validated = validate(rawBody)
  if (!validated.ok) {
    return json(validated.status, { error: validated.message })
  }

  const provider = getProvider(MODEL)
  if (!provider) {
    return json(500, { error: 'The document assistant is not configured on this deployment.' })
  }

  if (req.headers.get('accept')?.includes('text/event-stream')) {
    return streamRun(validated.value, provider, started, headers)
  }

  let outcome: RunOutcome
  try {
    outcome = await runAnswer(validated.value, provider, started, { start: () => {}, step: () => {} })
  } catch (err) {
    console.error('DocMind run failed:', err)
    return json(500, { error: 'The document assistant failed. Please try again.' })
  }
  if (!outcome.ok) {
    return json(outcome.status, { error: outcome.error, trace: outcome.trace, totalMs: outcome.totalMs })
  }
  return json(200, runBody(outcome))
}
