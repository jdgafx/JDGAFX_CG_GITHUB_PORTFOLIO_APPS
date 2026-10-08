import type { Frame } from '../types/frames'

export interface SseFeed {
  frames: Frame[]
  finished: boolean
}

/**
 * Reads server-sent events from text that can arrive in any split. Events end at a blank line. Only
 * the data lines are read. The [DONE] line sets finished, and a payload that is not JSON is skipped.
 */
export function createSseParser(): { feed: (text: string) => SseFeed } {
  let buffer = ''
  return {
    feed(text: string): SseFeed {
      buffer += text.replace(/\r\n/g, '\n')
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      const frames: Frame[] = []
      let finished = false
      for (const block of blocks) {
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (!data) continue
        if (data === '[DONE]') {
          finished = true
          continue
        }
        try {
          frames.push(JSON.parse(data) as Frame)
        } catch {
          // A malformed event is dropped; the run keeps going.
        }
      }
      return { frames, finished }
    },
  }
}
