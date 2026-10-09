// Server-sent events, read from text that can arrive split anywhere. Used by the server to
// read OpenRouter's stream and by the browser to read this app's own stream. Events end at a
// blank line. Comment lines (": ping", ": OPENROUTER PROCESSING") are heartbeats and carry no data.

export interface SseFeed {
  // The data payload of each finished event, in order.
  data: string[]
  // True once the "[DONE]" payload was seen.
  done: boolean
  // True when the text held a comment line, so a watchdog can count it as a sign of life.
  comment: boolean
}

export function createSseParser(): { feed: (text: string) => SseFeed } {
  let buffer = ''
  return {
    feed(text) {
      buffer += text.replace(/\r\n/g, '\n')
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      const out: SseFeed = { data: [], done: false, comment: false }
      for (const block of blocks) {
        const lines = block.split('\n')
        if (lines.some(line => line.startsWith(':'))) out.comment = true
        const payload = lines
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n')
        if (!payload) continue
        if (payload === '[DONE]') out.done = true
        else out.data.push(payload)
      }
      return out
    },
  }
}

export function encodeEvent(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export const PING = ': ping\n\n'
export const DONE_EVENT = 'data: [DONE]\n\n'
