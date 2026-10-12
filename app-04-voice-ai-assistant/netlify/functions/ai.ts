import { PING_MS, RUN_BUDGET_MS } from '../shared/budget'
import { corsHeaders, guardRequest, jsonError, readJsonBody } from '../shared/http'
import { runModelCall, type Turn } from '../shared/provider'
import { DONE_EVENT, PING, encodeEvent } from '../shared/sse'
import { createRecorder } from '../shared/trace'

// Output cap sent with every chat call. Thinking tokens count against it: a few hundred to about
// 500 for Haiku here, then the 1 to 3 sentence reply, so 2560 leaves the reply room.
const MAX_OUTPUT_TOKENS = 2560
const MAX_MESSAGE_CHARS = 5000
const MAX_HISTORY_MESSAGES = 20

// Room for the longest legitimate request: every kept message at full length, each
// character at up to 4 UTF-8 bytes and 6 bytes when JSON escaped, plus the new message.
const MAX_BODY_BYTES = (MAX_HISTORY_MESSAGES + 1) * MAX_MESSAGE_CHARS * 6 + 4096

const SYSTEM_PROMPT =
  'You are VoxAI, a friendly and helpful voice assistant. Keep responses concise ' +
  'and conversational — ideally 1-3 sentences. You are being used via voice interface. ' +
  'You have two live tools. Use weather for weather or temperature questions about a place, and ' +
  'wikipedia_summary for factual questions about a person, place, event or concept. ' +
  'Answer only from what a tool returns, with its units, and name the place or article. ' +
  'If a tool reports that it failed or found nothing, say so plainly and do not guess a value. ' +
  'Do not use a tool for small talk or questions you can answer without live data. ' +
  'Your words are read aloud: write plain sentences with no markdown, lists or emoji. ' +
  'Call a tool without saying anything before it, then answer from its result.'

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

type Run = ReturnType<typeof createRecorder>

// The reply as server-sent events: `step` for each trace step as it happens, `delta` for each piece of
// the answer, then `done` (or `error`) and [DONE]. The visitor's Stop closes the connection, which
// aborts the model call and any tool in flight.
function answerStream(
  apiKey: string,
  turns: Turn[],
  deadlineAt: number,
  run: Run,
  requestSignal: AbortSignal,
  attach: (send: (event: unknown) => void) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const stop = new AbortController()
  let open = true
  let ping: ReturnType<typeof setInterval> | undefined
  const forward = () => stop.abort()
  requestSignal.addEventListener('abort', forward, { once: true })
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (open) controller.enqueue(encoder.encode(chunk))
      }
      const send = (event: unknown) => write(encodeEvent(event))
      ping = setInterval(() => write(PING), PING_MS)
      for (const step of run.steps) send({ type: 'step', step })
      attach(send)
      try {
        const outcome = await runModelCall(
          apiKey,
          turns,
          { maxTokens: MAX_OUTPUT_TOKENS, deadlineAt, cancel: stop.signal, onText: text => send({ type: 'delta', text }) },
          run,
        )
        if (!outcome.ok) send({ type: 'error', error: outcome.message, usage: outcome.usage, totalMs: run.elapsed() })
        else if (!outcome.text) {
          run.add('parse and validate', 'failed', 'The reply had no text')
          send({ type: 'error', error: 'The assistant returned an empty response. Try again.', usage: outcome.usage, totalMs: run.elapsed() })
        } else {
          run.add('parse and validate', 'ok', `${outcome.text.length} characters`)
          const { servedModel, newestModel, modelCheck, checkedModel } = outcome.record
          send({ type: 'done', result: outcome.text, model: servedModel, newestModel, modelCheck, checkedModel, usage: outcome.usage, totalMs: run.elapsed() })
        }
      } catch (err) {
        console.error('ai: stream failed', err)
        run.add('server error', 'failed', 'Unexpected failure in the assistant function')
        send({ type: 'error', error: 'The assistant failed. Try again in a moment.', totalMs: run.elapsed() })
      } finally {
        clearInterval(ping)
        requestSignal.removeEventListener('abort', forward)
        write(DONE_EVENT)
        if (open) {
          open = false
          controller.close()
        }
      }
    },
    cancel() {
      open = false
      clearInterval(ping)
      stop.abort()
    },
  })
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin')
  // Once the stream is open, every trace step goes out the moment it is recorded.
  let emit: (event: unknown) => void = () => undefined
  const run = createRecorder(step => emit({ type: 'step', step }))
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

    const body = await readJsonBody(req, MAX_BODY_BYTES)
    if (!body.ok && body.reason === 'too-large') {
      run.add('request built', 'failed', 'The request body is larger than the limit')
      return reply('That conversation is too large to send. Clear it and try again.', 400)
    }
    if (!body.ok) {
      run.add('request built', 'failed', 'The request body was not JSON')
      return reply('The request was not valid JSON.', 400)
    }
    const { fields } = body

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

    return new Response(
      answerStream(apiKey, turns, deadlineAt, run, req.signal, send => {
        emit = send
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          ...corsHeaders(origin),
        },
      },
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
