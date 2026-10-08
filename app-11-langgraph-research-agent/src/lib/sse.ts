/**
 * Reads a server-sent event stream. A record ends with a blank line and may arrive split
 * across several reads, so text is buffered until a whole record is present.
 */
export interface SseParser {
  push(text: string): void
  /** Handles whatever is left when the stream ends without a final blank line. */
  flush(): void
}

export function createSseParser(onData: (data: string) => void): SseParser {
  let buffer = ''

  const handleRecord = (record: string) => {
    const data = record
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (data !== '') onData(data)
  }

  return {
    push(text) {
      buffer += text.replace(/\r\n/g, '\n')
      const records = buffer.split('\n\n')
      buffer = records.pop() ?? ''
      for (const record of records) handleRecord(record)
    },
    flush() {
      const rest = buffer
      buffer = ''
      if (rest.trim() !== '') handleRecord(rest)
    },
  }
}
