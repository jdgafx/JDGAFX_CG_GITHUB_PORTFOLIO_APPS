import type { Chunk } from '../../src/types/frames'

/** Target size of one chunk, in characters. */
export const CHUNK_TARGET = 1200
/** Hard cap on chunks per run. Longer texts get bigger chunks instead of more of them. */
export const MAX_CHUNKS = 12

/**
 * Sentence segments. A break follows . ! or ? and a space, or sits before a double dash,
 * and every line break is a break too. Whitespace inside a segment is collapsed.
 */
function segment(text: string): Segment[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .flatMap((line) =>
      line
        .split(/(?<=[.!?])(?:\s+|(?=--))/)
        .map((s, i) => ({ text: s.replace(/\s+/g, ' ').trim(), newLine: i === 0 })),
    )
    .filter((s) => s.text.length > 0)
}

/** A sentence segment, and whether it began a new line of the source text. */
interface Segment {
  text: string
  newLine: boolean
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
function pack(sentences: Segment[], target: number, keepBreaks: boolean): string[] {
  const parts = sentences.flatMap((s) =>
    s.text.length > target ? splitWords(s.text, target).map((text, i) => ({ text, newLine: s.newLine && i === 0 })) : [s],
  )
  const chunks: string[] = []
  let current = ''
  for (const part of parts) {
    if (current && current.length + 1 + part.text.length > target) {
      chunks.push(current)
      current = part.text
    } else {
      // A line break is one character wide, like the space it replaces, so the boundaries never move.
      current = current ? `${current}${keepBreaks && part.newLine ? '\n' : ' '}${part.text}` : part.text
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
  return chunksOf(text, false)
}

/**
 * The same chunks as splitText, boundary for boundary, with a line break where the source text had one, so a page
 * can show a section heading on its own line. Replacing each line break with a space gives splitText's text.
 */
export function splitDisplay(text: string): Chunk[] {
  return chunksOf(text, true)
}

function chunksOf(text: string, keepBreaks: boolean): Chunk[] {
  const sentences = segment(text)
  if (sentences.length === 0) return []
  let target = CHUNK_TARGET
  let parts = pack(sentences, target, keepBreaks)
  while (parts.length > MAX_CHUNKS) {
    target = Math.ceil(target * 1.05) + 1
    parts = pack(sentences, target, keepBreaks)
  }
  return parts.map((chunkText, i) => ({ id: i + 1, text: chunkText }))
}
