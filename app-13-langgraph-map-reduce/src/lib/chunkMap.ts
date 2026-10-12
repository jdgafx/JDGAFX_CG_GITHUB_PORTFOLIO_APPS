import { MAX_CHARS, MIN_CHARS } from './limits'
import type { Chunk } from '../types/frames'
import { splitDisplay } from '../../netlify/shared/chunk'

/** How many characters of a chunk's first and last sentence the map quotes at its boundaries. */
export const EXCERPT_CHARS = 90

export interface ChunkFacts {
  id: number
  chars: number
  words: number
  /** The opening of the chunk, cut at a word. */
  start: string
  /** The close of the chunk, cut at a word. */
  end: string
  /** This chunk's size as a share of the largest chunk, 0 to 1, for the bar. */
  share: number
}

export interface ChunkSummary {
  count: number
  chars: number
  smallest: number
  largest: number
  facts: ChunkFacts[]
}

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The first `max` characters, cut at a word, with an ellipsis only when something was cut. */
export function head(text: string, max: number = EXCERPT_CHARS): string {
  const one = flat(text)
  if (one.length <= max) return one
  const cut = one.lastIndexOf(' ', max)
  return `${one.slice(0, cut > max / 2 ? cut : max)}…`
}

/** The last `max` characters, cut at a word, with an ellipsis only when something was cut. */
export function tail(text: string, max: number = EXCERPT_CHARS): string {
  const one = flat(text)
  if (one.length <= max) return one
  const from = one.length - max
  const cut = one.indexOf(' ', from)
  return `…${one.slice(cut >= 0 && cut < one.length - max / 2 ? cut + 1 : from)}`
}

/** True when the text is one the analysis accepts, so the map shows exactly the chunks a run would make. */
export function chunkable(text: string): boolean {
  return text.length >= MIN_CHARS && text.length <= MAX_CHARS && text.trim().length > 0
}

/** The chunks the server would make from this text, with their counts, sizes and boundaries. Empty when the text is not accepted. */
export function summarize(text: string): ChunkSummary {
  const chunks: Chunk[] = chunkable(text) ? splitDisplay(text) : []
  const sizes = chunks.map((c) => c.text.length)
  const largest = Math.max(0, ...sizes)
  return {
    count: chunks.length,
    chars: sizes.reduce((a, b) => a + b, 0),
    smallest: chunks.length > 0 ? Math.min(...sizes) : 0,
    largest,
    facts: chunks.map((c) => ({
      id: c.id,
      chars: c.text.length,
      words: flat(c.text).split(' ').length,
      start: head(c.text),
      end: tail(c.text),
      share: largest > 0 ? c.text.length / largest : 0,
    })),
  }
}
