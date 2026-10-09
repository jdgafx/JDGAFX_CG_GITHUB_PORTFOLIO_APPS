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

/** How long the page waits on the server: for the next byte, and for the whole run. The server's own budget is 25 s and it closes a hung stream at 27 s, so the 60 s cap covers a slow network, not a slow server. */
export const WATCHDOG = { idleMs: 30_000, totalMs: 60_000 }
/** The page adds "Press Start research to try again." under every error, so the message does not repeat it. */
export const STALLED_MESSAGE = 'The server stopped responding.'

/** What a request sends. A new run sends the question; a rewind sends the saved state's token and the edit. */
export type RunRequest = { path: '/api/run'; body: { question: string } } | { path: '/api/resume'; body: { token: string; edit: unknown } }

async function readRun(
  request: RunRequest,
  signal: AbortSignal,
  onFrame: (frame: Frame) => void,
  onBytes: () => void,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(request.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal,
    })
  } catch {
    if (signal.aborted) return
    throw new Error(NETWORK_MESSAGE)
  }
  onBytes()
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
      onBytes()
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

/**
 * Posts one question and passes each frame to `onFrame` as it arrives. Resolves when the
 * stream ends. Rejects with a plain message when the request is refused or breaks off.
 * A watchdog ends a request that sends no byte for `idleMs`, or runs past `totalMs`, with a message
 * that says the server stopped responding. A stop by the visitor ends it quietly.
 */
export async function streamRequest(
  request: RunRequest,
  signal: AbortSignal,
  onFrame: (frame: Frame) => void,
  limits: { idleMs: number; totalMs: number } = WATCHDOG,
): Promise<void> {
  const watched = new AbortController()
  let giveUp: () => void = () => undefined
  let stopQuietly: () => void = () => undefined
  // Settles the wait even if a fetch or a read ignores its signal: with the message on a stall, with nothing on a Stop.
  const cutOff = new Promise<void>((resolve, reject) => {
    stopQuietly = resolve
    giveUp = () => {
      watched.abort()
      if (!signal.aborted) reject(new Error(STALLED_MESSAGE))
    }
  })
  const onVisitorStop = () => {
    watched.abort()
    stopQuietly()
  }
  if (signal.aborted) watched.abort()
  else signal.addEventListener('abort', onVisitorStop, { once: true })

  let idle = setTimeout(giveUp, limits.idleMs)
  const total = setTimeout(giveUp, limits.totalMs)
  const onBytes = () => {
    clearTimeout(idle)
    idle = setTimeout(giveUp, limits.idleMs)
  }
  try {
    await Promise.race([readRun(request, watched.signal, onFrame, onBytes), cutOff])
  } finally {
    clearTimeout(idle)
    clearTimeout(total)
    signal.removeEventListener('abort', onVisitorStop)
  }
}

/** Posts one question. See `streamRequest`. */
export const streamResearch = (
  question: string,
  signal: AbortSignal,
  onFrame: (frame: Frame) => void,
  limits?: { idleMs: number; totalMs: number },
) => streamRequest({ path: '/api/run', body: { question } }, signal, onFrame, limits)

/** Rewinds to a saved point with an edit and runs on from there. See `streamRequest`. */
export const streamResume = (
  token: string,
  edit: unknown,
  signal: AbortSignal,
  onFrame: (frame: Frame) => void,
  limits?: { idleMs: number; totalMs: number },
) => streamRequest({ path: '/api/resume', body: { token, edit } }, signal, onFrame, limits)
