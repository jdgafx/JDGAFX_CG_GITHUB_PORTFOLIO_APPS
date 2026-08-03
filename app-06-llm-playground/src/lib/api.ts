export interface TextChunk {
  type: 'text'
  text: string
}

export interface DoneChunk {
  type: 'done'
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  /** Authoritative USD cost reported by the provider; null when unavailable. */
  cost?: number | null
  /** Model id that actually served the request, resolved from the alias. */
  servedModel?: string | null
  /** True when the server hit its time budget before the model finished. */
  truncated?: boolean
}

export interface ErrorChunk {
  type: 'error'
  message: string
}

export type StreamChunk = TextChunk | DoneChunk | ErrorChunk

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface StreamOptions {
  temperature?: number
  max_tokens?: number
}

const CONNECTION_LOST = 'Connection lost before the model finished responding.'

export async function streamModel(
  model: string,
  messages: Message[],
  system: string | undefined,
  options: StreamOptions,
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      system,
      max_tokens: options.max_tokens ?? 1024,
      temperature: options.temperature ?? 0.7,
    }),
    signal,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }

  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawTerminal = false

  const processLines = (lines: string[]) => {
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data) as StreamChunk
        if (parsed.type === 'done' || parsed.type === 'error') sawTerminal = true
        onChunk(parsed)
      } catch (err) {
        console.warn('Skipping malformed SSE line', (err as Error).message, trimmed)
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      processLines(lines)
    }
  } catch (err) {
    // A user-initiated abort is not a failure -- let the caller handle it.
    if (signal?.aborted) throw err
    onChunk({ type: 'error', message: CONNECTION_LOST })
    return
  }

  // Process any remaining data in the buffer after the stream ends
  if (buffer.trim()) {
    processLines([buffer])
  }

  // A stream that ends without done/error means the connection dropped
  // mid-generation -- surface it rather than leaving the panel spinning.
  if (!sawTerminal) {
    onChunk({ type: 'error', message: CONNECTION_LOST })
  }
}
