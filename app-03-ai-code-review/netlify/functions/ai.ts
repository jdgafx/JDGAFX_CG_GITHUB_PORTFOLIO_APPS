import { MAX_CODE_LENGTH, OVER_LIMIT_MESSAGE } from '../../src/lib/limits'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://jdgafx-app-03-ai-code-review.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

// JSON escaping can roughly double a payload, so allow headroom over MAX_CODE_LENGTH.
const MAX_BODY_BYTES = 256 * 1024
const MAX_TEXT_CHARS = 600
const UPSTREAM_TIMEOUT_MS = 25_000

const MIN_COMMENTS = 5
const MAX_COMMENTS = 15
const LINES_PER_COMMENT = 15

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

function fail(error: string, status: number, headers: Record<string, string>): Response {
  return json({ success: false, error }, status, headers)
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

function buildSystemPrompt(lang: string, lineCount: number, maxComments: number): string {
  return `You are an expert ${lang} reviewer. You return JSON and nothing else.

The file below is presented with a line number, a tab and a pipe in front of every line:

  12\t| const total = items.length

That prefix is display scaffolding, not source code. Never quote it back in a message or
suggestion, and never count lines yourself — the "line" field of each comment MUST be the
number printed in front of the line you are commenting on.

Respond with valid JSON in exactly this shape, with no markdown fence and no prose:
{
  "comments": [
    {
      "line": <integer between 1 and ${lineCount}>,
      "severity": "critical" | "warning" | "info",
      "message": "<what is wrong, one or two sentences>",
      "suggestion": "<the specific change to make>"
    }
  ]
}

Severity guidelines:
- critical: security vulnerabilities, bugs that throw or corrupt data, data loss risks
- warning: performance problems, deprecated patterns, likely bugs, code smells
- info: style, best practice and refactoring opportunities

Coverage rules:
- This file has ${lineCount} lines. Read all of it, then divide it into ${maxComments} regions of
  roughly ${Math.ceil(lineCount / maxComments)} lines each and report the most important issue in
  each region. Aim for ${maxComments} comments in total; return fewer only where a region genuinely
  has nothing worth flagging. Never cluster your findings in the opening lines.
- Sort the comments by line number, ascending. Never file two comments on the same line.
- Only cite lines that exist, from 1 to ${lineCount}. A comment carrying any other line number is
  discarded before the user sees it.
- If the code has no real issues anywhere, return {"comments": []}.`
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const headersOut = corsHeaders(origin)
  const originAllowed = !origin || ALLOWED_ORIGINS.includes(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: originAllowed ? 204 : 403, headers: headersOut })
  }

  if (!originAllowed) {
    return fail('Origin not allowed.', 403, headersOut)
  }

  if (req.method !== 'POST') {
    return fail('Method not allowed.', 405, headersOut)
  }

  const limit = rateLimit(clientKey(req))
  if (!limit.allowed) {
    return fail('Too many reviews from this address. Please wait a moment and try again.', 429, {
      ...headersOut,
      'Retry-After': String(limit.retryAfter),
    })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return fail('The review service is not configured.', 500, headersOut)
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail('Request is too large.', 413, headersOut)
  }

  let body: { code?: unknown; language?: unknown }
  try {
    const rawBody = await req.text()
    if (rawBody.length > MAX_BODY_BYTES) {
      return fail('Request is too large.', 413, headersOut)
    }
    body = JSON.parse(rawBody) as { code?: unknown; language?: unknown }
  } catch {
    return fail('Request body was not valid JSON.', 400, headersOut)
  }

  const { code, language } = body ?? {}

  if (!code || typeof code !== 'string' || !code.trim()) {
    return fail('Paste some code to review.', 400, headersOut)
  }

  if (code.length > MAX_CODE_LENGTH) {
    return fail(`${OVER_LIMIT_MESSAGE}.`, 400, headersOut)
  }

  const lang = typeof language === 'string' && /^[a-z0-9+#. -]{1,24}$/i.test(language) ? language : 'code'

  const lines = code.split('\n')
  const lineCount = lines.length
  const numberedCode = lines.map((line, i) => `${i + 1}\t| ${line}`).join('\n')
  const maxComments = Math.max(
    MIN_COMMENTS,
    Math.min(MAX_COMMENTS, Math.ceil(lineCount / LINES_PER_COMMENT)),
  )

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
        max_tokens: Math.min(4096, 512 + maxComments * 220),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt(lang, lineCount, maxComments) },
          {
            role: 'user',
            content: `Review this ${lang} file (${lineCount} lines):\n\n${numberedCode}`,
          },
        ],
      }),
    })

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return fail('The AI service is busy right now. Please try again in a moment.', 429, {
          ...headersOut,
          'Retry-After': '10',
        })
      }
      if (aiResponse.status === 401 || aiResponse.status === 403) {
        return fail('The review service rejected our credentials.', 502, headersOut)
      }
      return fail('The AI service is unavailable right now.', 502, headersOut)
    }

    const aiData = (await aiResponse.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    }
    const choice = aiData.choices?.[0]
    const rawText = choice?.message?.content
    const truncated = choice?.finish_reason === 'length'

    if (!rawText) {
      return fail('The AI returned an empty review. Please try again.', 502, headersOut)
    }

    const cleaned = rawText.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      const candidate = extractJsonObject(cleaned)
      if (!candidate) {
        return fail(
          truncated
            ? 'The review was cut short before it could be read. Try a shorter snippet.'
            : 'The AI response could not be read. Please try again.',
          502,
          headersOut,
        )
      }
      try {
        parsed = JSON.parse(candidate)
      } catch {
        return fail('The AI response could not be read. Please try again.', 502, headersOut)
      }
    }

    const rawComments = (parsed as { comments?: unknown })?.comments
    const validSeverities = ['critical', 'warning', 'info']
    const comments = (Array.isArray(rawComments) ? rawComments : [])
      .filter((c: unknown): c is Record<string, unknown> => !!c && typeof c === 'object')
      // A line outside the file is a hallucinated citation, not a roundable value: drop it.
      .filter((c) => {
        return (
          typeof c.line === 'number' &&
          Number.isInteger(c.line) &&
          c.line >= 1 &&
          c.line <= lineCount &&
          typeof c.severity === 'string' &&
          validSeverities.includes(c.severity) &&
          typeof c.message === 'string' &&
          c.message.trim().length > 0 &&
          typeof c.suggestion === 'string' &&
          c.suggestion.trim().length > 0
        )
      })
      .slice(0, MAX_COMMENTS)
      .map((c) => ({
        line: c.line as number,
        severity: c.severity as string,
        message: (c.message as string).trim().slice(0, MAX_TEXT_CHARS),
        suggestion: (c.suggestion as string).trim().slice(0, MAX_TEXT_CHARS),
      }))

    return json({ success: true, data: { comments, lineCount, truncated } }, 200, headersOut)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('The review timed out. Try a shorter snippet.', 504, headersOut)
    }
    return fail('Could not reach the review service. Please try again.', 502, headersOut)
  } finally {
    clearTimeout(timer)
  }
}

export const config = {
  path: '/api/ai',
}
