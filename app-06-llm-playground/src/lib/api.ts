export interface TextChunk {
  type: 'text'
  text: string
}

export interface DoneChunk {
  type: 'done'
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
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

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data) as StreamChunk
        onChunk(parsed)
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}
