import type { AgentRole } from '../../src/types'

type AgentContext = Partial<Record<AgentRole, string>>

interface AgentConfig {
  role: AgentRole
  name: string
  systemPrompt: string
  buildUserMessage: (query: string, context: AgentContext) => string
  /** Ceiling on generated tokens. Sized with headroom above the prompt's word budget. */
  maxTokens: number
  /** Hard wall-clock timeout per agent — abort stream after this many ms */
  timeoutMs: number
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = '~google/gemini-flash-latest'
const DEFAULT_SITE_URL = 'https://jdgafx-app-01-multi-agent-orchestrator.netlify.app'
const APP_TITLE = 'AgentFlow'

const MODEL = process.env.OPENROUTER_MODEL || DEFAULT_MODEL
const SITE_URL = process.env.URL || DEFAULT_SITE_URL

const DEFAULT_ALLOWED_ORIGINS = [DEFAULT_SITE_URL, 'http://localhost:8888', 'http://localhost:5173']

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

const MAX_BODY_BYTES = 8 * 1024
const MAX_QUERY_CHARS = 500
const MAX_CONTEXT_CHARS = 800
const RETRY_DELAY_MS = 800

// One request fans out to four upstream LLM calls, so the ceiling is lower than
// a plain proxy would need. Best effort only: each warm function instance keeps
// its own counter, so the effective limit scales with instance count. Enough to
// blunt casual abuse of an unauthenticated demo endpoint.
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

/** Trim context to stay within the time budget — shorter input = faster generation */
function trimCtx(text: string | undefined, maxChars = MAX_CONTEXT_CHARS): string {
  const value = text?.trim() ?? ''
  if (!value) return '(no output from the previous agent)'
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n[trimmed]` : value
}

/**
 * Time budget: Netlify functions time out at 26s.
 * 4 agents x ~5s each = ~20s generation + ~4s network overhead = 24s.
 * Per-agent timeouts guarantee we never exceed the budget; the token ceilings
 * exist so nothing is cut off mid-sentence, not to bound the wall clock.
 */
const agents: AgentConfig[] = [
  {
    role: 'researcher',
    name: 'Researcher',
    systemPrompt:
      'You are a research assistant. Give 3-5 bullet points with key facts. Use markdown. STRICT LIMIT: 150 words max. Do NOT write long paragraphs.',
    buildUserMessage: query => `Research: ${query}\n\n3-5 bullet points only. Be extremely concise.`,
    maxTokens: 600,
    timeoutMs: 5500,
  },
  {
    role: 'analyst',
    name: 'Analyst',
    systemPrompt:
      'You are an analyst. Identify 2-3 key patterns from the research. Markdown bullets. STRICT LIMIT: 150 words max.',
    buildUserMessage: (_query, ctx) =>
      `Analyze:\n${trimCtx(ctx.researcher)}\n\n2-3 key patterns only. Extremely concise.`,
    maxTokens: 600,
    timeoutMs: 5500,
  },
  {
    role: 'critic',
    name: 'Critic',
    systemPrompt:
      'You are a critic. Note 2-3 gaps or missing angles. Markdown bullets. STRICT LIMIT: 100 words max.',
    buildUserMessage: (_query, ctx) => `Review:\n${trimCtx(ctx.analyst)}\n\n2-3 gaps only. Very brief.`,
    maxTokens: 400,
    timeoutMs: 4500,
  },
  {
    role: 'synthesizer',
    name: 'Synthesizer',
    systemPrompt:
      'You are a synthesis agent. Combine research, analysis, and critique into a final report with clear markdown sections. Be comprehensive but concise — aim for 200-300 words.',
    buildUserMessage: (query, ctx) =>
      `Final report on "${query}".\n\nResearch:\n${trimCtx(ctx.researcher)}\n\nAnalysis:\n${trimCtx(ctx.analyst)}\n\nGaps:\n${trimCtx(ctx.critic)}`,
    maxTokens: 1200,
    timeoutMs: 8000,
  },
]

interface OpenRouterChunk {
  choices?: Array<{
    delta?: { content?: string; reasoning?: string }
    finish_reason?: string | null
  }>
  usage?: {
    completion_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

interface AgentResult {
  content: string
  /** Content tokens only — upstream reasoning tokens are excluded. */
  tokens: number
  reasoningTokens: number
  /** Streamed reasoning text length, used when upstream reports no usage block. */
  reasoningChars: number
  /** 'stop' | 'length' | 'timeout' | null */
  finish: string | null
}

/** Rough chars-per-token, only used to estimate reasoning when usage is missing. */
const CHARS_PER_TOKEN = 4

/** Upstream returned a non-2xx. Carries the status so 429 can be retried. */
class UpstreamError extends Error {
  constructor(readonly status: number, detail: string) {
    super(detail)
    this.name = 'UpstreamError'
  }
}

/** The agent's wall-clock budget expired. Partial output is still usable. */
class AgentTimeoutError extends Error {
  constructor() {
    super('agent timed out')
    this.name = 'AgentTimeoutError'
  }
}

function friendlyUpstreamMessage(status: number): string {
  if (status === 429) return 'The AI service is rate limiting this demo. Wait a few seconds and try again.'
  if (status === 401 || status === 403) return 'The AI service rejected this request — the server API key is invalid or expired.'
  if (status >= 500) return 'The AI service is having trouble right now. Try again in a moment.'
  return 'The AI service could not complete this request.'
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** A live upstream stream plus the timer that bounds it. */
interface OpenStream {
  body: ReadableStream<Uint8Array>
  abort: AbortController
  clearTimer: () => void
}

/**
 * Opens one upstream stream under its own AbortController and timer. Each call
 * gets a fresh signal, so a retry is never poisoned by the first attempt's abort.
 */
async function openStream(agent: AgentConfig, userMessage: string, apiKey: string): Promise<OpenStream> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), agent.timeoutMs)
  const clearTimer = () => clearTimeout(timer)

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': SITE_URL,
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: agent.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        // Gemini's ~latest alias now resolves to a reasoning model, and reasoning
        // tokens are billed against max_tokens. Left on, the agents burn their
        // whole budget thinking and emit a truncated fragment.
        reasoning: { enabled: false },
        messages: [
          { role: 'system', content: agent.systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new UpstreamError(response.status, detail.slice(0, 300) || response.statusText)
    }
    if (!response.body) {
      throw new UpstreamError(response.status, 'empty response body from upstream')
    }

    return { body: response.body, abort, clearTimer }
  } catch (err) {
    clearTimer()
    if (abort.signal.aborted) throw new AgentTimeoutError()
    throw err
  }
}

function parseFrame(line: string, result: AgentResult, onChunk: (text: string) => void): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data: ')) return
  const data = trimmed.slice(6)
  if (data === '[DONE]') return

  let parsed: OpenRouterChunk
  try {
    parsed = JSON.parse(data) as OpenRouterChunk
  } catch {
    return // keep-alive comments and partial frames
  }

  const choice = parsed.choices?.[0]
  const content = choice?.delta?.content
  if (content) {
    result.content += content
    onChunk(content)
  }
  // Reasoning text is tracked but never streamed to the client: it is not an
  // answer. Recording it means a model that starts reasoning again shows up as a
  // warning rather than as mysteriously short output.
  const reasoning = choice?.delta?.reasoning
  if (reasoning) result.reasoningChars += reasoning.length
  if (choice?.finish_reason) result.finish = choice.finish_reason

  const usage = parsed.usage
  if (usage) {
    // Counted separately so a model that starts reasoning again degrades visibly
    // instead of silently inflating the token counter.
    const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0
    result.reasoningTokens = reasoning
    result.tokens = Math.max(0, (usage.completion_tokens ?? 0) - reasoning)
  }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  result: AgentResult,
  onChunk: (text: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) parseFrame(line, result, onChunk)
    }
    for (const line of buffer.split('\n')) parseFrame(line, result, onChunk)
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Runs one agent to completion, retrying once on a 429 with a fresh signal. */
async function streamAgent(
  agent: AgentConfig,
  userMessage: string,
  apiKey: string,
  onChunk: (text: string) => void,
): Promise<AgentResult> {
  const result: AgentResult = { content: '', tokens: 0, reasoningTokens: 0, reasoningChars: 0, finish: null }

  let stream: OpenStream
  try {
    stream = await openStream(agent, userMessage, apiKey)
  } catch (err) {
    if (err instanceof AgentTimeoutError) {
      result.finish = 'timeout'
      return result
    }
    if (err instanceof UpstreamError && err.status === 429) {
      await delay(RETRY_DELAY_MS)
      stream = await openStream(agent, userMessage, apiKey)
    } else {
      throw err
    }
  }

  try {
    await readStream(stream.body, result, onChunk)
  } catch (err) {
    if (!stream.abort.signal.aborted) throw err
  } finally {
    if (stream.abort.signal.aborted) result.finish = 'timeout'
    stream.clearTimer()
  }

  // Not every provider returns a usage block, so fall back to what was streamed.
  if (result.reasoningTokens === 0 && result.reasoningChars > 0) {
    result.reasoningTokens = Math.ceil(result.reasoningChars / CHARS_PER_TOKEN)
  }

  return result
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimit(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k)
    }
    return { allowed: true, retryAfter: 0 }
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfter: 0 }
}

function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

/** The client-facing host, which is what the browser's Origin is built from. */
function requestHost(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  const host = req.headers.get('host')
  if (host) return host
  try {
    return new URL(req.url).host
  } catch {
    return ''
  }
}

/**
 * The allowlist exists to stop other sites using this endpoint, so it must never
 * reject the app's own page. Same-origin always passes — otherwise deploy previews,
 * branch deploys and custom domains would each need adding by hand.
 */
function isOriginAllowed(req: Request, origin: string | null): boolean {
  if (!origin) return true // non-browser client sends no Origin
  if (ALLOWED_ORIGINS.includes(origin)) return true
  try {
    return new URL(origin).host === requestHost(req)
  } catch {
    return false
  }
}

function corsHeaders(req: Request, origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && isOriginAllowed(req, origin)) {
    base['Access-Control-Allow-Origin'] = origin
  }
  return base
}

function fail(message: string, status: number, headers: Record<string, string>): Response {
  return new Response(message, { status, headers })
}

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

async function readQuery(req: Request): Promise<string> {
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    throw new UpstreamError(413, 'Request body too large.')
  }
  let body: { query?: unknown }
  try {
    body = JSON.parse(raw) as { query?: unknown }
  } catch {
    throw new UpstreamError(400, 'Invalid JSON.')
  }
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) throw new UpstreamError(400, 'Missing query.')
  if (query.length > MAX_QUERY_CHARS) {
    throw new UpstreamError(400, `Query too long — ${MAX_QUERY_CHARS} characters max.`)
  }
  return query
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const allowed = isOriginAllowed(req, origin)
  const headersOut = corsHeaders(req, origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: allowed ? 204 : 403, headers: headersOut })
  }
  if (!allowed) return fail('Origin not allowed.', 403, headersOut)
  if (req.method !== 'POST') return fail('Method not allowed', 405, headersOut)

  const limit = rateLimit(clientKey(req))
  if (!limit.allowed) {
    return fail('Too many requests. Wait a minute and try again.', 429, {
      ...headersOut,
      'Retry-After': String(limit.retryAfter),
    })
  }

  let query: string
  try {
    query = await readQuery(req)
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 400
    return fail(err instanceof Error ? err.message : 'Invalid request.', status, headersOut)
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return fail('OPENROUTER_API_KEY not configured', 500, headersOut)

  const encoder = new TextEncoder()
  const context: AgentContext = {}

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => controller.enqueue(encoder.encode(sseEvent(data)))

      try {
        for (const agent of agents) {
          send({ type: 'agent_start', agent: agent.role, maxTokens: agent.maxTokens })

          try {
            const result = await streamAgent(
              agent,
              agent.buildUserMessage(query, context),
              apiKey,
              content => send({ type: 'agent_chunk', agent: agent.role, content }),
            )
            context[agent.role] = result.content
            send({
              type: 'agent_complete',
              agent: agent.role,
              tokens: result.tokens,
              reasoningTokens: result.reasoningTokens,
              finish: result.finish,
            })
          } catch (err) {
            // One agent failing should not kill the run — the remaining agents
            // still produce something, and the client gates "complete" on output.
            const message =
              err instanceof UpstreamError
                ? friendlyUpstreamMessage(err.status)
                : `${agent.name} could not finish. ${err instanceof Error ? err.message : 'Unknown error'}`
            context[agent.role] = ''
            send({ type: 'agent_error', agent: agent.role, error: message })
          }
        }

        send({ type: 'session_complete', agent: 'synthesizer' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        send({ type: 'agent_error', agent: 'system', error: message })
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...headersOut,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
