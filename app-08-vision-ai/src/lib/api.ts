export type AnalysisMode = 'describe' | 'analyze' | 'qa' | 'extract'

export const MAX_FILE_SIZE = 4 * 1024 * 1024 // 4MB
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const ACCEPTED_LABEL = 'JPG, PNG, WebP, or GIF'

// Generous enough for an 8192-token extraction, short enough that a wedged
// request cannot hang the UI indefinitely.
const REQUEST_TIMEOUT_MS = 60_000

const STREAM_DROPPED_MESSAGE =
  'The connection dropped before the analysis finished. The result above may be incomplete.'

export const CANCELLED_ERROR = 'AnalysisCancelled'
export const TIMEOUT_ERROR = 'AnalysisTimeout'

export function isCancellation(error: Error): boolean {
  return error.name === CANCELLED_ERROR
}

export interface AnalyzeOptions {
  file: File
  mode: AnalysisMode
  question?: string
  signal?: AbortSignal
  onChunk: (text: string) => void
  onComplete: () => void
  onError: (error: Error) => void
  onTruncated?: () => void
}

interface Base64Result {
  data: string
  mediaType: string
}

export function fileToBase64(file: File): Promise<Base64Result> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result type'))
        return
      }
      const commaIndex = result.indexOf(',')
      if (commaIndex === -1) {
        reject(new Error('Malformed data URL'))
        return
      }
      const header = result.slice(0, commaIndex)
      const data = result.slice(commaIndex + 1)
      const mediaType = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg'
      resolve({ data, mediaType })
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function named(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

async function errorMessageFor(res: Response): Promise<string> {
  try {
    const parsed = (await res.json()) as { error?: unknown }
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error
  } catch {
    // Fall through to the generic message below.
  }
  return `Analysis failed (${res.status}). Please try again.`
}

export async function analyzeImage(opts: AnalyzeOptions): Promise<void> {
  const { file, mode, question, signal, onChunk, onComplete, onError, onTruncated } = opts

  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortFromCaller, { once: true })
  }

  try {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      throw new Error(
        `Unsupported image format: ${file.type || 'unknown'}. Use ${ACCEPTED_LABEL}.`,
      )
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('Image is too large. Please use an image under 4MB.')
    }

    const { data, mediaType } = await fileToBase64(file)

    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ image: data, mediaType, mode, question }),
    })

    if (!res.ok) throw new Error(await errorMessageFor(res))
    if (!res.body) throw new Error('The server returned an empty response.')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sawDone = false

    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (err) {
        // A socket that dies mid-stream throws a bare "network error"; say
        // something the user can act on instead.
        if (err instanceof Error && err.name === 'AbortError') throw err
        throw new Error(STREAM_DROPPED_MESSAGE)
      }
      const { done, value } = chunk
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') {
          sawDone = true
          continue
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (typeof parsed === 'object' && parsed !== null) {
          const obj = parsed as Record<string, unknown>
          if (typeof obj['text'] === 'string') onChunk(obj['text'])
          if (obj['truncated'] === true) onTruncated?.()
          if (typeof obj['error'] === 'string') throw new Error(obj['error'])
        }
      }
    }

    // No terminator means the connection dropped mid-analysis. Treat the result
    // as incomplete rather than silently accepting a partial answer.
    if (!sawDone) throw new Error(STREAM_DROPPED_MESSAGE)

    onComplete()
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (isAbort && timedOut) {
      onError(named(TIMEOUT_ERROR, 'The analysis timed out. Try again, or use a smaller image.'))
    } else if (isAbort) {
      onError(named(CANCELLED_ERROR, 'Analysis cancelled.'))
    } else {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}
