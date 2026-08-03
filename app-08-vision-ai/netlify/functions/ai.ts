export const config = { path: '/api/ai' }

const ANALYSIS_MODES = ['describe', 'analyze', 'qa', 'extract'] as const
type AnalysisMode = (typeof ANALYSIS_MODES)[number]

interface RequestBody {
  image: string
  mediaType: string
  mode: AnalysisMode
  question?: string
}

const ALLOWED_ORIGINS = [
  'https://jdgafx-app-08-vision-ai.netlify.app',
  'http://localhost:8888',
  'http://localhost:5173',
]

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// Netlify caps a function request body at 6MB; reject past that with a clear message.
const MAX_BODY_BYTES = 6 * 1024 * 1024

const MAX_TOKENS_DEFAULT = 4096
const MAX_TOKENS_EXTRACT = 8192

// Netlify's function wall is ~30s. Stop streaming early and report truncation
// rather than letting the platform kill the response mid-flight.
const STREAM_BUDGET_MS = 25_000
const UPSTREAM_CONNECT_TIMEOUT_MS = 20_000

// Best-effort throttle. In-memory, so it only covers a single warm instance.
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, number[]>()

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

function mapUpstreamError(status: number): { status: number; message: string } {
  if (status === 401 || status === 403) {
    return { status: 502, message: 'The vision service rejected our credentials.' }
  }
  if (status === 402) {
    return { status: 402, message: 'The vision service quota has been exhausted.' }
  }
  if (status === 413) {
    return { status: 413, message: 'The image is too large for the vision service.' }
  }
  if (status === 429) {
    return { status: 429, message: 'The vision service is busy. Please retry in a moment.' }
  }
  if (status >= 500) {
    return { status: 502, message: 'The vision service is temporarily unavailable.' }
  }
  return { status: 502, message: 'The vision service could not process this image.' }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed(origin)) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers: baseHeaders(origin) })
  }

  if (!isOriginAllowed(origin)) {
    return jsonError('Origin not allowed', 403, origin)
  }

  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405, origin)
  }

  if (isRateLimited(clientKey(req))) {
    return jsonError('Too many requests. Please wait a minute and try again.', 429, origin)
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonError('Image is too large. Please use an image under 4MB.', 413, origin)
  }

  const apiKey = process.env['OPENROUTER_API_KEY']
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY is not configured')
    return jsonError('Vision service is not configured.', 500, origin)
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return jsonError('Invalid JSON', 400, origin)
  }

  const { image, mediaType, mode, question } = body
  if (!image || !mode) {
    return jsonError('image and mode are required', 400, origin)
  }
  if (!ANALYSIS_MODES.includes(mode)) {
    return jsonError(`Unsupported mode. Use one of: ${ANALYSIS_MODES.join(', ')}.`, 400, origin)
  }
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    return jsonError(
      `Unsupported image format: ${mediaType || 'unknown'}. Use JPG, PNG, WebP, or GIF.`,
      400,
      origin,
    )
  }
  if (mode === 'qa' && !question?.trim()) {
    return jsonError('A question is required for Q&A mode.', 400, origin)
  }
  if (image.length > MAX_BODY_BYTES) {
    return jsonError('Image is too large. Please use an image under 4MB.', 413, origin)
  }

  const systemPrompts: Record<AnalysisMode, string> = {
    describe:
      'Provide a rich, detailed description of this image. Cover everything you observe: subjects, setting, mood, colors, composition, lighting, and any interesting or notable details.',
    analyze:
      'Provide a thorough technical analysis of this image. Cover: composition and framing, color palette and tones, key objects and their relationships, any visible text, image quality, and overall visual impact.',
    qa: `Answer the following question about this image concisely and accurately: ${question ?? 'What do you see?'}`,
    extract:
      'Extract all text, numbers, data, tables, and structured information from this image. Present the extracted content clearly and organized, preserving the original structure where possible.',
  }

  const userText =
    mode === 'qa'
      ? (question ?? 'What do you see in this image?')
      : 'Please analyze this image as requested.'

  const imageUrl = `data:${mediaType};base64,${image}`
  const maxTokens = mode === 'extract' ? MAX_TOKENS_EXTRACT : MAX_TOKENS_DEFAULT

  const upstreamAbort = new AbortController()
  const connectTimer = setTimeout(() => upstreamAbort.abort(), UPSTREAM_CONNECT_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: upstreamAbort.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '~anthropic/claude-sonnet-latest',
        max_tokens: maxTokens,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompts[mode] },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl } },
              { type: 'text', text: userText },
            ],
          },
        ],
      }),
    })
  } catch (err) {
    clearTimeout(connectTimer)
    console.error('Upstream request failed:', err)
    return jsonError('Could not reach the vision service. Please try again.', 502, origin)
  }
  clearTimeout(connectTimer)

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '<unreadable body>')
    console.error(`OpenRouter error ${upstream.status}: ${detail}`)
    const mapped = mapUpstreamError(upstream.status)
    return jsonError(mapped.message, mapped.status, origin)
  }

  const upstreamBody = upstream.body
  if (!upstreamBody) {
    console.error('OpenRouter returned an empty response body')
    return jsonError('The vision service returned an empty response.', 502, origin)
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const reader = upstreamBody.getReader()
      const decoder = new TextDecoder()
      const deadline = Date.now() + STREAM_BUDGET_MS
      let truncated = false
      let buffer = ''

      const send = (payload: Record<string, string | boolean>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      try {
        for (;;) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) {
            truncated = true
            break
          }

          let timer: ReturnType<typeof setTimeout> | undefined
          const readPromise = reader.read()
          // If the watchdog wins, nobody awaits this read; swallow its rejection.
          readPromise.catch(() => undefined)
          const chunk = await Promise.race([
            readPromise,
            new Promise<'watchdog'>(resolve => {
              timer = setTimeout(() => resolve('watchdog'), remaining)
            }),
          ])
          if (timer) clearTimeout(timer)

          if (chunk === 'watchdog') {
            truncated = true
            break
          }
          if (chunk.done) break

          buffer += decoder.decode(chunk.value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const choice = parsed.choices?.[0]
              const delta = choice?.delta?.content
              if (delta) send({ text: delta })
              if (choice?.finish_reason === 'length') truncated = true
            } catch (err) {
              console.error('Failed to parse upstream SSE payload:', data.slice(0, 200), err)
            }
          }
        }

        if (truncated) send({ truncated: true })
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        console.error('Streaming failed:', err)
        send({ error: 'The analysis stream failed partway through.' })
      } finally {
        await reader.cancel().catch(() => undefined)
        upstreamAbort.abort()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...baseHeaders(origin),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
