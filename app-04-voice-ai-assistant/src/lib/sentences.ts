// Cuts a streamed reply into sentences, so each one can be spoken as soon as it is complete.
// A sentence ends at . ! ? or an ellipsis followed by a space or line break. A period between digits
// ("16.8 °C"), after an initial ("J. R. R. Tolkien") or after a common abbreviation ("Dr.", "e.g.")
// does not end one.
import { parseInline } from './markdown'

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'mt', 'vs', 'etc', 'jr', 'sr', 'no', 'inc', 'ltd', 'co', 'e.g', 'i.e', 'u.s', 'u.k', 'a.m', 'p.m', 'approx',
])

// A clause this long with no sentence end is spoken at its last comma, so a run-on does not hold the voice back.
const RUN_ON_CHARS = 200
const RUN_ON_MIN_CHARS = 60

function endsAbbreviation(before: string): boolean {
  const word = /([A-Za-z.]+)$/.exec(before)?.[1]?.toLowerCase().replace(/\.$/, '')
  if (!word) return false
  // A single capital letter is an initial.
  if (/^[A-Za-z]$/.test(word) && /(^|\s)[A-Z]$/.test(before)) return true
  return ABBREVIATIONS.has(word)
}

/** The index just past the first sentence in `text`, or -1 when no sentence is complete yet. */
function sentenceEnd(text: string): number {
  const pattern = /([.!?…]+["')\]”’]*)(\s+)|\n+/g
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[0].startsWith('\n')) return match.index + match[0].length
    const stop = match.index + match[1].length
    const mark = match[1][0]
    // Only a single period can be an abbreviation or an initial.
    if (mark === '.' && match[1].length === 1 && endsAbbreviation(text.slice(0, match.index))) continue
    return stop + match[2].length
  }
  if (text.length > RUN_ON_CHARS) {
    const comma = Math.max(text.lastIndexOf(', ', RUN_ON_CHARS), text.lastIndexOf('; ', RUN_ON_CHARS))
    if (comma >= RUN_ON_MIN_CHARS) return comma + 2
  }
  return -1
}

export interface SentenceSplitter {
  /** Adds streamed text and returns the sentences it completed, trimmed, in order. */
  push: (delta: string) => string[]
  /** Ends the stream: whatever is left counts as the last sentence. */
  flush: () => string[]
  /**
   * Called after the stream has paused: a tail that ends like a sentence (and not at "16." or "Dr.") is complete,
   * because the space that would confirm it may not come until much later.
   */
  settle: () => string[]
  /** The unfinished tail, which is shown but not yet spoken. */
  pending: () => string
}

export function createSentenceSplitter(): SentenceSplitter {
  let buffer = ''
  const take = (): string[] => {
    const out: string[] = []
    for (let end = sentenceEnd(buffer); end > 0; end = sentenceEnd(buffer)) {
      const sentence = buffer.slice(0, end).trim()
      buffer = buffer.slice(end)
      if (sentence) out.push(sentence)
    }
    return out
  }
  return {
    push(delta) {
      buffer += delta
      return take()
    },
    flush() {
      const out = take()
      const rest = buffer.trim()
      buffer = ''
      if (rest) out.push(rest)
      return out
    },
    settle() {
      const tail = buffer.trimEnd()
      if (!/[.!?…]["')\]”’]*$/.test(tail) || /\d\.$/.test(tail)) return []
      if (tail.endsWith('.') && endsAbbreviation(tail.slice(0, -1))) return []
      buffer = ''
      return [tail.trim()]
    },
    pending: () => buffer,
  }
}

/** What the voice says for a sentence: the words without markdown markers. */
export function speakable(sentence: string): string {
  return parseInline(sentence)
    .map(piece => piece.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
