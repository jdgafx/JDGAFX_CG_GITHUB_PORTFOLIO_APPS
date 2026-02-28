import type { SummaryStats } from './mockData'

let activeController: AbortController | null = null

export async function getInsights(
  metrics: SummaryStats,
  onChunk: (text: string) => void,
): Promise<void> {
  // Cancel any in-flight request before starting a new one
  if (activeController) {
    activeController.abort()
    activeController = null
  }

  const controller = new AbortController()
  activeController = controller

  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metrics }),
    signal: controller.signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Request failed (${response.status}): ${text || 'Unknown error'}`)
  }

  if (!response.body) {
    throw new Error('No response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
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
            const parsed = JSON.parse(data) as { text?: string; error?: string }
            if (parsed.error) throw new Error(parsed.error)
            if (parsed.text) onChunk(parsed.text)
          } catch (e) {
            if (e instanceof Error && e.message) throw e
            void 0
          }
        }
      }
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      const line = buffer.trim()
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string }
            if (parsed.error) throw new Error(parsed.error)
            if (parsed.text) onChunk(parsed.text)
          } catch (e) {
            if (e instanceof Error && e.message) throw e
            void 0
          }
        }
      }
    }
  } finally {
    if (activeController === controller) {
      activeController = null
    }
  }
}
