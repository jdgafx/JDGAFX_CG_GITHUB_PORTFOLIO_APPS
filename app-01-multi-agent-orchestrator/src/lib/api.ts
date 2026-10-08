import type { StreamEvent } from '../types'

const API_URL = '/.netlify/functions/ai'

/** The server must answer the request within 15 s. */
const CONNECT_TIMEOUT_MS = 15_000
/** No bytes for 60 s means the connection is dead. */
const READ_TIMEOUT_MS = 60_000

const UNREACHABLE_MESSAGE = 'Could not reach the server. Check your connection and try again.'
const STALLED_MESSAGE = 'The server stopped sending data. Try again.'
const GENERIC_FAILURE = 'The run stopped unexpectedly. Try again.'

/** A failure whose message was written for the visitor. Only these messages are shown as they are. */
export class ResearchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ResearchError'
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/** The text to show for a failed run. Anything that is not a ResearchError stays off the screen. */
export function runErrorMessage(err: unknown): string {
  return err instanceof ResearchError ? err.message : GENERIC_FAILURE
}

/** The server's plain-language `error` field when the body has one. Raw bodies are never shown. */
function serverMessage(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
      const message = parsed.error.trim()
      if (message) return message.slice(0, 200)
    }
  } catch {
    /* not JSON: the fixed message below is used */
  }
  return undefined
}

async function responseFailure(response: Response): Promise<ResearchError> {
  const body = await response.text().catch(() => '')
  const fallback =
    response.status === 429 ? 'Rate limited, try again in a minute.' : 'The server could not start the run. Try again.'
  return new ResearchError(serverMessage(body) ?? fallback)
}

/** A typed event, or undefined for a frame that is not JSON with a `type`. */
function parseEvent(data: string): StreamEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(data)
    if (parsed && typeof parsed === 'object' && 'type' in parsed && typeof parsed.type === 'string') {
      return parsed as StreamEvent
    }
  } catch {
    /* a malformed frame is skipped; the run continues */
  }
  return undefined
}

/** Handles the complete lines of one read. Returns true when the server sends its end marker. */
export function processSSELines(lines: string[], onEvent: (event: StreamEvent) => void): boolean {
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') return true
    const event = parseEvent(data)
    if (event) onEvent(event)
  }
  return false
}

/** One read, abandoned after READ_TIMEOUT_MS of silence. The stalled read is cancelled, not left pending. */
async function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  const read = reader.read()
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ResearchError(STALLED_MESSAGE)), READ_TIMEOUT_MS)
  })
  try {
    return await Promise.race([read, stalled])
  } catch (err) {
    void read.catch(() => {})
    void reader.cancel().catch(() => {})
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Reads the event stream to its end, or until the visitor stops the run. */
async function readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const onStop = () => void reader.cancel().catch(() => {})
  signal?.addEventListener('abort', onStop, { once: true })
  if (signal?.aborted) onStop()

  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await readWithTimeout(reader)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      if (processSSELines(lines, onEvent)) return
    }
    processSSELines(buffer.split('\n'), onEvent)
  } catch (err) {
    if (err instanceof ResearchError || isAbortError(err)) throw err
    throw new ResearchError(UNREACHABLE_MESSAGE, { cause: err })
  } finally {
    signal?.removeEventListener('abort', onStop)
  }
}

/**
 * Starts one run and feeds each server event to onEvent. Resolves when the stream ends.
 * Rejects with a ResearchError (safe to show) or an AbortError when the visitor stops it.
 */
export async function startResearch(
  query: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const connectController = new AbortController()
  const connectTimer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS)
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
    if (signal?.aborted) throw err
    if (connectController.signal.aborted) {
      throw new ResearchError('Connection timed out. The server took too long to respond.', { cause: err })
    }
    throw new ResearchError(UNREACHABLE_MESSAGE, { cause: err })
  } finally {
    clearTimeout(connectTimer)
    signal?.removeEventListener('abort', onCallerAbort)
  }

  if (!response.ok) throw await responseFailure(response)

  // A path typo lands on the SPA fallback, which returns HTML with a 200. Without
  // this check that HTML gets parsed as SSE and the run just silently does nothing.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    throw new ResearchError('The research endpoint is not responding correctly. Check that the site functions are deployed.')
  }

  const reader = response.body?.getReader()
  if (!reader) throw new ResearchError('The server sent no result stream. Try again.')
  await readEvents(reader, onEvent, signal)
}
