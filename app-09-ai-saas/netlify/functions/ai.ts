import { chatRequest, getProvider, type Provider } from '../shared/provider'
import {
  buildPrompt,
  checkFigures,
  COMPARISON_DAYS,
  METRIC_COUNT,
  type FigureCheck,
  type Metrics,
} from '../shared/insights'

export const config = { path: '/api/ai' }

// Fixed in code rather than read from the environment, so no config value can leave a call unbounded.
const MAX_OUTPUT_TOKENS = 1024
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 32_000)
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000)

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 20)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

const STAGES = ['Build request', 'Call model', 'Stream answer', 'Check figures', 'Validate output'] as const
type Stage = (typeof STAGES)[number]

interface TraceStep {
  name: string
  status: 'ok' | 'failed' | 'skipped'
  ms: number
  detail: string
  tokens?: number
  cost?: number
}

interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

interface Answer {
  text: string
  chunks: number
  finishReason: string | null
  model: string | null
  usage: Usage | null
  providerError: number | null
}

interface ChunkFrame {
  model?: string
  usage?: Record<string, unknown>
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[]
  error?: { code?: unknown }
}

type Emit = (frame: object) => void

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
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
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

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pickUsage(raw: Record<string, unknown>): Usage {
  const usage: Usage = {}
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value
  }
  return usage
}

function describeFigures(check: FigureCheck): string {
  if (check.checked === 0) return 'No %, ms or $ figures in the answer to check'
  if (check.unmatched.length === 0) return `${check.checked} of ${check.checked} figures match the snapshot`
  return `${check.matched} of ${check.checked} figures match the snapshot. Not in the snapshot: ${check.unmatched.join(', ')}`
}

/** Reads the provider's SSE stream and forwards each text delta to the browser as it arrives. */
async function readAnswer(body: ReadableStream<Uint8Array>, emit: Emit): Promise<Answer> {
  const answer: Answer = { text: '', chunks: 0, finishReason: null, model: null, usage: null, providerError: null }
  const decoder = new TextDecoder()

  const readLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) return
    const data = trimmed.slice(6)
    if (data === '[DONE]') return

    let frame: ChunkFrame
    try {
      frame = JSON.parse(data) as ChunkFrame
    } catch (e) {
      // Partial frames are expected mid-stream; anything else is a bug.
      if (e instanceof SyntaxError) return
      throw e
    }

    if (frame.error) {
      answer.providerError = Number(frame.error.code) || 502
      return
    }
    if (frame.model) answer.model = frame.model
    if (frame.usage) answer.usage = pickUsage(frame.usage)
    const choice = frame.choices?.[0]
    if (choice?.finish_reason) answer.finishReason = choice.finish_reason

    const delta = choice?.delta?.content
    if (!delta) return
    if (answer.chunks === 0) emit({ stage: 'streaming' })
    answer.chunks += 1
    answer.text += delta
    emit({ text: delta })
  }

  const reader = body.getReader()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach((line) => readLine(line))
  }
  readLine(buffer)
  return answer
}

/**
 * One insight run. Each stage is timed here with Date.now() and sent as a step frame as soon as
 * it finishes, so the browser can draw the trace while the answer streams in.
 */
async function runInsight(metrics: Metrics, provider: Provider, upstream: AbortController, emit: Emit): Promise<void> {
  const started = Date.now()
  const steps: TraceStep[] = []
  // A property rather than a let, so the catch block reads the live stage without TypeScript narrowing it.
  const run = { stage: STAGES[0] as Stage, stageStart: started, timedOut: false }

  const record = (step: TraceStep) => {
    steps.push(step)
    emit({ step })
  }
  const finishStage = (status: TraceStep['status'], detail: string, extra: Pick<TraceStep, 'tokens' | 'cost'> = {}) => {
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

  const timer = setTimeout(() => {
    run.timedOut = true
    upstream.abort()
  }, UPSTREAM_TIMEOUT_MS)

  try {
    const prompt = buildPrompt(metrics)
    finishStage('ok', `${METRIC_COUNT} figures for the ${COMPARISON_DAYS}-day comparison`)

    beginStage('Call model')
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chatRequest(prompt, MAX_OUTPUT_TOKENS)),
      signal: upstream.signal,
    })
    if (!response.ok) {
      console.error(`ai function: provider HTTP ${response.status}`, await response.text().catch(() => ''))
      return failRun(providerFailure(response.status))
    }
    finishStage('ok', `${provider.name} accepted the request (HTTP ${response.status})`)

    beginStage('Stream answer')
    if (!response.body) return failRun('The AI provider returned an empty response. Try again.')
    const answer = await readAnswer(response.body, emit)
    if (answer.providerError !== null) return failRun(providerFailure(answer.providerError))
    finishStage('ok', `${answer.chunks} ${answer.chunks === 1 ? 'chunk' : 'chunks'}, ${answer.text.length} characters`, {
      tokens: answer.usage?.total_tokens,
      cost: answer.usage?.cost,
    })

    beginStage('Check figures')
    const check = checkFigures(answer.text, metrics)
    finishStage(check.unmatched.length > 0 ? 'failed' : 'ok', describeFigures(check))

    beginStage('Validate output')
    if (!answer.text.trim()) return failRun('The model returned no text. Try again.')
    const cut = answer.finishReason === 'length'
    finishStage(
      cut ? 'failed' : 'ok',
      cut ? `Stopped at the ${MAX_OUTPUT_TOKENS}-token output cap, so the answer may be cut short` : 'Non-empty answer that finished normally',
    )

    emit({
      stage: 'complete',
      result: answer.text,
      trace: steps,
      usage: answer.usage,
      model: answer.model,
      totalMs: Date.now() - started,
    })
  } catch (err) {
    // The viewer left (Stop or navigation), so there is no one to tell.
    if (upstream.signal.aborted && !run.timedOut) return
    console.error('ai function: stream failed', err)
    const message = run.timedOut
      ? `The AI provider did not answer within ${UPSTREAM_TIMEOUT_MS / 1000} seconds. Try again.`
      : run.stage === 'Call model'
        ? 'Could not reach the AI provider. Try again shortly.'
        : 'The AI provider connection dropped. Try again shortly.'
    failRun(message)
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }

  if (!originAllowed(origin)) {
    return new Response('Origin not allowed', { status: 403, headers: corsHeaders(null) })
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers })
  }

  if (rateLimited(clientKey(req))) {
    return new Response('Too many requests -- please slow down', { status: 429, headers })
  }

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'Request body is too large' }), { status: 413, headers: jsonHeaders })
  }

  const provider = getProvider()
  if (!provider) {
    // The missing variable's name is a deployment detail -- log it, don't ship it.
    console.error('ai function: no server-side AI provider is configured')
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  let body: { metrics?: Partial<Metrics> }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: jsonHeaders })
  }

  const raw = body.metrics
  if (!raw || typeof raw.totalApiCalls !== 'number') {
    return new Response(
      JSON.stringify({ error: 'metrics object with totalApiCalls is required' }),
      { status: 400, headers: jsonHeaders },
    )
  }

  // The request names no model: the client's model field, if any, is ignored.
  const metrics: Metrics = {
    totalApiCalls: num(raw.totalApiCalls),
    totalTokens: num(raw.totalTokens),
    avgResponseTime: num(raw.avgResponseTime),
    totalCost: num(raw.totalCost),
    avgErrorRate: num(raw.avgErrorRate),
    apiCallsTrend: num(raw.apiCallsTrend),
    tokensTrend: num(raw.tokensTrend),
    responseTimeTrend: num(raw.responseTimeTrend),
    costTrend: num(raw.costTrend),
    errorRateTrend: num(raw.errorRateTrend),
  }

  const encoder = new TextEncoder()
  const upstream = new AbortController()

  const stream = new ReadableStream({
    async start(controller) {
      const emit: Emit = (frame) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
        } catch {
          // The viewer has gone; cancel() has already stopped the provider call.
        }
      }
      try {
        await runInsight(metrics, provider, upstream, emit)
      } catch (err) {
        console.error('ai function: run failed', err)
        emit({ error: 'Insight generation failed. Please try again.' })
      } finally {
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
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
