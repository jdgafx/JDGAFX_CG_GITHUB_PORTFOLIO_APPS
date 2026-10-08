import type { Frame } from '../types/frames'
import { createSseParser } from './sse'

const GENERIC_START_FAILURE = 'The run could not start. Please try again.'
const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'

async function startFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return body.error
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return GENERIC_START_FAILURE
}

/** Reads the next piece of the stream. A broken read gets the plain message, never the browser's raw error text. */
async function readNext(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await reader.read()
  } catch {
    throw new Error(UNREACHABLE)
  }
}

/**
 * POSTs the text to /api/run and hands each frame to onFrame as it arrives. A refused start (validation,
 * rate limit, missing service) rejects with the server's plain message. A connection that fails at any
 * point rejects with the plain unreachable message.
 */
export async function runAnalysis(text: string, onFrame: (frame: Frame) => void, signal: AbortSignal): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    })
  } catch {
    throw new Error(UNREACHABLE)
  }
  if (!response.ok || !response.body) throw new Error(await startFailure(response))

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  for (;;) {
    const { value, done } = await readNext(reader)
    if (done) break
    const feed = parser.feed(decoder.decode(value, { stream: true }))
    for (const frame of feed.frames) onFrame(frame)
    if (feed.finished) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
}
