import { validateQueryPlan } from '../../src/lib/queryPlan'

interface RequestBody {
  question: string
  headers: string[]
  sampleRows: Record<string, string>[]
  rowCount: number
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://jdgafx-app-05-ai-data-analyst.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

// URL / DEPLOY_PRIME_URL are injected by Netlify, so branch and preview deploys
// keep working without editing this list.
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(',')).split(','),
  process.env.URL ?? '',
  process.env.DEPLOY_PRIME_URL ?? '',
]
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean)

const MAX_BODY_BYTES = 128 * 1024
const MAX_QUESTION_CHARS = 2000
const MAX_SAMPLE_ROWS = 5
const MAX_HEADERS = 200
const MAX_CELL_CHARS = 200
const UPSTREAM_TIMEOUT_MS = 25_000

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

// Best effort only: each warm function instance keeps its own counter, so the
// effective limit scales with instance count. Enough to blunt casual abuse of an
// unauthenticated demo endpoint; a shared store would be needed for a real quota.
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

function corsHeaders(origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    base['Access-Control-Allow-Origin'] = origin
  }
  return base
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** Extracts the first complete JSON object, ignoring braces inside string literals. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const SYSTEM_PROMPT = `You are a data analyst assistant. Given a dataset schema and sample data, generate a query plan to answer the user's question.

Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{
  "chartType": "bar" | "line" | "pie" | "area" | "scatter",
  "groupBy": "<column name to group by>",
  "aggregate": {
    "field": "<column name to aggregate>",
    "fn": "sum" | "avg" | "count" | "min" | "max"
  },
  "filter": {
    "field": "<column name>",
    "op": "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains",
    "value": "<string value>"
  },
  "sortBy": {
    "field": "<the groupBy column or the aggregate field>",
    "dir": "asc" | "desc"
  },
  "title": "<descriptive chart title>",
  "explanation": "<brief explanation of what this visualization shows and why>"
}

Rules:
- "filter" and "sortBy" are optional — only include them if relevant
- groupBy, aggregate.field and filter.field MUST be exact column names copied from the dataset. Never invent a column.
- sortBy.field must be either the groupBy column or the aggregate field — nothing else is plotted
- For count queries, aggregate.field must still be a real column name (count ignores its value)
- Choose the most appropriate chartType for the data pattern`

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const headersOut = corsHeaders(origin)
  const originAllowed = !origin || ALLOWED_ORIGINS.includes(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: originAllowed ? 204 : 403, headers: headersOut })
  }

  if (!originAllowed) {
    return json({ error: 'Origin not allowed.' }, 403, headersOut)
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, headersOut)
  }

  const limit = rateLimit(clientKey(req))
  if (!limit.allowed) {
    return json({ error: 'Too many requests. Please wait a moment and try again.' }, 429, {
      ...headersOut,
      'Retry-After': String(limit.retryAfter),
    })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return json({ error: 'The analysis service is not configured.' }, 500, headersOut)
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Request is too large.' }, 413, headersOut)
  }

  let body: RequestBody
  try {
    const rawBody = await req.text()
    if (rawBody.length > MAX_BODY_BYTES) {
      return json({ error: 'Request is too large.' }, 413, headersOut)
    }
    body = JSON.parse(rawBody) as RequestBody
  } catch {
    return json({ error: 'Request body was not valid JSON.' }, 400, headersOut)
  }

  const { question, headers, sampleRows, rowCount } = body ?? ({} as RequestBody)

  if (!question || typeof question !== 'string') {
    return json({ error: 'A question is required.' }, 400, headersOut)
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return json(
      { error: `Question is too long (max ${MAX_QUESTION_CHARS} characters).` },
      400,
      headersOut,
    )
  }
  if (!Array.isArray(headers) || headers.length === 0) {
    return json({ error: 'Dataset columns are required.' }, 400, headersOut)
  }
  if (headers.length > MAX_HEADERS || headers.some((h) => typeof h !== 'string')) {
    return json({ error: 'Dataset has too many or invalid columns.' }, 400, headersOut)
  }

  const safeHeaders = headers.map((h) => h.slice(0, MAX_CELL_CHARS))
  const safeRows = (Array.isArray(sampleRows) ? sampleRows : [])
    .slice(0, MAX_SAMPLE_ROWS)
    .map((row) => {
      const out: Record<string, string> = {}
      if (row && typeof row === 'object') {
        for (const key of safeHeaders) {
          const cell = (row as Record<string, unknown>)[key]
          if (cell !== undefined) out[key] = String(cell).slice(0, MAX_CELL_CHARS)
        }
      }
      return out
    })

  const safeRowCount = Number.isFinite(rowCount) ? Math.max(0, Math.trunc(Number(rowCount))) : 0
  const schemaDescription = `Dataset with ${safeRowCount} rows.
Columns: ${safeHeaders.join(', ')}
Sample rows:
${JSON.stringify(safeRows, null, 2)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '~anthropic/claude-haiku-latest',
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Dataset:\n${schemaDescription}\n\nQuestion: ${question}` },
        ],
      }),
    })

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return json(
          { error: 'The AI service is busy right now. Please try again in a moment.' },
          429,
          { ...headersOut, 'Retry-After': '10' },
        )
      }
      if (aiResponse.status === 401 || aiResponse.status === 403) {
        return json({ error: 'The analysis service rejected our credentials.' }, 502, headersOut)
      }
      return json({ error: 'The AI service is unavailable right now.' }, 502, headersOut)
    }

    const aiData = (await aiResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const rawText = aiData.choices?.[0]?.message?.content
    if (!rawText) {
      return json({ error: 'The AI returned an empty response. Try rephrasing your question.' }, 502, headersOut)
    }

    const cleaned = rawText.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      const candidate = extractJsonObject(cleaned)
      if (!candidate) {
        return json(
          { error: 'The AI response could not be read. Try rephrasing your question.' },
          502,
          headersOut,
        )
      }
      try {
        parsed = JSON.parse(candidate)
      } catch {
        return json(
          { error: 'The AI response could not be read. Try rephrasing your question.' },
          502,
          headersOut,
        )
      }
    }

    const validation = validateQueryPlan(parsed, safeHeaders)
    if (!validation.ok) {
      return json({ error: validation.error }, 422, headersOut)
    }

    return json(validation.plan, 200, headersOut)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return json({ error: 'The analysis timed out. Please try again.' }, 504, headersOut)
    }
    return json({ error: 'Could not reach the analysis service. Please try again.' }, 502, headersOut)
  } finally {
    clearTimeout(timer)
  }
}

export const config = { path: '/api/ai' }
