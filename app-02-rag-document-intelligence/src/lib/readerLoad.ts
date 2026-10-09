export const READER_MESSAGE = 'The PDF reader could not load. Check your connection and try again.'

/** The PDF reader's script could not be downloaded. The message is safe to show. */
export class ReaderLoadError extends Error {
  constructor() {
    super(READER_MESSAGE)
    this.name = 'ReaderLoadError'
  }
}

/**
 * Downloads a file and gives up only when nothing arrives for `stallMs`, before the reply or
 * between chunks. A download that is slow but steady is left to finish.
 */
export async function fetchWithStallGuard(url: string, stallMs: number, type: string): Promise<Blob> {
  const watchdog = new AbortController()
  let timer = setTimeout(() => watchdog.abort(), stallMs)
  const rearm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => watchdog.abort(), stallMs)
  }
  try {
    const response = await fetch(url, { signal: watchdog.signal })
    rearm()
    if (!response.ok || !response.body) throw new ReaderLoadError()
    const reader = response.body.getReader()
    const parts: Uint8Array<ArrayBuffer>[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value as Uint8Array<ArrayBuffer>)
      rearm()
    }
    return new Blob(parts, { type })
  } catch (err) {
    throw err instanceof ReaderLoadError ? err : new ReaderLoadError()
  } finally {
    clearTimeout(timer)
  }
}
