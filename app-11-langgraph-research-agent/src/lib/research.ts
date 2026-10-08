import type { Frame } from '../../netlify/shared/events'
import { createSseParser } from './sse'

export const NETWORK_MESSAGE = 'Could not reach the server. Check your connection and try again.'
export const INTERRUPTED_MESSAGE = 'The answer stream was interrupted before the run finished.'

function parseFrame(data: string): Frame {
  const value: unknown = JSON.parse(data)
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error(INTERRUPTED_MESSAGE)
  }
  return value as Frame
}

async function refusalMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // The body was not JSON. The status line below says what happened.
  }
  return `The server could not start the run (HTTP ${response.status}).`
}

/**
 * Posts one question and passes each frame to `onFrame` as it arrives. Resolves when the
 * stream ends. Rejects with a plain message when the request is refused or breaks off.
 */
export async function streamResearch(
  question: string,
  signal: AbortSignal,
  onFrame: (frame: Frame) => void,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal,
    })
  } catch {
    if (signal.aborted) return
    throw new Error(NETWORK_MESSAGE)
  }
  if (!response.ok) throw new Error(await refusalMessage(response))
  if (!response.body) throw new Error(INTERRUPTED_MESSAGE)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let sawDone = false
  const parser = createSseParser((data) => {
    if (data === '[DONE]') {
      sawDone = true
      return
    }
    onFrame(parseFrame(data))
  })

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.flush()
  } catch {
    if (signal.aborted) return
    throw new Error(INTERRUPTED_MESSAGE)
  }
  if (!sawDone && !signal.aborted) throw new Error(INTERRUPTED_MESSAGE)
}
