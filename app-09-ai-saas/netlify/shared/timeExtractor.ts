// The registry document of a busy package is tens of megabytes (drizzle-orm: 64.7 MB). Parsing it whole peaked at
// about 465 MB of memory, so this reads the body as a stream and keeps only the top-level `time` object.

/** Which part of the document the scanner is in, for finding a top-level key without parsing the rest. */
interface Scan {
  depth: number
  inString: boolean
  escaped: boolean
  rootIsObject: boolean
  expectKey: boolean
  /** The key being read, or null when the string being read is not a top-level key. */
  keyBuf: string | null
  lastKey: string
  capturing: boolean
  captured: string
}

/** Feeds one decoded chunk. Gives the finished `time` text once its closing brace is seen, else null. */
function feed(scan: Scan, text: string): string | null {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i)
    if (scan.capturing) scan.captured += c
    if (scan.inString) {
      if (scan.escaped) scan.escaped = false
      else if (c === '\\') scan.escaped = true
      else if (c === '"') {
        scan.inString = false
        if (scan.keyBuf !== null) {
          scan.lastKey = scan.keyBuf
          scan.keyBuf = null
          scan.expectKey = false
        }
        continue
      }
      if (scan.keyBuf !== null) scan.keyBuf += c
      continue
    }
    if (c === '"') {
      scan.inString = true
      if (scan.depth === 1 && scan.rootIsObject && scan.expectKey) scan.keyBuf = ''
    } else if (c === '{' || c === '[') {
      scan.depth += 1
      if (scan.depth === 1) {
        scan.rootIsObject = c === '{'
        scan.expectKey = scan.rootIsObject
      } else if (scan.depth === 2 && c === '{' && scan.lastKey === 'time' && !scan.capturing) {
        scan.capturing = true
        scan.captured = '{'
      }
    } else if (c === '}' || c === ']') {
      scan.depth -= 1
      if (scan.capturing && scan.depth === 1) return scan.captured
    } else if (c === ',' && scan.depth === 1 && scan.rootIsObject) {
      scan.expectKey = true
    }
  }
  return null
}

/**
 * Reads the document's top-level `time` object from a stream and stops reading once it is complete. Null when
 * the document has no `time` object. Throws when the body passes `maxBytes`, ends inside `time`, or `time` is not JSON.
 */
export async function readTime(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Record<string, unknown> | null> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const scan: Scan = { depth: 0, inString: false, escaped: false, rootIsObject: false, expectKey: false, keyBuf: null, lastKey: '', capturing: false, captured: '' }
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('The registry document is too large.')
      const finished = feed(scan, decoder.decode(value, { stream: true }))
      if (finished !== null) return JSON.parse(finished) as Record<string, unknown>
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  if (scan.capturing) throw new Error('The registry document ended inside its release times.')
  return null
}
