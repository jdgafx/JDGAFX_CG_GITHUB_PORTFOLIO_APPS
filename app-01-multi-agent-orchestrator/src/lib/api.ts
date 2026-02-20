import type { StreamEvent } from '../types'

const API_URL = '/.netlify/functions/ai'

export async function startResearch(
  query: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Research failed: ${error}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response stream')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const event: StreamEvent = JSON.parse(data)
          onEvent(event)
        } catch {
          /* intentional: malformed SSE frames are non-fatal */
        }
      }
    }
  }
}
