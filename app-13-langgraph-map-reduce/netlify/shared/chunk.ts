import type { Chunk } from '../../src/types/frames'

/** Target size of one chunk, in characters. */
export const CHUNK_TARGET = 1200
/** Hard cap on chunks per run. Longer texts get bigger chunks instead of more of them. */
export const MAX_CHUNKS = 12

/**
 * Sentence segments. A break follows . ! or ? and a space, or sits before a double dash,
 * and every line break is a break too. Whitespace inside a segment is collapsed.
 */
function segment(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])(?:\s+|(?=--))/))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0)
}

/** Splits one over-long segment on spaces, and only splits a single word when it cannot fit. */
function splitWords(text: string, target: number): string[] {
  const pieces: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    if (word.length > target) {
      if (current) pieces.push(current)
      current = ''
      for (let i = 0; i < word.length; i += target) pieces.push(word.slice(i, i + target))
      continue
    }
    if (current && current.length + 1 + word.length > target) {
      pieces.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) pieces.push(current)
  return pieces
}

/** Greedy packing: segments go into a chunk until the next one would pass the target. */
function pack(sentences: string[], target: number): string[] {
  const parts = sentences.flatMap((s) => (s.length > target ? splitWords(s, target) : [s]))
  const chunks: string[] = []
  let current = ''
  for (const part of parts) {
    if (current && current.length + 1 + part.length > target) {
      chunks.push(current)
      current = part
    } else {
      current = current ? `${current} ${part}` : part
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * Splits text into at most MAX_CHUNKS chunks on sentence boundaries, about CHUNK_TARGET
 * characters each. Ids are 1-based. The target grows only when the text would need more
 * than MAX_CHUNKS chunks at the normal size. Empty input gives no chunks.
 */
export function splitText(text: string): Chunk[] {
  const sentences = segment(text)
  if (sentences.length === 0) return []
  let target = CHUNK_TARGET
  let parts = pack(sentences, target)
  while (parts.length > MAX_CHUNKS) {
    target = Math.ceil(target * 1.05) + 1
    parts = pack(sentences, target)
  }
  return parts.map((chunkText, i) => ({ id: i + 1, text: chunkText }))
}
