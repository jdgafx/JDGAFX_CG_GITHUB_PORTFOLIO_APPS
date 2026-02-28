import type { StreamEvent } from '../types'

const API_URL = '/.netlify/functions/ai'

/** Timeout for the initial connection (15s) */
const CONNECT_TIMEOUT_MS = 15_000

/** Timeout between SSE chunks — if no data arrives for 60s, assume the connection is dead */
const READ_TIMEOUT_MS = 60_000

function processSSELines(
  lines: string[],
  onEvent: (event: StreamEvent) => void,
): boolean {
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim()
      if (data === '[DONE]') return true
      try {
        const event: StreamEvent = JSON.parse(data)
        onEvent(event)
      } catch {
        /* intentional: malformed SSE frames are non-fatal */
      }
    }
  }
  return false
}

export async function startResearch(
  query: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const connectController = new AbortController()
  const connectTimer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS)

  // Combine caller signal with connect timeout
  const onCallerAbort = () => connectController.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })

  let response: Response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: connectController.signal,
    })
  } catch (err) {
    if (connectController.signal.aborted && !signal?.aborted) {
      throw new Error('Connection timed out. The server took too long to respond.')
    }
    throw err
  } finally {
    clearTimeout(connectTimer)
    signal?.removeEventListener('abort', onCallerAbort)
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Research failed: ${error}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response stream')

  const decoder = new TextDecoder()
  let buffer = ''
  let readTimer: ReturnType<typeof setTimeout> | null = null

  const clearReadTimer = () => {
    if (readTimer !== null) {
      clearTimeout(readTimer)
      readTimer = null
    }
  }

  // Abort on caller signal during reading
  const onAbortDuringRead = () => {
    clearReadTimer()
    reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', onAbortDuringRead, { once: true })

  try {
    while (true) {
      // Set per-chunk read timeout
      const readPromise = reader.read()
      const timeoutPromise = new Promise<never>((_, reject) => {
        readTimer = setTimeout(
          () => reject(new Error('Stream read timed out. The server stopped sending data.')),
          READ_TIMEOUT_MS,
        )
      })

      const { done, value } = await Promise.race([readPromise, timeoutPromise])
      clearReadTimer()

      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      if (processSSELines(lines, onEvent)) return
    }

    // Process any remaining data in the buffer after stream ends
    if (buffer.trim()) {
      const remainingLines = buffer.split('\n')
      processSSELines(remainingLines, onEvent)
    }
  } finally {
    clearReadTimer()
    signal?.removeEventListener('abort', onAbortDuringRead)
  }
}
