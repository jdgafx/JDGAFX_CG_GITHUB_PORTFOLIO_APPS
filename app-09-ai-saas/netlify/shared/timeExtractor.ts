/**
 * Pulls the top-level "time" object out of a registry document while it streams, keeping nothing else. The documents of
 * busy packages are tens of megabytes (prisma 44 MB, drizzle-orm 65 MB) because every version carries its whole manifest;
 * the release dates are a few hundred kilobytes. Memory stays at one chunk plus the time object.
 */
export class TimeExtractor {
  private depth = 0
  private inString = false
  private escaped = false
  private expectKey = false
  private collectKey = false
  private keyText = ''
  private lastKey = ''
  private capturing = false
  private captured = ''
  /** True once the whole time object has been read; nothing after it matters. */
  done = false

  push(chunk: string): void {
    for (let i = 0; i < chunk.length && !this.done; i++) {
      const c = chunk.charCodeAt(i)
      if (this.inString) {
        if (this.capturing) this.captured += chunk[i]
        if (this.collectKey) this.keyText += chunk[i]
        if (this.escaped) this.escaped = false
        else if (c === 92) this.escaped = true
        else if (c === 34) {
          this.inString = false
          if (this.collectKey) {
            this.lastKey = this.keyText.slice(0, -1)
            this.collectKey = false
          }
        }
        continue
      }
      if (c === 34) {
        this.inString = true
        this.collectKey = this.depth === 1 && this.expectKey && !this.capturing
        this.keyText = ''
        if (this.capturing) this.captured += '"'
      } else if (c === 123) {
        this.depth++
        if (!this.capturing && this.depth === 2 && this.lastKey === 'time' && !this.expectKey) {
          this.capturing = true
          this.captured = '{'
        } else if (this.capturing) this.captured += '{'
        if (this.depth === 1) this.expectKey = true
      } else if (c === 91) {
        this.depth++
        if (this.capturing) this.captured += '['
      } else if (c === 125 || c === 93) {
        if (this.capturing) {
          this.captured += chunk[i]
          if (c === 125 && this.depth === 2) {
            this.capturing = false
            this.done = true
          }
        }
        this.depth--
      } else {
        if (c === 58 && this.depth === 1) this.expectKey = false
        else if (c === 44 && this.depth === 1) this.expectKey = true
        if (this.capturing) this.captured += chunk[i]
      }
    }
  }

  /** The time object as parsed JSON, or null when the document had none. */
  result(): Record<string, unknown> | null {
    if (!this.done) return null
    try {
      const value: unknown = JSON.parse(this.captured)
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
}

export class TooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`The registry record is larger than the ${Math.round(limit / 1e6)} MB this service reads.`)
    this.name = 'TooLargeError'
  }
}

/** Streams a response body through a TimeExtractor, stopping at the end of the time object. Throws TooLargeError past `maxBytes`. */
export async function readTime(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Record<string, unknown> | null> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const extractor = new TimeExtractor()
  let bytes = 0
  try {
    while (!extractor.done) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new TooLargeError(maxBytes)
      extractor.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return extractor.result()
}
