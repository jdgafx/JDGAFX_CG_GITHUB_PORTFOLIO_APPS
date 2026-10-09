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
 * The run stops itself at 23 s plus a 1 s grace. The client waits 30 s for any byte, and 60 s in all: the
 * idle timer catches a real stall, and the generous overall cap keeps a slow but healthy stream from being cut
 * (two correct runs finished at 32.7 s on a lossy network).
 */
export const IDLE_TIMEOUT_MS = 30_000
export const OVERALL_TIMEOUT_MS = 60_000
export const STALLED = 'The connection stopped answering. No summary was written. Analyze again to retry.'

/**
 * POSTs the text to /api/run and hands each frame to onFrame as it arrives. A refused start (validation,
 * rate limit, missing service) rejects with the server's plain message. A connection that fails at any
 * point rejects with the plain unreachable message. A watchdog ends a stream that goes quiet for
 * IDLE_TIMEOUT_MS, or that runs past OVERALL_TIMEOUT_MS, with the stalled message. The caller's own abort
 * (the Stop button) is not a stall: the caller sees it as its own abort.
 */
export async function runAnalysis(text: string, onFrame: (frame: Frame) => void, signal: AbortSignal): Promise<void> {
  const request = new AbortController()
  const forward = (): void => request.abort()
  signal.addEventListener('abort', forward, { once: true })
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let overallTimer: ReturnType<typeof setTimeout> | undefined
  let touch = (): void => undefined
  // The watchdog is raced against the whole run, so it works even if fetch or the reader ignores the abort.
  const watchdog = new Promise<never>((_resolve, reject) => {
    const trip = (): void => {
      request.abort()
      reject(new Error(STALLED))
    }
    touch = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(trip, IDLE_TIMEOUT_MS)
    }
    overallTimer = setTimeout(trip, OVERALL_TIMEOUT_MS)
  })
  watchdog.catch(() => undefined)
  touch()

  const run = async (): Promise<void> => {
    let response: Response
    try {
      response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: request.signal,
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
      touch()
      const feed = parser.feed(decoder.decode(value, { stream: true }))
      for (const frame of feed.frames) onFrame(frame)
      if (feed.finished) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
  }

  try {
    await Promise.race([run(), watchdog])
  } finally {
    clearTimeout(idleTimer)
    clearTimeout(overallTimer)
    signal.removeEventListener('abort', forward)
  }
}
