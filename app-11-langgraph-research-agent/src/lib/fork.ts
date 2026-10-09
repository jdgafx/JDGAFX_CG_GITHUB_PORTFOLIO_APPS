import type { ResultFrame, SourceView } from '../../netlify/shared/events'

/** One run of words in a word diff: kept, added by the new answer, or removed from the old one. */
export interface DiffPart {
  kind: 'same' | 'add' | 'del'
  text: string
}

const WORD = /\S+/g

/**
 * A word diff by longest common subsequence. Answers are capped near 150 words, so the quadratic table is small.
 * Words are compared as written, so "1889" and "1889," differ; the diff errs toward showing a change.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.match(WORD) ?? []
  const b = after.match(WORD) ?? []
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], word: string) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += ` ${word}`
    else parts.push({ kind, text: word })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]!)
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push('del', a[i++]!)
    } else {
      push('add', b[j++]!)
    }
  }
  while (i < a.length) push('del', a[i++]!)
  while (j < b.length) push('add', b[j++]!)
  return parts
}

export interface DiffCounts {
  same: number
  added: number
  removed: number
}

const wordsIn = (text: string) => (text.match(WORD) ?? []).length

export function countParts(parts: readonly DiffPart[]): DiffCounts {
  const counts: DiffCounts = { same: 0, added: 0, removed: 0 }
  for (const part of parts) {
    const words = wordsIn(part.text)
    if (part.kind === 'same') counts.same += words
    else if (part.kind === 'add') counts.added += words
    else counts.removed += words
  }
  return counts
}

export interface SourceDelta {
  kept: SourceView[]
  added: SourceView[]
  dropped: SourceView[]
}

/** Which pages the two answers cite, by url, because a page's number can change between runs. */
export function sourceDelta(before: readonly SourceView[], after: readonly SourceView[]): SourceDelta {
  const was = new Set(before.map((source) => source.url))
  const now = new Set(after.map((source) => source.url))
  return {
    kept: after.filter((source) => was.has(source.url)),
    added: after.filter((source) => !was.has(source.url)),
    dropped: before.filter((source) => !now.has(source.url)),
  }
}

/** True when the new answer reads exactly like the old one, ignoring spacing. */
export function sameAnswer(before: ResultFrame, after: ResultFrame): boolean {
  return before.answer.split(/\s+/).join(' ').trim() === after.answer.split(/\s+/).join(' ').trim()
}

/** How many characters a text has, counting a pair of UTF-16 units as one. The editor shows this against the limit. */
export const charCount = (text: string): number => Array.from(text.trim()).length
