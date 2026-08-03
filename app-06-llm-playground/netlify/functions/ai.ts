export const config = { path: '/api/ai' }

// Map frontend Anthropic model IDs to OpenRouter model IDs
const MODEL_MAP: Record<string, string> = {
  'claude-haiku-4.5': '~anthropic/claude-haiku-latest',
  'claude-sonnet-4.6': '~anthropic/claude-sonnet-latest',
  'claude-opus': '~anthropic/claude-opus-latest',
  'claude-sonnet-4': '~anthropic/claude-sonnet-latest',
  'claude-3-5-haiku-20241022': '~anthropic/claude-haiku-latest',
  'claude-sonnet-4-20250514': '~anthropic/claude-sonnet-latest',
  'claude-3-5-sonnet-20241022': '~anthropic/claude-sonnet-latest',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Netlify caps a synchronous function invocation at ~30s; stop a beat early so
// we can still emit a terminal `done` chunk instead of the socket dying silently.
const STREAM_BUDGET_MS = Number(process.env.STREAM_BUDGET_MS ?? 25_000)

const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 4096)
const MAX_MESSAGES = Number(process.env.MAX_MESSAGES ?? 20)
const MAX_PROMPT_CHARS = Number(process.env.MAX_PROMPT_CHARS ?? 32_000)

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 20)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

// Browser origins allowed to call this endpoint. Netlify injects URL /
// DEPLOY_PRIME_URL for the live site and deploy previews, so the deployed host
// never has to be hardcoded here.
function allowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS?.split(',') ?? []
  return [
    ...configured,
    process.env.URL ?? '',
    process.env.DEPLOY_PRIME_URL ?? '',
    process.env.DEPLOY_URL ?? '',
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

// Upstream error bodies carry provider account identifiers -- keep the detail in
// the function log and hand the browser a status-shaped summary only.
function upstreamMessage(status: number): string {
  if (status === 401 || status === 403) return 'Upstream authentication failed (502)'
  if (status === 402) return 'Model provider credit exhausted (502)'
  if (status === 429) return 'Model provider is rate limiting requests -- try again shortly (502)'
  if (status >= 500) return 'Model provider is temporarily unavailable (502)'
  return `Model provider rejected the request (status ${status})`
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function validate(body: unknown):
  | { ok: true; model: string; messages: ChatMessage[]; system?: string; maxTokens: number; temperature: number }
  | { ok: false; status: number; message: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, status: 400, message: 'Request body must be a JSON object' }
  }
  const b = body as Record<string, unknown>

  if (typeof b.model !== 'string' || !MODEL_MAP[b.model]) {
    return { ok: false, status: 400, message: 'Unsupported model' }
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, status: 400, message: 'model and messages are required' }
  }
  if (b.messages.length > MAX_MESSAGES) {
    return { ok: false, status: 413, message: `At most ${MAX_MESSAGES} messages per request` }
  }

  const messages: ChatMessage[] = []
  for (const raw of b.messages) {
    const m = raw as Record<string, unknown>
    if ((m?.role !== 'user' && m?.role !== 'assistant') || typeof m.content !== 'string') {
      return { ok: false, status: 400, message: 'Each message needs a user/assistant role and string content' }
    }
    messages.push({ role: m.role, content: m.content })
  }

  const system = typeof b.system === 'string' && b.system.length > 0 ? b.system : undefined
  const totalChars =
    messages.reduce((sum, m) => sum + m.content.length, 0) + (system?.length ?? 0)
  if (totalChars > MAX_PROMPT_CHARS) {
    return { ok: false, status: 413, message: `Prompt exceeds the ${MAX_PROMPT_CHARS} character limit` }
  }

  const requestedTokens = typeof b.max_tokens === 'number' && Number.isFinite(b.max_tokens)
    ? Math.floor(b.max_tokens)
    : 1024
  const maxTokens = Math.min(Math.max(requestedTokens, 1), MAX_OUTPUT_TOKENS)

  const requestedTemp = typeof b.temperature === 'number' && Number.isFinite(b.temperature)
    ? b.temperature
    : 0.7
  const temperature = Math.min(Math.max(requestedTemp, 0), 1)

  return { ok: true, model: b.model, messages, system, maxTokens, temperature }
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const headers = corsHeaders(origin)

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

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response('OPENROUTER_API_KEY not configured', { status: 500, headers })
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers })
  }

  const valid = validate(parsedBody)
  if (!valid.ok) {
    return new Response(valid.message, { status: valid.status, headers })
  }

  const orModel = MODEL_MAP[valid.model]
  const startTime = Date.now()
  const openRouterMessages = valid.system
    ? [{ role: 'system', content: valid.system }, ...valid.messages]
    : valid.messages

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const upstream = new AbortController()
      let closed = false

      const send = (data: object) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const finish = () => {
        if (closed) return
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        closed = true
        controller.close()
      }

      try {
        const response = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: orModel,
            messages: openRouterMessages,
            max_tokens: valid.maxTokens,
            temperature: valid.temperature,
            stream: true,
            usage: { include: true },
          }),
          signal: upstream.signal,
        })

        if (!response.ok) {
          const errText = await response.text()
          console.error(`OpenRouter ${response.status} for ${orModel}: ${errText}`)
          send({ type: 'error', message: upstreamMessage(response.status) })
          finish()
          return
        }

        if (!response.body) {
          console.error(`OpenRouter returned no body for ${orModel}`)
          send({ type: 'error', message: 'No response body from the model provider' })
          finish()
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        // Null until the provider actually reports usage -- a truncated stream
        // never sends it, and reporting 0 would render as a real measurement.
        let inputTokens: number | null = null
        let outputTokens: number | null = null
        let cost: number | null = null
        let servedModel: string | null = null
        let truncated = false

        const deadline = startTime + STREAM_BUDGET_MS

        while (true) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) {
            truncated = true
            break
          }

          let timer: ReturnType<typeof setTimeout> | undefined
          const timeout = new Promise<'timeout'>(resolve => {
            timer = setTimeout(() => resolve('timeout'), remaining)
          })
          const result = await Promise.race([reader.read(), timeout])
          if (timer) clearTimeout(timer)

          if (result === 'timeout') {
            truncated = true
            break
          }

          const { done, value } = result
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) send({ type: 'text', text: delta })
              // The resolved model id is only knowable from the upstream chunks
              // -- the ~latest aliases hide which snapshot actually served.
              if (typeof parsed.model === 'string') servedModel = parsed.model
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens ?? inputTokens
                outputTokens = parsed.usage.completion_tokens ?? outputTokens
                if (typeof parsed.usage.cost === 'number') cost = parsed.usage.cost
              }
            } catch (err) {
              console.error('Skipping unparseable SSE payload', (err as Error).message)
            }
          }
        }

        if (truncated) {
          upstream.abort()
          reader.cancel().catch(() => { })
        }

        send({
          type: 'done',
          latencyMs: Date.now() - startTime,
          inputTokens,
          outputTokens,
          cost,
          servedModel,
          truncated,
        })
        finish()
      } catch (err) {
        upstream.abort()
        console.error('Stream failure', err)
        send({ type: 'error', message: 'The response stream failed unexpectedly' })
        finish()
      }
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
