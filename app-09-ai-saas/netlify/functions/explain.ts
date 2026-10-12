import { CLAIM_SCHEMA, SYSTEM_RULES, buildUserMessage, decodeRequest } from '../../shared/modelInput'
import type { ExplainReply, ExplainResponse } from '../../shared/types'
import { originAllowed, parseParagraph, readText, validateExplainRequest } from '../shared/boundary'
import { clientKey, createRateLimiter } from '../shared/rateLimit'
import { UpstreamError, buildChatBody, callModel, costOf, liveModelList, type ModelReply } from '../shared/openrouter'

export const config = { path: '/api/explain' }

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })
}

/** 20 requests a minute per client: a run is one request per package, so this is several runs a minute. */
const rateLimit = createRateLimiter()

type Failure = Extract<ExplainResponse, { ok: false }>['reason']

/** Turns the model's reply into the answer. Structure only: the figures are judged in the browser. */
function interpret(reply: ModelReply, names: string[], target: string, modelMs: number): ExplainResponse {
  const { promptTokens, completionTokens, reasoningTokens } = reply
  // On every reply, ok or not: a cut-off or malformed answer was still paid for.
  const usage = promptTokens !== null && completionTokens !== null && reasoningTokens !== null
    ? { prompt: promptTokens, completion: completionTokens, reasoning: reasoningTokens }
    : null
  const fail = (reason: Failure): ExplainResponse => ({ ok: false, reason, servedModel: reply.model, usage })
  if (reply.finish === 'length') return fail('invalid:cut-off')
  const content = reply.content?.trim() ?? ''
  if (content === '') return fail('invalid:empty')
  let decoded: unknown
  try {
    decoded = JSON.parse(content)
  } catch {
    return fail('invalid:not-json')
  }
  const paragraph = parseParagraph(decoded, names, target)
  if (!paragraph) return fail('invalid:bad-shape')
  return { ok: true, paragraph, servedModel: reply.model, usage, modelMs }
}

/**
 * POST /api/explain: one model call for one package (ExplainRequest in, ExplainResponse out). The request is
 * checked first; the model-list lookup starts alongside the call.
 */
export default async function handler(req: Request): Promise<Response> {
  if (!originAllowed(req)) return json({ error: 'Origin not allowed.' }, 403)
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const limit = rateLimit(clientKey(req))
  if (!limit.allowed) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429, { 'Retry-After': String(limit.retryAfter) })
  const text = await readText(req)
  if (!text.ok) return json({ error: text.message }, 400)
  let decoded: unknown
  try {
    decoded = decodeRequest(text.text)
  } catch {
    return json({ error: 'The request body must be JSON.' }, 400)
  }
  const parsed = validateExplainRequest(decoded)
  if (!parsed.ok) return json({ error: parsed.message }, 400)
  const request = parsed.request

  // Anything in the request that the checks let through but the prompt cannot be built from is a refusal, never a bare 500.
  let chat: ReturnType<typeof buildChatBody>
  try {
    chat = buildChatBody(SYSTEM_RULES(request.window.name, request.target), buildUserMessage(request), CLAIM_SCHEMA(request.names))
  } catch {
    return json({ error: 'The request could not be turned into a prompt.' }, 400)
  }

  // `costUsd` 0 where no model ran (no key, or the provider refused the request with a 4xx), null where a call may have been charged.
  const unavailable = (newestModel: string | null, costUsd: 0 | null = null): Response => {
    const reply: ExplainReply = { ok: false, reason: 'model-unavailable', servedModel: null, usage: null, newestModel, costUsd }
    return json(reply, 502)
  }
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return unavailable(null, 0)

  const listed = liveModelList()
  // The model's own time, not the longer of the model and the list.
  const started = Date.now()
  let refused = false
  const [reply, list] = await Promise.all([
    callModel(chat, apiKey).then(
      (value) => ({ value, modelMs: Date.now() - started }),
      (error: unknown) => {
        refused = error instanceof UpstreamError && error.status >= 400 && error.status < 500 && error.status !== 408
        return null
      },
    ),
    listed,
  ])
  if (!reply) return unavailable(list?.newest ?? null, refused ? 0 : null)
  const answer: ExplainReply = {
    ...interpret(reply.value, request.names, request.target, reply.modelMs),
    newestModel: list?.newest ?? null,
    costUsd: costOf(reply.value, list),
  }
  return json(answer, 200)
}
