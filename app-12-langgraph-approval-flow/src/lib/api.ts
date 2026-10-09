import type { StreamEvent } from '../../netlify/shared/events'
import type { HumanDecision, ThreadEntry, ThreadView } from '../types'

/** The server must start answering within 15 s. */
const CONNECT_TIMEOUT_MS = 15_000
/** No bytes for 60 s means the connection is dead. */
const READ_TIMEOUT_MS = 60_000

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.'
const STALLED = 'The server stopped sending data. Try again.'
const NOT_A_RUN = 'The server did not start a run. Check that the site functions are deployed.'
const GENERIC = 'The run stopped unexpectedly. Try again.'

/** A failure whose message is written for the visitor. Only these messages are shown as they are. */
export class RequestFailure extends Error {
  /**
   * `status` is the HTTP status when the server answered. `connection` is true when no answer
   * came at all: the network failed or the server did not respond in time. A stream that breaks after
   * the server answered is not a connection failure.
   */
  constructor(
    message: string,
    readonly status?: number,
    readonly connection = false,
  ) {
    super(message)
    this.name = 'RequestFailure'
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/** The text to show for a failed request. Anything that is not a RequestFailure stays off the screen. */
export function failureText(err: unknown): string {
  return err instanceof RequestFailure ? err.message : GENERIC
}

export interface ThreadsResponse {
  success: boolean
  storage: 'blobs' | 'memory'
  notice: string | null
  threads: ThreadEntry[]
}

export type ThreadResponse = ThreadView & { success: boolean }

function isEvent(value: unknown): value is StreamEvent {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

/** One data line as an event, or undefined when it is not JSON with a type. A bad frame is skipped. */
function parseEvent(data: string): StreamEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(data)
    return isEvent(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
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
  const stalled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RequestFailure(STALLED)), READ_TIMEOUT_MS)
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
    for (;;) {
      const { done, value } = await readWithTimeout(reader)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      if (processSSELines(lines, onEvent)) return
    }
    processSSELines(buffer.split('\n'), onEvent)
  } catch (err) {
    if (err instanceof RequestFailure || isAbortError(err)) throw err
    throw new RequestFailure(UNREACHABLE)
  } finally {
    signal?.removeEventListener('abort', onStop)
  }
}

/** The server's plain-language error field, when the body has one. Raw bodies are never shown. */
function messageOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error.trim().slice(0, 200) : undefined
}

async function failureFrom(response: Response): Promise<RequestFailure> {
  const body: unknown = await response.json().catch(() => null)
  const fallback =
    response.status === 429 ? 'Rate limited, try again in a minute.' : 'The server could not start the run. Try again.'
  return new RequestFailure(messageOf(body) ?? fallback, response.status)
}

/**
 * POSTs one JSON body and feeds each event of the server-sent answer to onEvent. Resolves when the
 * stream ends. Rejects with a RequestFailure (safe to show) or an AbortError when the visitor stops it.
 */
async function streamFrom(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const connect = new AbortController()
  const timer = setTimeout(() => connect.abort(), CONNECT_TIMEOUT_MS)
  const cancelConnect = () => connect.abort()
  signal?.addEventListener('abort', cancelConnect, { once: true })

  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: connect.signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    if (connect.signal.aborted) throw new RequestFailure('The server took too long to answer. Try again.', undefined, true)
    throw new RequestFailure(UNREACHABLE, undefined, true)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancelConnect)
  }

  if (!response.ok) throw await failureFrom(response)
  // A path typo can land on the page's HTML fallback with a 200. That must not read as an empty run.
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    throw new RequestFailure(NOT_A_RUN)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new RequestFailure(NOT_A_RUN)
  await readEvents(reader, onEvent, signal)
}

export function startTicket(ticket: string, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
  return streamFrom('/api/start', { ticket }, onEvent, signal)
}

export function resumeThread(
  threadId: string,
  decision: HumanDecision,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamFrom('/api/resume', { threadId, decision }, onEvent, signal)
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' }, signal })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new RequestFailure(UNREACHABLE, undefined, true)
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new RequestFailure(messageOf(body) ?? 'The server could not answer. Try again.', response.status)
  return body as T
}

export function fetchThreads(signal?: AbortSignal): Promise<ThreadsResponse> {
  return getJson<ThreadsResponse>('/api/threads', signal)
}

export async function fetchThread(threadId: string, signal?: AbortSignal): Promise<ThreadResponse> {
  const view = await getJson<ThreadResponse>(`/api/thread?id=${encodeURIComponent(threadId)}`, signal)
  // The ticket fills the form, so it is checked here instead of trusted.
  if (typeof (view as { ticket?: unknown } | null)?.ticket !== 'string') {
    throw new RequestFailure('The server sent a thread the page could not read. Try again.')
  }
  return view
}
