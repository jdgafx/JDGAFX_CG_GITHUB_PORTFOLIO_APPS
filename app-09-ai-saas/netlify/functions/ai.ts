export const config = { path: '/api/ai' }

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.INSIGHTS_MODEL ?? '~anthropic/claude-haiku-latest'
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 1024)

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 20)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

/** Number of days the summary metrics cover on each side of the comparison. */
const COMPARISON_DAYS = 15

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

// Upstream error bodies carry provider account identifiers -- keep the detail in
// the function log and hand the browser a status-shaped summary only.
function upstreamMessage(status: number): string {
  if (status === 401 || status === 403) return 'Upstream authentication failed (502)'
  if (status === 402) return 'Model provider credit exhausted (502)'
  if (status === 429) return 'Model provider is rate limiting requests -- try again shortly (502)'
  if (status >= 500) return 'Model provider is temporarily unavailable (502)'
  return `Model provider rejected the request (status ${status})`
}

interface Metrics {
  totalApiCalls: number
  totalTokens: number
  avgResponseTime: number
  totalCost: number
  avgErrorRate: number
  apiCallsTrend: number
  tokensTrend: number
  responseTimeTrend: number
  costTrend: number
  errorRateTrend: number
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}%`
}

function buildPrompt(m: Metrics): string {
  const vs = `vs prev ${COMPARISON_DAYS} days`
  return `You are an expert SaaS analytics consultant. Analyze these API usage metrics from the last ${COMPARISON_DAYS} days and provide 4-5 concise, actionable insights:

Metrics:
- Total API Calls: ${m.totalApiCalls.toLocaleString()} (${signed(m.apiCallsTrend)} ${vs})
- Total Tokens: ${m.totalTokens.toLocaleString()} (${signed(m.tokensTrend)} ${vs})
- Average Response Time: ${m.avgResponseTime}ms (${signed(m.responseTimeTrend)} ${vs})
- Error Rate: ${m.avgErrorRate}% of requests (${signed(m.errorRateTrend)} ${vs})
- Total Cost: $${m.totalCost} (${signed(m.costTrend)} ${vs})

Note that lower response time, error rate and cost are improvements. Provide specific, data-driven insights. Be direct and actionable. Format as numbered insights with brief explanations.`
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

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    // The missing variable's name is a deployment detail -- log it, don't ship it.
    console.error('ai function: OPENROUTER_API_KEY is not set')
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

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      const finish = () => {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
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
            model: MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            stream: true,
            messages: [{ role: 'user', content: buildPrompt(metrics) }],
          }),
        })

        if (!response.ok) {
          console.error(`ai function: upstream ${response.status}`, await response.text().catch(() => ''))
          send({ error: upstreamMessage(response.status) })
          finish()
          return
        }

        if (!response.body) {
          console.error('ai function: upstream returned an empty body')
          send({ error: 'Model provider returned an empty response' })
          finish()
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data) as {
                choices?: { delta?: { content?: string } }[]
              }
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) send({ text: delta })
            } catch (e) {
              // Partial frames are expected mid-stream; anything else is a bug.
              if (!(e instanceof SyntaxError)) throw e
            }
          }
        }

        finish()
      } catch (err) {
        console.error('ai function: stream failed', err)
        send({ error: 'Insight generation failed. Please try again.' })
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
