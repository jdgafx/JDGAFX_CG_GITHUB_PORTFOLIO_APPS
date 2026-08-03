import { encodeForUpload } from './audio'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

// What the UI stores: the wire shape plus a stable key for list rendering.
export interface ChatMessage extends Message {
  id: string
}

// Fallbacks for the cases where the function did not return JSON at all (edge
// timeout, proxy error page). Anything the function does send is already
// user-safe — it never carries vendor error text.
function statusFallback(status: number, subject: string): string {
  if (status === 413) return 'That recording is too long to send. Try a shorter one.'
  if (status === 429) return `${subject} is busy right now. Wait a moment and try again.`
  if (status === 403) return `${subject} rejected this request.`
  if (status >= 500) return `${subject} is unavailable right now. Try again in a moment.`
  return `${subject} failed. Try again.`
}

async function readError(res: Response, subject: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown }
    if (typeof data.error === 'string' && data.error.trim()) return data.error
  } catch {
    // Response wasn't JSON — fall through to the status-based message.
  }
  return statusFallback(res.status, subject)
}

export async function transcribe(blob: Blob, signal?: AbortSignal): Promise<string> {
  const { data, format } = await encodeForUpload(blob)

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: data, format }),
    signal,
  })

  if (!res.ok) throw new Error(await readError(res, 'Transcription'))

  const payload = (await res.json()) as { text?: unknown }
  return typeof payload.text === 'string' ? payload.text : ''
}

export async function chat(
  message: string,
  history: Message[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
    signal,
  })

  if (!res.ok) throw new Error(await readError(res, 'The assistant'))

  const data = (await res.json()) as { response?: unknown }
  if (typeof data.response !== 'string' || !data.response.trim()) {
    throw new Error('The assistant returned an empty response. Try again.')
  }
  return data.response
}
