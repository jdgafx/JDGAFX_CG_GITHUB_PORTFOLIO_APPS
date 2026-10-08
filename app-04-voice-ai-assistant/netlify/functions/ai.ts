import { corsHeaders, guardRequest, jsonError } from '../shared/http'
import { MODEL, replyText, runModelCall, type Turn } from '../shared/provider'
import { createRecorder } from '../shared/trace'

const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 1024)
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS ?? 5000)
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES ?? 20)

// Netlify caps a synchronous invocation at ~30s. The whole run, retry included,
// shares this budget, so a slow upstream becomes a clean error instead of a dead socket.
const RUN_BUDGET_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000)

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
  const deadlineAt = Date.now() + RUN_BUDGET_MS
  const run = createRecorder()
  const reply = (message: string, status: number) =>
    jsonError(message, status, origin, { trace: run.steps, totalMs: run.elapsed() })

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('ai: OPENROUTER_API_KEY is not set')
    run.add('request built', 'failed', 'No AI provider is configured on this deployment')
    return reply('The assistant is not configured on this deployment.', 500)
  }

  try {
    let body: { message?: unknown; history?: unknown }
    try {
      body = (await req.json()) as { message?: unknown; history?: unknown }
    } catch {
      run.add('request built', 'failed', 'The request body was not JSON')
      return reply('The request was not valid JSON.', 400)
    }

    const { message, history } = body
    if (!message || typeof message !== 'string') {
      run.add('request built', 'failed', 'No message text was sent')
      return reply('Type or say a message first.', 400)
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      run.add('request built', 'failed', `Message is longer than ${MAX_MESSAGE_CHARS} characters`)
      return reply(`Keep messages under ${MAX_MESSAGE_CHARS} characters.`, 400)
    }

    const earlier = sanitizeHistory(history)
    const turns: Turn[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...earlier,
      { role: 'user', content: message },
    ]
    run.add('request built', 'ok', `${earlier.length} earlier messages, ${message.length} characters`)

    const outcome = await runModelCall(apiKey, turns, { maxTokens: MAX_OUTPUT_TOKENS, deadlineAt }, run)
    if (!outcome.ok) return reply(outcome.message, outcome.httpStatus)

    const { completion } = outcome
    const model = completion.model ?? MODEL
    const text = replyText(completion)
    if (unsuitableModel(model) || classificationShaped(text)) {
      console.error(`ai: rejected unsuitable conversational output from ${model}`)
      run.add('parse and validate', 'failed', 'The reply was a moderation label, not an answer')
      return reply('The model returned a label instead of a reply. Try again.', 502)
    }
    if (!text) {
      run.add('parse and validate', 'failed', 'The reply had no text')
      return reply('The assistant returned an empty response. Try again.', 502)
    }

    const cut = completion.choices?.[0]?.finish_reason === 'length'
    run.add(
      'parse and validate',
      'ok',
      cut ? `${text.length} characters, cut off at the length limit` : `${text.length} characters`,
    )
    return Response.json(
      { result: text, trace: run.steps, usage: outcome.usage, model, totalMs: run.elapsed() },
      { headers: corsHeaders(origin) },
    )
  } catch (err) {
    console.error('ai: unhandled failure', err)
    run.add('server error', 'failed', 'Unexpected failure in the assistant function')
    return reply('The assistant failed. Try again in a moment.', 500)
  }
}

export const config = {
  path: '/api/ai',
}
