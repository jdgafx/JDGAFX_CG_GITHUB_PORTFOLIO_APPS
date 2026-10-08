import { sumUsage } from '../../src/lib/usage'
import type { StageUsage } from '../../src/types'
import type { AgentConfig } from './agents'
import { APP_TITLE, MODEL, SITE_URL, type Provider } from './provider'

const RETRY_DELAY_MS = 800
/** A second attempt only starts if at least this much of the run budget is left. */
const MIN_RETRY_MS = 2_000

/** Upstream returned a non-2xx. The status is kept so it can be mapped to plain words. */
export class UpstreamError extends Error {
  constructor(readonly status: number, detail: string) {
    super(detail)
    this.name = 'UpstreamError'
  }
}

/** The attempt's time cap expired before the connection opened. */
class AgentTimeoutError extends Error {
  constructor() {
    super('agent timed out')
    this.name = 'AgentTimeoutError'
  }
}

export interface StageResult {
  content: string
  /** 'stop' | 'length' | 'timeout' | null */
  finish: string | null
  servedModel?: string
  reasoningTokens: number
  usage: StageUsage
}

/** Maps a provider status to words a visitor can act on. Raw provider bodies never leave the server. */
export function friendlyUpstreamMessage(status: number): string {
  if (status === 402) return 'The AI provider is out of credit, so this stage could not run.'
  if (status === 429) return 'The AI provider is rate limiting this demo. Wait a few seconds and try again.'
  if (status === 401 || status === 403) return 'The AI provider rejected the server credentials.'
  if (status >= 500) return 'The AI provider failed on its side. Try again in a moment.'
  return 'The AI provider could not complete this request.'
}

interface OpenStream {
  body: ReadableStream<Uint8Array>
  abort: AbortController
  clearTimer: () => void
}

interface OpenRouterChunk {
  model?: unknown
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

function isRetryable(err: unknown): boolean {
  if (err instanceof AgentTimeoutError) return true
  return err instanceof UpstreamError && (err.status === 408 || err.status === 429 || err.status >= 500)
}

function needsRetry(result: StageResult): boolean {
  return !result.content.trim() || result.finish === 'length' || result.finish === 'timeout'
}

/** Opens one upstream stream under its own abort timer. Each attempt gets a fresh signal. */
async function openStream(agent: AgentConfig, userMessage: string, provider: Provider, timeoutMs: number): Promise<OpenStream> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  const clearTimer = () => clearTimeout(timer)

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': SITE_URL,
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: agent.maxTokens,
        provider: { require_parameters: true },
        stream: true,
        stream_options: { include_usage: true },
        // Reasoning tokens are billed against max_tokens, so reasoning stays off.
        reasoning: { enabled: false },
        messages: [
          { role: 'system', content: agent.systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new UpstreamError(response.status, detail.slice(0, 300) || response.statusText)
    }
    if (!response.body) throw new UpstreamError(response.status, 'empty response body from upstream')
    return { body: response.body, abort, clearTimer }
  } catch (err) {
    clearTimer()
    if (abort.signal.aborted) throw new AgentTimeoutError()
    throw err
  }
}

function parseFrame(line: string, result: StageResult): void {
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

/** Reads one attempt to its end. An abort from the timer ends it with whatever arrived. */
async function readAttempt(stream: OpenStream): Promise<StageResult> {
  const result: StageResult = { content: '', finish: null, reasoningTokens: 0, usage: {} }
  const reader = stream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) parseFrame(line, result)
    }
    for (const line of buffer.split('\n')) parseFrame(line, result)
  } catch (err) {
    if (!stream.abort.signal.aborted) throw err
  } finally {
    await reader.cancel().catch(() => {})
    stream.clearTimer()
  }
  if (stream.abort.signal.aborted) result.finish = 'timeout'
  return result
}

/**
 * Folds the attempts of one stage into one result. The text and finish reason come from
 * the attempt with the most text (a later attempt wins ties). Usage is summed over every
 * attempt, because a retry is billed too.
 */
function combineAttempts(attempts: StageResult[]): StageResult {
  let best = attempts[0]
  for (const attempt of attempts) {
    if (best && attempt.content.trim().length >= best.content.trim().length) best = attempt
  }
  if (!best) return { content: '', finish: 'timeout', reasoningTokens: 0, usage: {} }
  return {
    content: best.content,
    finish: best.finish,
    servedModel: best.servedModel ?? attempts.map(attempt => attempt.servedModel).find(Boolean),
    reasoningTokens: attempts.reduce((sum, attempt) => sum + attempt.reasoningTokens, 0),
    usage: sumUsage(attempts.map(attempt => attempt.usage)),
  }
}

/**
 * Runs one stage: at most two attempts, both on MODEL. A second attempt only starts
 * when at least MIN_RETRY_MS of the run budget is left. If a later attempt fails, the
 * text from the attempts that completed is kept.
 */
export async function runStage(agent: AgentConfig, userMessage: string, provider: Provider, deadline: number): Promise<StageResult> {
  const attempts: StageResult[] = []

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0 && deadline - Date.now() < MIN_RETRY_MS) break

    let stream: OpenStream
    try {
      stream = await openStream(agent, userMessage, provider, Math.min(agent.timeoutMs, deadline - Date.now()))
    } catch (err) {
      if (attempts.length > 0) break
      if (attempt === 0 && isRetryable(err)) {
        await delay(RETRY_DELAY_MS)
        continue
      }
      if (err instanceof AgentTimeoutError) break
      throw err
    }

    const result = await readAttempt(stream)
    attempts.push(result)
    if (!needsRetry(result)) break
  }

  return combineAttempts(attempts)
}
