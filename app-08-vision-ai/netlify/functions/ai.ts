import { getProvider, type ChatMessage } from '../shared/provider'
import { streamVisionRun, type TraceStep } from '../shared/vision-run'

export const config = { path: '/api/ai' }

const ANALYSIS_MODES = ['describe', 'analyze', 'qa', 'extract'] as const
type AnalysisMode = (typeof ANALYSIS_MODES)[number]

const MODE_LABELS: Record<AnalysisMode, string> = {
  describe: 'Describe',
  analyze: 'Analyze',
  qa: 'Q&A',
  extract: 'Extract',
}

interface AnalysisRequest {
  image: string
  mediaType: string
  mode: AnalysisMode
  question: string
}

type CheckedBody = { ok: true; value: AnalysisRequest } | { ok: false; status: number; message: string }

const ALLOWED_ORIGINS = [
  'https://jdgafx-app-08-vision-ai.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// Netlify caps a function request body at 6MB; reject past that with a clear message.
const MAX_BODY_BYTES = 6 * 1024 * 1024
const TOO_LARGE_MESSAGE = 'Image is too large. Please use an image under 4MB.'

const MAX_TOKENS_DEFAULT = 4096
const MAX_TOKENS_EXTRACT = 8192

// Best-effort throttle. In-memory, so it only covers a single warm instance.
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, number[]>()

const SYSTEM_PROMPTS: Record<Exclude<AnalysisMode, 'qa'>, string> = {
  describe:
    'Provide a rich, detailed description of this image. Cover everything you observe: subjects, setting, mood, colors, composition, lighting, and any interesting or notable details.',
  analyze:
    'Provide a thorough technical analysis of this image. Cover: composition and framing, color palette and tones, key objects and their relationships, any visible text, image quality, and overall visual impact.',
  extract:
    'Extract all text, numbers, data, tables, and structured information from this image. Present the extracted content clearly and organized, preserving the original structure where possible.',
}

function baseHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function jsonError(message: string, status: number, origin: string | null): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...baseHeaders(origin), 'Content-Type': 'application/json' },
  })
}

// Failures before the model call carry a one-step trace, so the UI can mark the failed step.
function checkFailed(message: string, status: number, origin: string | null, startedAt: number): Response {
  const totalMs = Date.now() - startedAt
  const trace: TraceStep[] = [{ name: 'Request checked', status: 'failed', ms: totalMs, detail: message }]
  return new Response(JSON.stringify({ error: message, trace, totalMs }), {
    status,
    headers: { ...baseHeaders(origin), 'Content-Type': 'application/json' },
  })
}

function isOriginAllowed(origin: string | null): boolean {
  // Same-origin requests and non-browser clients may omit Origin entirely.
  return origin === null || ALLOWED_ORIGINS.includes(origin)
}

function clientKey(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const hits = (rateBuckets.get(key) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, hits)
    return true
  }
  hits.push(now)
  rateBuckets.set(key, hits)
  // Keep the map from growing without bound on a long-lived warm instance.
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (v.every(t => now - t >= RATE_LIMIT_WINDOW_MS)) rateBuckets.delete(k)
    }
  }
  return false
}

function isAnalysisMode(value: string): value is AnalysisMode {
  return (ANALYSIS_MODES as readonly string[]).includes(value)
}

function rejected(status: number, message: string): CheckedBody {
  return { ok: false, status, message }
}

function checkBody(input: unknown): CheckedBody {
  if (typeof input !== 'object' || input === null) return rejected(400, 'Request body must be a JSON object.')
  const { image, mediaType, mode, question } = input as Record<string, unknown>
  if (typeof image !== 'string' || !image || typeof mode !== 'string') {
    return rejected(400, 'image and mode are required')
  }
  if (!isAnalysisMode(mode)) {
    return rejected(400, `Unsupported mode. Use one of: ${ANALYSIS_MODES.join(', ')}.`)
  }
  if (typeof mediaType !== 'string' || !SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    const shown = typeof mediaType === 'string' && mediaType ? mediaType : 'unknown'
    return rejected(400, `Unsupported image format: ${shown}. Use JPG, PNG, WebP, or GIF.`)
  }
  const text = typeof question === 'string' ? question.trim() : ''
  if (mode === 'qa' && !text) return rejected(400, 'A question is required for Q&A mode.')
  if (image.length > MAX_BODY_BYTES) return rejected(413, TOO_LARGE_MESSAGE)
  return { ok: true, value: { image, mediaType, mode, question: text } }
}

function buildMessages(request: AnalysisRequest): ChatMessage[] {
  const system =
    request.mode === 'qa'
      ? `Answer the following question about this image concisely and accurately: ${request.question}`
      : SYSTEM_PROMPTS[request.mode]
  const userText = request.mode === 'qa' ? request.question : 'Please analyze this image as requested.'
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${request.mediaType};base64,${request.image}` } },
        { type: 'text', text: userText },
      ],
    },
  ]
}

export default async function handler(req: Request): Promise<Response> {
  const startedAt = Date.now()
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed(origin)) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers: baseHeaders(origin) })
  }

  if (!isOriginAllowed(origin)) return jsonError('Origin not allowed', 403, origin)
  if (req.method !== 'POST') return jsonError('Method not allowed', 405, origin)
  if (isRateLimited(clientKey(req))) {
    return checkFailed('Too many requests. Please wait a minute and try again.', 429, origin, startedAt)
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_BODY_BYTES) return checkFailed(TOO_LARGE_MESSAGE, 413, origin, startedAt)

  const provider = getProvider()
  if (!provider) {
    console.error('OPENROUTER_API_KEY is not set')
    return checkFailed('The AI provider is not configured on the server.', 500, origin, startedAt)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return checkFailed('Invalid JSON', 400, origin, startedAt)
  }
  const checked = checkBody(body)
  if (!checked.ok) return checkFailed(checked.message, checked.status, origin, startedAt)

  const request = checked.value
  const kilobytes = Math.round((request.image.length * 3) / 4 / 1024)
  const checkedStep: TraceStep = {
    name: 'Request checked',
    status: 'ok',
    ms: Date.now() - startedAt,
    detail: `${MODE_LABELS[request.mode]}, ${request.mediaType}, about ${kilobytes} KB`,
  }
  return streamVisionRun({
    provider,
    messages: buildMessages(request),
    maxTokens: request.mode === 'extract' ? MAX_TOKENS_EXTRACT : MAX_TOKENS_DEFAULT,
    startedAt,
    checked: checkedStep,
    headers: baseHeaders(origin),
  })
}
