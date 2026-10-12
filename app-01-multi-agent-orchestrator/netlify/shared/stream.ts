import { isCutOff } from '../../src/lib/finish'
import { sumUsage } from '../../src/lib/usage'
import type { StageUsage } from '../../src/types'
import type { AgentConfig } from './agents'
import { raceAbort } from './deadline'
import { buildChatBody, requestHeaders, type Provider } from './provider'

const RETRY_DELAY_MS = 800
/** A second attempt only starts if at least this much of the run budget is left. */
const MIN_RETRY_MS = 2_000

export const TIMEOUT_MESSAGE = 'The AI provider did not answer in time.'

/** Upstream returned a non-2xx. The status is kept so it can be mapped to plain words. */
export class UpstreamError extends Error {
  constructor(readonly status: number, detail: string) {
    super(detail)
    this.name = 'UpstreamError'
  }
}

/** The attempt's time cap expired before the provider answered. */
class AgentTimeoutError extends Error {
  constructor() {
    super('agent timed out')
    this.name = 'AgentTimeoutError'
  }
}

/** The visitor left, so the run stops. Nothing further is called and nothing further is sent. */
export class RunCancelledError extends Error {
  constructor() {
    super('run cancelled')
    this.name = 'RunCancelledError'
  }
}

export interface StageResult {
  content: string
  /** The provider's finish reason, or a cut-off reason from src/lib/finish.ts. */
  finish: string | null
  /** The served model of the attempt that gave the reply. */
  servedModel?: string
  /** The served model of every attempt that was read, in order, so a mismatch in an earlier attempt is still seen. */
  attemptServed?: Array<string | undefined>
  reasoningTokens: number
  usage: StageUsage
  /** Why a second attempt was made, when it was: 'timeout', 'connection', 'provider' or 'reply'. */
  retried?: string
}

/**
 * The plain words for a reply that was cut off, or null when it finished. `subject` is who was cut off ("Analyst",
 * "The audit"). A cut-off reply is never parsed, shown or passed on, whatever its text looks like.
 */
export function cutOffMessage(finish: string | null, subject: string, consequence: string): string | null {
  if (!isCutOff(finish)) return null
  if (finish === 'timeout') return TIMEOUT_MESSAGE
  return finish === 'length'
    ? `${subject} ran out of reply length before it finished${consequence}. Try again.`
    : `${subject} stopped before it finished${consequence}. Try again.`
}

/** Maps a provider status to words a visitor can act on. Raw provider bodies never leave the server. */
export function friendlyUpstreamMessage(status: number): string {
  if (status === 401 || status === 402 || status === 403) return 'The AI provider rejected the key or is out of credit.'
  if (status === 429) return 'Rate limited, try again in a minute.'
  if (status === 408 || status >= 500) return TIMEOUT_MESSAGE
  return 'The AI provider could not complete this request.'
}

interface OpenStream {
  body: ReadableStream<Uint8Array>
  abort: AbortController
  clearTimer: () => void
}

interface OpenRouterChunk {
  model?: unknown
  error?: unknown
  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
    cost?: unknown
    completion_tokens_details?: { reasoning_tokens?: unknown }
  }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** A fetch cut off by a timer or by the run surfaces as an AbortError or TimeoutError. */
function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

/** Only a rate limit or a server error is retried. */
function isRetryable(err: unknown): err is UpstreamError {
  return err instanceof UpstreamError && (err.status === 429 || err.status >= 500)
}

/** The request never got an answer: the connection failed before any response (not a status, not our timer). */
export function isConnectionError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|fetch failed/i.test(err.message))
}

/** A reply is retried when it has no text, or when it stopped before its finish reason. */
function needsRetry(result: StageResult): boolean {
  return !result.content.trim() || isCutOff(result.finish)
}

/** Opens one upstream stream under its own abort timer. The run signal aborts it too. */
async function openStream(
  agent: AgentConfig,
  userMessage: string,
  provider: Provider,
  timeoutMs: number,
  runSignal: AbortSignal,
): Promise<OpenStream> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  const onRunAbort = () => abort.abort()
  runSignal.addEventListener('abort', onRunAbort, { once: true })
  const clearTimer = () => {
    clearTimeout(timer)
    runSignal.removeEventListener('abort', onRunAbort)
  }

  try {
    // The timer ends the wait even when the fetch ignores the abort, so raceAbort backs it up.
    const response = await raceAbort(
      fetch(provider.url, {
        method: 'POST',
        signal: abort.signal,
        headers: requestHeaders(provider.apiKey),
        body: JSON.stringify(buildChatBody(agent.systemPrompt, userMessage, agent.maxTokens)),
      }),
      abort.signal,
    )

    if (!response.ok) {
      const detail = await raceAbort(response.text(), abort.signal).catch(() => '')
      throw new UpstreamError(response.status, detail.slice(0, 300) || response.statusText)
    }
    if (!response.body) throw new UpstreamError(response.status, 'empty response body from upstream')
    return { body: response.body, abort, clearTimer }
  } catch (err) {
    clearTimer()
    if (runSignal.aborted) throw new RunCancelledError()
    if (abort.signal.aborted || isAbortLike(err)) throw new AgentTimeoutError()
    throw err
  }
}

/** Reads one `data:` line of the upstream stream into the result. Other lines are ignored. */
export function parseFrame(line: string, result: StageResult): void {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data: ')) return
  const data = trimmed.slice(6)
  if (data === '[DONE]') return

  let chunk: OpenRouterChunk
  try {
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object') return
    chunk = parsed as OpenRouterChunk
  } catch {
    return // keep-alive comments and partial frames
  }

  if (typeof chunk.model === 'string') result.servedModel = chunk.model
  const choice = chunk.choices?.[0]
  const text = choice?.delta?.content
  if (typeof text === 'string') result.content += text
  if (typeof choice?.finish_reason === 'string') result.finish = choice.finish_reason
  // An error object inside the stream means the provider cut the reply short. Its text is never kept.
  if (chunk.error) result.finish = 'error'

  const usage = chunk.usage
  if (usage) {
    result.usage = {
      prompt_tokens: num(usage.prompt_tokens),
      completion_tokens: num(usage.completion_tokens),
      total_tokens: num(usage.total_tokens),
      cost: num(usage.cost),
    }
    result.reasoningTokens = num(usage.completion_tokens_details?.reasoning_tokens) ?? 0
  }
}

/**
 * Reads one attempt to its end. A timer or a cancelled run ends it with what arrived. A read
 * that fails mid-body keeps what was already parsed. A reply that stopped without a finish
 * reason is labelled interrupted.
 */
async function readAttempt(stream: OpenStream): Promise<StageResult> {
  const result: StageResult = { content: '', finish: null, reasoningTokens: 0, usage: {} }
  const reader = stream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      // The read races the attempt's abort, so a stalled stream ends at the timer with what arrived.
      const { done, value } = await raceAbort(reader.read(), stream.abort.signal)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) parseFrame(line, result)
    }
    for (const line of buffer.split('\n')) parseFrame(line, result)
  } catch {
    // A failed read keeps what was parsed. The reply is labelled below.
  } finally {
    stream.clearTimer()
    reader.cancel().catch(() => {})
  }
  if (stream.abort.signal.aborted) result.finish = 'timeout'
  else if (result.finish === null) result.finish = 'interrupted'
  return result
}

/**
 * Folds the attempts of one stage into one result. The reply is the last attempt read: a retry starts only after
 * an empty or cut-off attempt, so an earlier attempt is never the one to use, however much text it held. Usage is
 * summed over every attempt, because a retry is billed too. As in usage.ts, the total is reported only when every
 * attempt reported usage, so an attempt that was cut off before its usage arrived leaves it not reported.
 */
function combineAttempts(attempts: StageResult[], retried: string | undefined): StageResult {
  const last = attempts[attempts.length - 1]
  if (!last) return { content: '', finish: 'timeout', reasoningTokens: 0, usage: {}, attemptServed: [], ...(retried ? { retried } : {}) }
  return {
    ...(retried ? { retried } : {}),
    content: last.content,
    finish: last.finish,
    servedModel: last.servedModel,
    attemptServed: attempts.map(attempt => attempt.servedModel),
    reasoningTokens: attempts.reduce((sum, attempt) => sum + attempt.reasoningTokens, 0),
    usage: sumUsage(attempts.map(attempt => attempt.usage)),
  }
}

/**
 * Runs one stage: at most two attempts, both on the fixed model. Every attempt's time cap is cut
 * to what is left of the shared run deadline, and a second attempt starts only when MIN_RETRY_MS
 * or more is left. A retry follows an empty or cut-off reply, or a 429 or 5xx that produced
 * nothing. The result is the last attempt read, so a cut-off result means the final attempt was cut off: the
 * caller must not use its text (see cutOffMessage). If the retry delay leaves no
 * room for a second attempt and nothing arrived, the provider's own error is thrown, not a timeout.
 * A cancelled run throws RunCancelledError and starts no further call.
 */
export async function runStage(
  agent: AgentConfig,
  userMessage: string,
  provider: Provider,
  deadline: number,
  runSignal: AbortSignal,
): Promise<StageResult> {
  const attempts: StageResult[] = []
  let providerError: UpstreamError | undefined
  /** Why the next attempt is a retry; it becomes `retried` once that attempt really starts. */
  let pending: string | undefined
  let retried: string | undefined

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (runSignal.aborted) throw new RunCancelledError()
    if (attempt > 0) {
      if (deadline - Date.now() < MIN_RETRY_MS) {
        if (attempts.length === 0 && providerError) throw providerError
        break
      }
      retried = pending
    }

    let stream: OpenStream
    try {
      stream = await openStream(agent, userMessage, provider, Math.min(agent.timeoutMs, deadline - Date.now()), runSignal)
    } catch (err) {
      if (err instanceof RunCancelledError) throw err
      if (attempts.length > 0) break
      if (attempt === 0 && err instanceof AgentTimeoutError) {
        // The call hung before any answer: one more try, with no wait, if the budget allows.
        pending = 'timeout'
        continue
      }
      if (err instanceof AgentTimeoutError) break
      if (attempt === 0 && (isRetryable(err) || isConnectionError(err))) {
        if (isRetryable(err)) providerError = err
        pending = isRetryable(err) ? 'provider' : 'connection'
        await delay(RETRY_DELAY_MS)
        continue
      }
      throw err
    }

    const result = await readAttempt(stream)
    if (runSignal.aborted) throw new RunCancelledError()
    attempts.push(result)
    if (!needsRetry(result)) break
    pending = 'reply'
  }

  return combineAttempts(attempts, retried)
}
