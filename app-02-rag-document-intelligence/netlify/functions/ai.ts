export const config = { path: '/api/ai' }

const OPENROUTER_URL = process.env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.OPENROUTER_MODEL ?? '~anthropic/claude-haiku-latest'

const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 1024)
// Must stay >= the client's TOP_K in src/lib/constants.ts, or well-formed
// requests from our own UI would be rejected here.
const MAX_CHUNKS = Number(process.env.MAX_CHUNKS ?? 20)
const MAX_CHUNK_CHARS = Number(process.env.MAX_CHUNK_CHARS ?? 2000)
const MAX_QUESTION_CHARS = Number(process.env.MAX_QUESTION_CHARS ?? 2000)
const MAX_TITLE_CHARS = Number(process.env.MAX_TITLE_CHARS ?? 200)

// Netlify caps a synchronous function invocation at ~30s; give up a beat early
// so we can return a shaped 504 instead of the socket dying silently.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000)

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 20)
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

interface AiResponse {
  answer: string
  source_chunk_indices: number[]
  confidence: number
}

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
  if (status === 401 || status === 403) return 'Upstream authentication failed.'
  if (status === 402) return 'The model provider credit for this demo is exhausted.'
  if (status === 429) return 'The model provider is rate limiting requests. Try again shortly.'
  if (status >= 500) return 'The model provider is temporarily unavailable. Try again shortly.'
  return 'The model provider rejected the request.'
}

const SYSTEM_PROMPT = `You are DocMind, an intelligent document Q&A assistant. You answer questions based ONLY on the provided document chunks.

Rules:
- Answer using ONLY information explicitly found in the provided chunks
- If the chunks don't contain enough information to answer, clearly say so
- Never fabricate or infer information beyond what is in the chunks
- Be precise, clear, and cite which chunks contain the relevant information

Confidence scoring:
- 0.8-1.0: The chunks directly and clearly answer the question
- 0.5-0.79: Partial or indirect answer found in chunks
- 0.0-0.49: Limited or no relevant information in the provided chunks

You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no extra text):
{"answer":"your detailed answer here","source_chunk_indices":[0,2,5],"confidence":0.85}

The source_chunk_indices must reference the exact [Chunk N] numbers from the provided text (0-based index N).`

function buildUserMessage(question: string, chunks: string[], documentTitle: string): string {
  return `Document: "${documentTitle}"

Document Chunks:
${chunks.join('\n\n')}

Question: ${question}

Respond with ONLY the JSON object.`
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1]
    if (inner !== undefined) return inner.trim()
  }
  const jsonStart = trimmed.indexOf('{')
  const jsonEnd = trimmed.lastIndexOf('}')
  if (jsonStart !== -1 && jsonEnd !== -1) {
    return trimmed.slice(jsonStart, jsonEnd + 1)
  }
  return trimmed
}

interface ValidRequest {
  question: string
  chunks: string[]
  documentTitle: string
}

type Validation = { ok: true; value: ValidRequest } | { ok: false; status: number; message: string }

function validate(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, message: 'Request body must be a JSON object.' }
  }
  const b = body as Record<string, unknown>

  if (typeof b['question'] !== 'string' || b['question'].trim() === '') {
    return { ok: false, status: 400, message: 'A question is required.' }
  }
  if (b['question'].length > MAX_QUESTION_CHARS) {
    return {
      ok: false,
      status: 400,
      message: `The question must be ${MAX_QUESTION_CHARS} characters or fewer.`,
    }
  }

  if (!Array.isArray(b['chunks'])) {
    return { ok: false, status: 400, message: 'chunks must be an array of document passages.' }
  }
  if (b['chunks'].length === 0) {
    return { ok: false, status: 400, message: 'No document passages were provided.' }
  }
  if (b['chunks'].length > MAX_CHUNKS) {
    return {
      ok: false,
      status: 413,
      message: `At most ${MAX_CHUNKS} document passages can be sent per question.`,
    }
  }

  if (typeof b['documentTitle'] !== 'string' || b['documentTitle'].trim() === '') {
    return { ok: false, status: 400, message: 'A document title is required.' }
  }

  return {
    ok: true,
    value: {
      question: b['question'],
      // Truncate overly long passages to keep the prompt inside the token budget.
      chunks: b['chunks'].map(c => (typeof c === 'string' ? c.slice(0, MAX_CHUNK_CHARS) : '')),
      documentTitle: b['documentTitle'].slice(0, MAX_TITLE_CHARS),
    },
  }
}

export default async (req: Request): Promise<Response> => {
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
  const { question, chunks, documentTitle } = validated.value

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return json(500, { error: 'The document assistant is not configured on this deployment.' })
  }

  let aiResponse: Response
  try {
    aiResponse = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(question, chunks, documentTitle) },
        ],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    console.error('OpenRouter request failed:', err)
    return json(timedOut ? 504 : 502, {
      error: timedOut
        ? 'The model took too long to answer. Try a shorter question.'
        : 'Could not reach the model provider. Try again shortly.',
    })
  }

  if (!aiResponse.ok) {
    console.error('OpenRouter error:', aiResponse.status, await aiResponse.text().catch(() => ''))
    return json(502, { error: upstreamMessage(aiResponse.status) })
  }

  let rawText: string | undefined
  try {
    const aiData = (await aiResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    rawText = aiData.choices?.[0]?.message?.content
  } catch (err) {
    console.error('Could not parse OpenRouter response:', err)
  }

  if (!rawText) {
    return json(502, { error: 'The model returned an empty response. Please try again.' })
  }

  let result: AiResponse
  try {
    result = JSON.parse(extractJson(rawText)) as AiResponse
  } catch {
    return json(502, { error: 'The model returned a malformed response. Please try again.' })
  }

  if (
    typeof result.answer !== 'string' ||
    !Array.isArray(result.source_chunk_indices) ||
    typeof result.confidence !== 'number' ||
    !Number.isFinite(result.confidence)
  ) {
    return json(502, { error: 'The model returned an invalid response structure. Please try again.' })
  }

  return json(200, {
    answer: result.answer,
    source_chunk_indices: result.source_chunk_indices.filter(
      (i): i is number => typeof i === 'number' && Number.isInteger(i),
    ),
    confidence: Math.min(1, Math.max(0, result.confidence)),
  })
}
