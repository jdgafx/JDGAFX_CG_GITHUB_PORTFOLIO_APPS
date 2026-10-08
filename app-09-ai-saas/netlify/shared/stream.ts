/** Token and cost figures the provider reports on its final chunk. A missing field was not reported. */
interface ProviderUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
}

/**
 * What one provider stream produced. A stream is finished when it sent [DONE] or a finish reason.
 * providerError is the status code the stream reported, if any.
 */
export interface ProviderAnswer {
  text: string
  chunks: number
  finishReason: string | null
  model: string | null
  usage: ProviderUsage | null
  providerError: number | null
  done: boolean
}

export type Emit = (frame: object) => void

interface ChunkFrame {
  model?: string
  usage?: Record<string, unknown>
  choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[]
  error?: { code?: unknown }
}

export const DONE_FRAME = 'data: [DONE]\n\n'

const DATA_PREFIX = 'data: '
const USAGE_KEYS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const

/** One SSE data frame for the browser. */
export function encodeFrame(frame: object): string {
  return `${DATA_PREFIX}${JSON.stringify(frame)}\n\n`
}

function pickUsage(raw: Record<string, unknown>): ProviderUsage {
  const usage: ProviderUsage = {}
  for (const key of USAGE_KEYS) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value
  }
  return usage
}

/**
 * Reads the provider's SSE stream and forwards each text delta through emit as it arrives.
 * A frame cut in half at a network boundary is skipped. When signal aborts, the body is cancelled
 * and the answer so far is returned, so a stream that never closes cannot outlast the run's deadline.
 */
export async function readProviderStream(
  body: ReadableStream<Uint8Array>,
  emit: Emit,
  signal: AbortSignal,
): Promise<ProviderAnswer> {
  const answer: ProviderAnswer = {
    text: '',
    chunks: 0,
    finishReason: null,
    model: null,
    usage: null,
    providerError: null,
    done: false,
  }

  const readLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith(DATA_PREFIX)) return
    const data = trimmed.slice(DATA_PREFIX.length)
    if (data === '[DONE]') {
      answer.done = true
      return
    }

    let frame: ChunkFrame
    try {
      frame = (JSON.parse(data) as ChunkFrame | null) ?? {}
    } catch {
      return
    }

    if (frame.error) {
      answer.providerError = Number(frame.error.code) || 502
      return
    }
    if (frame.model) answer.model = frame.model
    if (frame.usage) answer.usage = pickUsage(frame.usage)
    const choice = Array.isArray(frame.choices) ? frame.choices[0] : undefined
    if (choice?.finish_reason) answer.finishReason = choice.finish_reason

    const delta = choice?.delta?.content
    if (typeof delta !== 'string' || delta === '') return
    if (answer.chunks === 0) emit({ stage: 'streaming' })
    answer.chunks += 1
    answer.text += delta
    emit({ text: delta })
  }

  const reader = body.getReader()
  const cancel = () => {
    reader.cancel().catch(() => {})
  }
  if (signal.aborted) cancel()
  signal.addEventListener('abort', cancel, { once: true })

  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) readLine(line)
    }
    for (const line of (buffer + decoder.decode()).split('\n')) readLine(line)
  } finally {
    signal.removeEventListener('abort', cancel)
  }
  return answer
}
