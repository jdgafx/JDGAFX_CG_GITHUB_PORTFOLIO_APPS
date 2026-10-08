import { getProvider } from '../shared/provider'
import {
  MAX_BODY_BYTES,
  TOO_LARGE_MESSAGE,
  buildMessages,
  checkBody,
  checkedDetail,
  maxTokensFor,
} from '../shared/request'
import { streamVisionRun, type TraceStep } from '../shared/vision-run'

export const config = { path: '/api/ai' }

const ALLOWED_ORIGINS = [
  'https://jdgafx-app-08-vision-ai.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

const GENERIC_FAILURE = 'The analysis could not start. Please try again.'

// Best-effort throttle. In-memory, so it only covers a single warm instance.
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, number[]>()

type BodyRead = { ok: true; value: unknown } | { ok: false; message: string }

export default async function handler(req: Request): Promise<Response> {
  const startedAt = Date.now()
  let origin: string | null = null
  try {
    origin = req.headers.get('origin')
    return await respond(req, origin, startedAt)
  } catch (err) {
    console.error('Analysis request failed unexpectedly:', err instanceof Error ? err.name : 'unknown')
    return jsonError(GENERIC_FAILURE, 500, origin)
  }
}

async function respond(req: Request, origin: string | null, startedAt: number): Promise<Response> {
  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed(origin)) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers: baseHeaders(origin) })
  }
  if (!isOriginAllowed(origin)) return jsonError('Origin not allowed', 403, origin)
  if (req.method !== 'POST') return jsonError('Method not allowed', 405, origin)
  if (isRateLimited(clientKey(req))) {
    return checkFailed('Too many requests. Please wait a minute and try again.', 429, origin, startedAt)
  }

  const body = await readJsonBody(req)
  if (!body.ok) return checkFailed(body.message, 400, origin, startedAt)
  const checked = checkBody(body.value)
  if (!checked.ok) return checkFailed(checked.message, 400, origin, startedAt)

  const provider = getProvider()
  if (!provider) {
    console.error('OPENROUTER_API_KEY is not set')
    return checkFailed('The AI provider is not configured on the server.', 500, origin, startedAt)
  }

  const request = checked.value
  const checkedStep: TraceStep = {
    name: 'Request checked',
    status: 'ok',
    ms: Date.now() - startedAt,
    detail: checkedDetail(request),
  }
  return streamVisionRun({
    provider,
    messages: buildMessages(request),
    maxTokens: maxTokensFor(request.mode),
    startedAt,
    checked: checkedStep,
    headers: baseHeaders(origin),
  })
}

// The declared length is checked first, then the bytes actually received, because the header can be missing or wrong.
async function readJsonBody(req: Request): Promise<BodyRead> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return { ok: false, message: TOO_LARGE_MESSAGE }
  let bytes: ArrayBuffer
  try {
    bytes = await req.arrayBuffer()
  } catch {
    return { ok: false, message: 'The request body could not be read.' }
  }
  if (bytes.byteLength > MAX_BODY_BYTES) return { ok: false, message: TOO_LARGE_MESSAGE }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { ok: false, message: 'The request body is not valid JSON.' }
  }
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
