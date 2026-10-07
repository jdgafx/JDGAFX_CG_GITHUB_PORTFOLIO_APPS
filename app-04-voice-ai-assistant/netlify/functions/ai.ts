import { corsHeaders, guardRequest, jsonError, upstreamStatus } from '../shared/http'
import { generationOptions, getProvider, requestWithContentRetry } from '../shared/provider'

const CHAT_MODEL = process.env.CHAT_MODEL ?? 'nvidia/nemotron-3-nano-30b-a3b:free'
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

function unsuitableModel(model: string): boolean {
  return /(content[- ]?safety|moderation|classifier|guard|toxicity|safety[- ]?model)/i.test(model)
}

function classificationShaped(text: string): boolean {
  const compact = text.trim().replace(/\s+/g, ' ')
  return /^(user\s+)?safety\s*:\s*(safe|unsafe)\b/i.test(compact)
    || /^(classification|label|category|moderation)\s*:/i.test(compact)
}

export default async (req: Request): Promise<Response> => {
  const guard = guardRequest(req)
  if (guard) return guard

  const origin = req.headers.get('origin')

  const provider = getProvider(CHAT_MODEL)
  if (!provider) {
    console.error('ai: no server-side AI provider is configured')
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

    let aiResponse: Response | null = null
    let aiData: { model?: string; choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> }
    let selectedProvider = provider
    try {
      aiResponse = await requestWithContentRetry(() => fetch(provider.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          body: JSON.stringify({
            model: provider.model,
            ...generationOptions(provider, MAX_OUTPUT_TOKENS),
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
          }),
        }))
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

    try {
      aiData = (await aiResponse.json()) as typeof aiData
    } catch (err) {
      console.error('ai: could not parse upstream JSON', err)
      return jsonError('The assistant returned an unreadable response.', 502, origin)
    }

    const rawText = aiData?.choices?.[0]?.message?.content
    const servedModel = aiData?.model ?? selectedProvider.model
    if (unsuitableModel(servedModel) || (typeof rawText === 'string' && classificationShaped(rawText))) {
      console.error(`ai: rejected unsuitable conversational output from ${servedModel}`)
      return jsonError('The assistant route returned a non-conversational result. Please retry.', 502, origin)
    }
    if (typeof rawText !== 'string' || !rawText.trim()) {
      console.error('ai: unexpected upstream payload shape', JSON.stringify(aiData).slice(0, 500))
      return jsonError('The assistant returned an empty response. Try again.', 502, origin)
    }

    return Response.json({ response: rawText, served_model: servedModel, served_provider: selectedProvider.name }, { headers: corsHeaders(origin) })
  } catch (err) {
    console.error('ai: unhandled failure', err)
    return jsonError('The assistant failed. Try again in a moment.', 500, origin)
  }
}

export const config = {
  path: '/api/ai',
}
