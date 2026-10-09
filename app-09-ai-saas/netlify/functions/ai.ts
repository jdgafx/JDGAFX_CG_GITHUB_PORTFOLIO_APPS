import { CHAT_URL, chatRequest } from '../shared/provider'
import type { Summary } from '../shared/contract'
import { checkClaims, ClaimSplitter, claimsPrompt, describeClaimCheck, parseClaims, splitAnswer, type ClaimCheck } from '../shared/claims'
import { buildPrompt, checkFigures, describeFigureCheck, parseInsightRequest } from '../shared/insights'
import { DONE_FRAME, encodeFrame, readProviderStream, type Emit } from '../shared/stream'

export const config = { path: '/api/ai' }

// Limits are fixed in code, not read from the environment, so no deploy setting can leave a call unbounded.
/** The explanation plus its claims array. */
const MAX_OUTPUT_TOKENS = 4096
const MAX_BODY_BYTES = 32_000
const UPSTREAM_TIMEOUT_MS = 25_000
/** How long one request to the provider may take to be accepted: about 1.5 times a healthy call's wait for response headers. */
const CALL_LIMIT_MS = 10_000
/** A second attempt needs at least this much of the run's budget left, so it can still stream an answer. */
const RETRY_MIN_BUDGET_MS = 8_000
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

const STAGES = ['Build request', 'Call model', 'Stream answer', 'Check figures', 'Validate output'] as const
type Stage = (typeof STAGES)[number]

interface TraceStep {
  name: string
  status: 'ok' | 'failed' | 'skipped'
  ms: number
  detail: string
  tokens?: number
  cost?: number
  /** For the figure check: the structured result, so the page can underline each rejected figure. */
  check?: ClaimCheck
}

type HeaderMap = Record<string, string>

const GENERIC_FAILURE = 'Insight generation failed. Please try again.'
const TOO_LARGE = 'Request body is too large'
const TIMEOUT_MESSAGE = `The AI provider did not answer within ${UPSTREAM_TIMEOUT_MS / 1000} seconds. Try again.`

/** Browser origins allowed to call this endpoint. Netlify injects URL / DEPLOY_PRIME_URL for the live site and deploy previews, so the deployed host never has to be hardcoded here. */
function allowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS?.split(',') ?? []
  return [
    ...configured,
    process.env.URL ?? '',
    process.env.DEPLOY_PRIME_URL ?? '',
    process.env.DEPLOY_URL ?? '',
    'https://jdgafx-app-09-ai-saas.netlify.app',
    'http://localhost:8888',
    'http://localhost:5173',
  ]
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

function corsHeaders(origin: string | null): HeaderMap {
  const headers: HeaderMap = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

// Requests without an Origin header are not browser cross-site traffic (curl,
// server-to-server), so they are allowed through without an echo header.
function originAllowed(origin: string | null): boolean {
  if (!origin) return true
  return allowedOrigins().includes(origin.replace(/\/$/, ''))
}

// Best-effort per-instance throttle. Netlify may run many warm instances, so
// this is a cost guard rather than a hard quota.
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  for (const [k, v] of rateBuckets) {
    if (v.resetAt <= now) rateBuckets.delete(k)
  }
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT_MAX
}

function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

// Provider bodies name the account and key, so the browser only ever gets these plain sentences.
function providerFailure(status: number): string {
  if (status === 401 || status === 403) return 'The AI provider rejected the server credentials. The site owner needs to check the provider key.'
  if (status === 402) return 'The AI provider is out of credit, so no analysis could be generated.'
  if (status === 429) return 'The AI provider is rate limiting requests. Try again in a minute.'
  if (status >= 500) return 'The AI provider failed to respond. Try again shortly.'
  return `The AI provider rejected the request (HTTP ${status}).`
}

/** A fetch or stream read that was aborted by the runtime rather than by the viewer, which means the provider timed out. */
function isTimeoutError(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null && 'name' in err ? err.name : undefined
  return name === 'AbortError' || name === 'TimeoutError'
}

interface ProviderCall {
  response: Response
  /** Why the first attempt was repeated, or null when the first attempt was accepted. */
  retriedAfter: string | null
}

/**
 * Sends the chat request. Each attempt has its own time limit. One automatic retry follows a timeout or a
 * connection failure when the run's budget allows. An HTTP error status is returned as a response, never
 * retried, and neither is the viewer leaving or the run's deadline.
 */
async function callProvider(body: string, apiKey: string, upstream: AbortController, deadlineAt: number): Promise<ProviderCall> {
  let retriedAfter: string | null = null
  for (let attempt = 1; ; attempt++) {
    const call = new AbortController()
    const forward = () => call.abort()
    upstream.signal.addEventListener('abort', forward, { once: true })
    let limited = false
    const timer = setTimeout(() => {
      limited = true
      call.abort()
    }, CALL_LIMIT_MS)
    try {
      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: call.signal,
      })
      return { response, retriedAfter }
    } catch (err) {
      upstream.signal.removeEventListener('abort', forward)
      if (upstream.signal.aborted || attempt === 2 || deadlineAt - Date.now() < RETRY_MIN_BUDGET_MS) throw err
      retriedAfter = limited ? `the first attempt timed out after ${CALL_LIMIT_MS / 1000} seconds` : 'the first attempt could not connect'
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * One insight run. Each stage is timed here with Date.now() and sent as a step frame as soon as
 * it finishes, so the browser can draw the trace while the answer streams in.
 */
async function runInsight(summary: Summary, apiKey: string, upstream: AbortController, emit: Emit): Promise<void> {
  const started = Date.now()
  const steps: TraceStep[] = []
  // A property rather than a let, so the catch block reads the live stage without TypeScript narrowing it.
  const run: { stage: Stage; stageStart: number; timedOut: boolean } = {
    stage: 'Build request',
    stageStart: started,
    timedOut: false,
  }

  const record = (step: TraceStep) => {
    steps.push(step)
    emit({ step })
  }
  const finishStage = (status: TraceStep['status'], detail: string, extra: Pick<TraceStep, 'tokens' | 'cost' | 'check'> = {}) => {
    record({ name: run.stage, status, ms: Date.now() - run.stageStart, detail, ...extra })
  }
  const beginStage = (next: Stage) => {
    run.stage = next
    run.stageStart = Date.now()
  }
  const failRun = (message: string) => {
    finishStage('failed', message)
    for (const later of STAGES.slice(STAGES.indexOf(run.stage) + 1)) {
      record({ name: later, status: 'skipped', ms: 0, detail: 'Not run: an earlier step failed' })
    }
    emit({ error: message, totalMs: Date.now() - started })
  }

  // One deadline covers the whole run: the provider call and the stream that follows it.
  const timer = setTimeout(() => {
    run.timedOut = true
    upstream.abort()
  }, UPSTREAM_TIMEOUT_MS)

  try {
    const prompt = buildPrompt(summary) + claimsPrompt()
    const packages = summary.packages.length
    finishStage('ok', `${packages} ${packages === 1 ? 'package' : 'packages'}, ${summary.startDate} to ${summary.endDate}`)

    beginStage('Call model')
    const { response, retriedAfter } = await callProvider(
      JSON.stringify(chatRequest(prompt, MAX_OUTPUT_TOKENS)),
      apiKey,
      upstream,
      started + UPSTREAM_TIMEOUT_MS,
    )
    if (!response.ok) {
      // Status only: the provider body names the account, so it is never logged or sent.
      console.error(`ai function: provider HTTP ${response.status}`)
      return failRun(providerFailure(response.status))
    }
    finishStage(
      'ok',
      `OpenRouter accepted the request (HTTP ${response.status})${retriedAfter ? `. Retried once: ${retriedAfter}` : ''}`,
    )

    beginStage('Stream answer')
    if (!response.body) return failRun('The AI provider returned an empty response. Try again.')
    // The claims array follows the explanation after a marker line. The viewer sees the explanation only.
    const splitter = new ClaimSplitter()
    const answer = await readProviderStream(
      response.body,
      (frame) => {
        if ('text' in frame && typeof frame.text === 'string') {
          const shown = splitter.push(frame.text)
          if (shown) emit({ text: shown })
        } else emit(frame)
      },
      upstream.signal,
    )
    if (upstream.signal.aborted) {
      // The deadline or the viewer ended the run while the stream was open. Only the deadline gets a message.
      if (run.timedOut) return failRun(TIMEOUT_MESSAGE)
      return
    }
    if (answer.providerError !== null) return failRun(providerFailure(answer.providerError))
    const tail = splitter.flush()
    if (tail) emit({ text: tail })
    const { explanation, claimsRaw } = splitAnswer(answer.text)
    finishStage('ok', `${answer.chunks} ${answer.chunks === 1 ? 'chunk' : 'chunks'}, ${explanation.length} characters`, {
      tokens: answer.usage?.total_tokens,
      cost: answer.usage?.cost,
    })

    beginStage('Check figures')
    // With a valid claims array each claimed figure is checked against the value the claim names. Without one, the
    // whole explanation goes through the sentence-reading check.
    const claims = claimsRaw === null ? null : parseClaims(claimsRaw)
    if (claims) {
      const claimCheck = checkClaims(explanation, claims, summary)
      finishStage(claimCheck.rejected.length > 0 ? 'failed' : 'ok', describeClaimCheck(claimCheck), { check: claimCheck })
    } else {
      const check = checkFigures(explanation, summary)
      finishStage(check.unmatched.length > 0 ? 'failed' : 'ok', `${describeFigureCheck(check)}${claimsRaw === null ? '' : '. The claims array could not be read, so every figure was read from its sentence'}`)
    }

    beginStage('Validate output')
    // A stream is finished once it sent [DONE] or a finish reason. Anything else was cut off on the way.
    if (!answer.done && answer.finishReason === null) return failRun('The answer was cut off before it finished.')
    if (!explanation.trim()) return failRun('The model returned no text. Try again.')
    const cut = answer.finishReason === 'length'
    finishStage(
      cut ? 'failed' : 'ok',
      cut ? `Stopped at the ${MAX_OUTPUT_TOKENS}-token output cap, so the answer may be cut short` : 'Non-empty answer that finished normally',
    )

    emit({
      stage: 'complete',
      result: explanation,
      trace: steps,
      usage: answer.usage,
      model: answer.model,
      totalMs: Date.now() - started,
    })
  } catch (err) {
    // The viewer left (Stop or navigation), so there is no one to tell.
    if (upstream.signal.aborted && !run.timedOut) return
    console.error('ai function: stream failed', err)
    const message = run.timedOut || isTimeoutError(err)
      ? TIMEOUT_MESSAGE
      : run.stage === 'Call model'
        ? 'Could not reach the AI provider. Try again shortly.'
        : 'The AI provider connection dropped. Try again shortly.'
    failRun(message)
  } finally {
    clearTimeout(timer)
  }
}

function jsonResponse(status: number, body: { error: string }, headers: HeaderMap): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function streamInsight(summary: Summary, apiKey: string, headers: HeaderMap): Response {
  const encoder = new TextEncoder()
  const upstream = new AbortController()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (frame) => {
        try {
          controller.enqueue(encoder.encode(encodeFrame(frame)))
        } catch {
          // The viewer has gone; cancel() has already stopped the provider call.
        }
      }
      try {
        await runInsight(summary, apiKey, upstream, emit)
      } catch (err) {
        console.error('ai function: run failed', err)
        emit({ error: GENERIC_FAILURE })
      } finally {
        try {
          controller.enqueue(encoder.encode(DONE_FRAME))
          controller.close()
        } catch {
          // The viewer has gone; nothing left to deliver.
        }
      }
    },
    cancel() {
      // Stop or navigation: abort the provider call too, so it is not left running to completion.
      upstream.abort()
    },
  })

  return new Response(stream, {
    headers: {
      ...headers,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

async function respond(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

  if (!originAllowed(origin)) return jsonResponse(403, { error: 'Origin not allowed' }, corsHeaders(null))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed. Use POST.' }, { ...headers, Allow: 'POST, OPTIONS' })
  }
  if (rateLimited(clientKey(req))) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' }, headers)
  }

  // The declared length is checked first, then the bytes actually read, because a request can omit or understate it.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return jsonResponse(400, { error: TOO_LARGE }, headers)
  const text = await req.text().catch(() => null)
  if (text === null) return jsonResponse(400, { error: 'Could not read the request body' }, headers)
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return jsonResponse(400, { error: TOO_LARGE }, headers)

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    // The missing variable's name is a deployment detail -- log it, don't ship it.
    console.error('ai function: no server-side AI provider is configured')
    return jsonResponse(500, { error: 'Service not configured' }, headers)
  }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' }, headers)
  }

  const parsed = parseInsightRequest(body)
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error }, headers)
  return streamInsight(parsed.summary, apiKey, headers)
}

export default async function handler(req: Request): Promise<Response> {
  try {
    return await respond(req)
  } catch (err) {
    console.error('ai function: unexpected error', err)
    const origin = req.headers.get('origin')
    return jsonResponse(500, { error: GENERIC_FAILURE }, corsHeaders(originAllowed(origin) ? origin : null))
  }
}
