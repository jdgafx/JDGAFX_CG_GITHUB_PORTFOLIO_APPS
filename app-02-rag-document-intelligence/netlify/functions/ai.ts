import { getProvider, MODEL, type ProviderConfig } from '../shared/provider'
import { runAnswer, type AnswerInput, type RunOutcome, type RunPayload, type TraceStep } from '../shared/answer'
import {
  clientKey,
  corsHeaders,
  originAllowed,
  RATE_LIMIT_MESSAGE,
  rateLimited,
  RATE_LIMIT_WINDOW_MS,
  readJsonBody,
  validate,
} from '../shared/http'

export const config = { path: '/api/ai' }

const FAILED_MESSAGE = 'The document assistant failed. Please try again.'

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

/** The Origin header, or null when the request's headers cannot be read. */
function originOf(req: Request): string | null {
  try {
    return req.headers.get('origin')
  } catch {
    return null
  }
}

function streamRun(
  input: AnswerInput,
  provider: ProviderConfig,
  started: number,
  headers: Record<string, string>,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Once the reader has gone, enqueue throws. The run still finishes, and close is still attempted.
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          // The reader has gone.
        }
      }
      const send = (frame: StreamFrame) => write(`data: ${JSON.stringify(frame)}\n\n`)
      try {
        const outcome = await runAnswer(
          input,
          provider,
          started,
          {
            start: name => send({ type: 'start', name }),
            step: step => send({ type: 'step', step }),
          },
          signal,
        )
        send(outcome.ok
          ? { type: 'result', run: runBody(outcome) }
          : { type: 'error', error: outcome.error, trace: outcome.trace, totalMs: outcome.totalMs })
      } catch (err) {
        console.error('DocMind run failed:', err)
        send({ type: 'error', error: FAILED_MESSAGE, trace: [], totalMs: Date.now() - started })
      }
      write('data: [DONE]\n\n')
      try {
        controller.close()
      } catch {
        // Already closed, because the reader cancelled the stream.
      }
    },
  })
  return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}

async function respond(req: Request, started: number): Promise<Response> {
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
    return json(429, { error: RATE_LIMIT_MESSAGE }, { 'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) })
  }

  const read = await readJsonBody(req)
  if (!read.ok) {
    return json(read.status, { error: read.message })
  }

  const validated = validate(read.body)
  if (!validated.ok) {
    return json(validated.status, { error: validated.message })
  }

  const provider = getProvider(MODEL)
  if (!provider) {
    return json(500, { error: 'The document assistant is not configured on this deployment.' })
  }

  if (req.headers.get('accept')?.includes('text/event-stream')) {
    return streamRun(validated.value, provider, started, headers, req.signal)
  }

  let outcome: RunOutcome
  try {
    outcome = await runAnswer(validated.value, provider, started, { start: () => {}, step: () => {} }, req.signal)
  } catch (err) {
    console.error('DocMind run failed:', err)
    return json(500, { error: FAILED_MESSAGE })
  }
  if (!outcome.ok) {
    return json(outcome.status, { error: outcome.error, trace: outcome.trace, totalMs: outcome.totalMs })
  }
  return json(200, runBody(outcome))
}

export default async (req: Request): Promise<Response> => {
  const started = Date.now()
  try {
    return await respond(req, started)
  } catch (err) {
    console.error('DocMind request failed:', err)
    return new Response(JSON.stringify({ error: FAILED_MESSAGE }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(originOf(req)) },
    })
  }
}
