import type { SummaryStats } from './mockData'

const INSIGHTS_ENDPOINT = '/api/ai'
const SSE_PREFIX = 'data: '
const SSE_TERMINATOR = '[DONE]'

let activeController: AbortController | null = null

/** Cancel the in-flight insights stream, if any. Safe to call when nothing is running. */
export function abortInsights(): void {
  activeController?.abort()
  activeController = null
}

/** True when a rejection came from abortInsights() rather than a real failure. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * Handle one SSE line. Returns true once the terminator is seen.
 * Malformed JSON is a truncated frame, not a failure — skip it and keep reading.
 */
function consumeSseLine(line: string, onChunk: (text: string) => void): boolean {
  if (!line.startsWith(SSE_PREFIX)) return false

  const data = line.slice(SSE_PREFIX.length).trim()
  if (data === SSE_TERMINATOR) return true

  let parsed: { text?: string; error?: string }
  try {
    parsed = JSON.parse(data) as typeof parsed
  } catch (e) {
    if (e instanceof SyntaxError) return false
    throw e
  }

  if (parsed.error) throw new Error(parsed.error)
  if (parsed.text) onChunk(parsed.text)
  return false
}

export async function getInsights(
  metrics: SummaryStats,
  onChunk: (text: string) => void,
): Promise<void> {
  // Cancel any in-flight request before starting a new one
  abortInsights()

  const controller = new AbortController()
  activeController = controller

  try {
    const response = await fetch(INSIGHTS_ENDPOINT, {
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
          if (consumeSseLine(line.trim(), onChunk)) return
        }
      }

      // Process any trailing frame left in the buffer
      if (buffer.trim()) consumeSseLine(buffer.trim(), onChunk)
    } finally {
      await reader.cancel().catch(() => {})
    }
  } finally {
    if (activeController === controller) {
      activeController = null
    }
  }
}
