import { boundedInt } from '../shared/config'
import { corsHeaders, guardRequest, jsonError, readLimitedText } from '../shared/http'
import { MODEL, replyText, runModelCall, type Turn } from '../shared/provider'
import { createRecorder } from '../shared/trace'

// Output cap sent with every chat call. Read from the environment and clamped, so
// a bad value falls back to the default instead of being sent upstream.
const MAX_OUTPUT_TOKENS = boundedInt(process.env.MAX_OUTPUT_TOKENS, 1024, 16, 4096)
const MAX_MESSAGE_CHARS = boundedInt(process.env.MAX_MESSAGE_CHARS, 5000, 1, 20_000)
const MAX_HISTORY_MESSAGES = boundedInt(process.env.MAX_HISTORY_MESSAGES, 20, 1, 100)

// Room for the longest legitimate request: every kept message at full length, each
// character at up to 4 UTF-8 bytes and 6 bytes when JSON escaped, plus the new message.
const MAX_BODY_BYTES = (MAX_HISTORY_MESSAGES + 1) * MAX_MESSAGE_CHARS * 6 + 4096

// Netlify caps a synchronous invocation at ~30s. The whole run, retry included,
// shares this budget, so a slow upstream becomes a clean error instead of a dead socket.
const RUN_BUDGET_MS = boundedInt(process.env.UPSTREAM_TIMEOUT_MS, 25_000, 1000, 25_000)

const SYSTEM_PROMPT =
  'You are VoxAI, a friendly and helpful voice assistant. Keep responses concise ' +
  'and conversational — ideally 1-3 sentences. You are being used via voice interface.'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

// Earlier turns come from the browser, so each one must be a {role, content} pair.
// A malformed entry refuses the whole history (null). Long entries are cut to the
// message limit, and only the newest entries are kept.
function parseHistory(history: unknown): ChatMessage[] | null {
  if (history === undefined || history === null) return []
  if (!Array.isArray(history)) return null
  const clean: ChatMessage[] = []
  for (const item of history) {
    if (typeof item !== 'object' || item === null) return null
    const { role, content } = item as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    clean.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) })
  }
  return clean.slice(-MAX_HISTORY_MESSAGES)
}

// The model's served name is checked too: a safety or moderation model is never an answer.
function unsuitableModel(model: string): boolean {
  return /(content[- ]?safety|moderation|classifier|guard|toxicity|safety[- ]?model)/i.test(model)
}

// The shape a safety classifier returns, which is never a conversational answer.
function labelShaped(text: string): boolean {
  return /^(user\s+)?safety\s*:\s*(safe|unsafe)\b/i.test(text.trim().replace(/\s+/g, ' '))
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  const run = createRecorder()
  const reply = (message: string, status: number) =>
    jsonError(message, status, origin, { trace: run.steps, totalMs: run.elapsed() })

  try {
    const guard = guardRequest(req)
    if (guard) return guard

    const deadlineAt = Date.now() + RUN_BUDGET_MS
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      console.error('ai: OPENROUTER_API_KEY is not set')
      run.add('request built', 'failed', 'No AI provider is configured on this deployment')
      return reply('The assistant is not configured on this deployment.', 500)
    }

    const raw = await readLimitedText(req, MAX_BODY_BYTES)
    if (raw === null) {
      run.add('request built', 'failed', 'The request body is larger than the limit')
      return reply('That conversation is too large to send. Clear it and try again.', 400)
    }

    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      run.add('request built', 'failed', 'The request body was not JSON')
      return reply('The request was not valid JSON.', 400)
    }
    const fields: { message?: unknown; history?: unknown } =
      typeof body === 'object' && body !== null ? (body as { message?: unknown; history?: unknown }) : {}

    // Whitespace alone is not a message. The model never sees a blank turn.
    const message = typeof fields.message === 'string' ? fields.message.trim() : ''
    if (!message) {
      run.add('request built', 'failed', 'No message text was sent')
      return reply('Type or say a message first.', 400)
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      run.add('request built', 'failed', `Message is longer than ${MAX_MESSAGE_CHARS} characters`)
      return reply(`Keep messages under ${MAX_MESSAGE_CHARS} characters.`, 400)
    }

    const earlier = parseHistory(fields.history)
    if (earlier === null) {
      run.add('request built', 'failed', 'The earlier messages were not in the expected shape')
      return reply('The earlier messages could not be read. Clear the conversation and try again.', 400)
    }

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
    if (unsuitableModel(model) || labelShaped(text)) {
      console.error(`ai: rejected a label-shaped reply from ${model}`)
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
