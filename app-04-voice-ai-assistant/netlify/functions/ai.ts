import { corsHeaders, guardRequest, jsonError, upstreamStatus } from '../shared/http'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const CHAT_MODEL = process.env.CHAT_MODEL ?? '~anthropic/claude-haiku-latest'
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 1024)
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS ?? 5000)
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES ?? 20)

// Netlify caps a synchronous invocation at ~30s; bail a beat early so a slow
// upstream turns into a clean 503 instead of a dead socket.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000)

const SYSTEM_PROMPT =
  'You are VoxAI, a friendly and helpful voice assistant. Keep responses concise ' +
  'and conversational — ideally 1-3 sentences. You are being used via voice interface.'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

// History arrives from the browser, so entries may be anything at all. Skip
// non-objects (null, numbers, strings) before touching their properties.
function sanitizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return []
  const clean: ChatMessage[] = []
  for (const item of history) {
    if (typeof item !== 'object' || item === null) continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
      clean.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) })
    }
  }
  return clean.slice(-MAX_HISTORY_MESSAGES)
}

export default async (req: Request): Promise<Response> => {
  const guard = guardRequest(req)
  if (guard) return guard

  const origin = req.headers.get('origin')

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('ai: OPENROUTER_API_KEY is not configured')
    return jsonError('The assistant is not configured on this deployment.', 500, origin)
  }

  try {
    let body: { message?: unknown; history?: unknown }
    try {
      body = (await req.json()) as { message?: unknown; history?: unknown }
    } catch {
      return jsonError('Invalid JSON body', 400, origin)
    }

    const { message, history } = body

    if (!message || typeof message !== 'string') {
      return jsonError('message is required', 400, origin)
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      return jsonError('Message exceeds maximum allowed length', 400, origin)
    }

    const messages: ChatMessage[] = [
      ...sanitizeHistory(history),
      { role: 'user', content: message },
    ]

    let aiResponse: Response
    try {
      aiResponse = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        body: JSON.stringify({
          model: CHAT_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        }),
      })
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      console.error('ai: upstream request failed', err)
      return jsonError(
        timedOut
          ? 'The assistant took too long to respond. Try again.'
          : 'The assistant is unreachable. Try again in a moment.',
        503,
        origin,
      )
    }

    if (!aiResponse.ok) {
      // Vendor error text can carry account/billing detail — log it, never ship it.
      const detail = await aiResponse.text().catch(() => '<unreadable>')
      console.error(`ai: upstream ${aiResponse.status} ${aiResponse.statusText}: ${detail}`)
      return jsonError(
        aiResponse.status === 429
          ? 'The assistant is rate limited right now. Try again in a moment.'
          : aiResponse.status === 402
            ? 'The assistant service is temporarily unavailable. Please try again later.'
            : 'The assistant failed to respond. Try again in a moment.',
        upstreamStatus(aiResponse.status),
        origin,
      )
    }

    let aiData: { choices?: Array<{ message?: { content?: unknown } }> }
    try {
      aiData = (await aiResponse.json()) as typeof aiData
    } catch (err) {
      console.error('ai: could not parse upstream JSON', err)
      return jsonError('The assistant returned an unreadable response.', 502, origin)
    }

    const rawText = aiData.choices?.[0]?.message?.content
    if (typeof rawText !== 'string' || !rawText.trim()) {
      console.error('ai: unexpected upstream payload shape', JSON.stringify(aiData).slice(0, 500))
      return jsonError('The assistant returned an empty response. Try again.', 502, origin)
    }

    return Response.json({ response: rawText }, { headers: corsHeaders(origin) })
  } catch (err) {
    console.error('ai: unhandled failure', err)
    return jsonError('The assistant failed. Try again in a moment.', 500, origin)
  }
}

export const config = {
  path: '/api/ai',
}
