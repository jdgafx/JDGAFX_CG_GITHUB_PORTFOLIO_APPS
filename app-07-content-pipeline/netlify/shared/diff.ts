// Word-level diff between two versions of a piece, like tracked changes. Pure and shared with the browser.
// It is a longest-common-subsequence diff over words: a word is the text between spaces, so "tight,"
// and "tight" differ. Whitespace stays attached to the word before it, so a segment prints as written.

export type DiffKind = 'equal' | 'ins' | 'del'

export interface DiffSegment {
  kind: DiffKind
  text: string
}

export interface DiffStats {
  added: number
  removed: number
  // Sentences of the new text that contain at least one inserted word.
  sentencesRewritten: number
}

// Above this many cells the table is not built and the whole text is shown as replaced.
// Stage texts are capped at 8,000 characters (about 1,300 words), far below it.
const MAX_CELLS = 4_000_000

function tokens(text: string): string[] {
  const found = text.match(/\s*\S+\s*/g) ?? []
  // Text with only spaces has no word to compare.
  return found
}

const key = (token: string): string => token.trim()

/**
 * Diffs `before` against `after`. Equal words print as they are in `after`. Adjacent segments of the
 * same kind are merged, and a deletion comes before the insertion that replaced it.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokens(before)
  const b = tokens(after)
  let start = 0
  while (start < a.length && start < b.length && key(a[start] as string) === key(b[start] as string)) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && key(a[endA - 1] as string) === key(b[endB - 1] as string)) {
    endA -= 1
    endB -= 1
  }

  const ops: DiffSegment[] = []
  for (let i = 0; i < start; i += 1) ops.push({ kind: 'equal', text: b[i] as string })

  const n = endA - start
  const m = endB - start
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i += 1) ops.push({ kind: 'del', text: a[i] as string })
    for (let j = start; j < endB; j += 1) ops.push({ kind: 'ins', text: b[j] as string })
  } else {
    // lcs[i][j] is the length of the common subsequence of a[start+i..] and b[start+j..].
    const width = m + 1
    const lcs = new Uint16Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i * width + j] = key(a[start + i] as string) === key(b[start + j] as string)
          ? (lcs[(i + 1) * width + j + 1] as number) + 1
          : Math.max(lcs[(i + 1) * width + j] as number, lcs[i * width + j + 1] as number)
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && key(a[start + i] as string) === key(b[start + j] as string)) {
        ops.push({ kind: 'equal', text: b[start + j] as string })
        i += 1
        j += 1
      } else if (j < m && (i === n || (lcs[i * width + j + 1] as number) >= (lcs[(i + 1) * width + j] as number))) {
        ops.push({ kind: 'ins', text: b[start + j] as string })
        j += 1
      } else {
        ops.push({ kind: 'del', text: a[start + i] as string })
        i += 1
      }
    }
    // Within a changed run, deletions print before insertions.
    ops.splice(start, ops.length - start, ...orderRuns(ops.slice(start)))
  }
  for (let k = endB; k < b.length; k += 1) ops.push({ kind: 'equal', text: b[k] as string })
  return merge(ops)
}

function orderRuns(ops: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = []
  let dels: DiffSegment[] = []
  let inss: DiffSegment[] = []
  const flush = () => {
    out.push(...dels, ...inss)
    dels = []
    inss = []
  }
  for (const op of ops) {
    if (op.kind === 'equal') {
      flush()
      out.push(op)
    } else if (op.kind === 'del') dels.push(op)
    else inss.push(op)
  }
  flush()
  return out
}

function merge(ops: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = []
  for (const op of ops) {
    const last = out[out.length - 1]
    if (last && last.kind === op.kind) last.text += op.text
    else out.push({ ...op })
  }
  return out
}

function wordsIn(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// A sentence ends at . ! or ? (with closing quotes or brackets) before a space, or at a line break.
function sentenceEnds(token: string): boolean {
  return /[.!?]["')\]*_]*\s*$/.test(token) || /\n/.test(token)
}

export function diffStats(segments: DiffSegment[]): DiffStats {
  let added = 0
  let removed = 0
  const touched = new Set<number>()
  let sentence = 0
  for (const segment of segments) {
    if (segment.kind === 'del') {
      removed += wordsIn(segment.text)
      continue
    }
    for (const token of tokens(segment.text)) {
      if (segment.kind === 'ins') {
        added += 1
        touched.add(sentence)
      }
      if (sentenceEnds(token)) sentence += 1
    }
  }
  return { added, removed, sentencesRewritten: touched.size }
}

// The new and the old text of a diff, for checks that need either side.
export function sideWords(segments: DiffSegment[], side: 'new' | 'old'): { word: string; changed: boolean }[] {
  const keep: DiffKind = side === 'new' ? 'ins' : 'del'
  return segments
    .filter(segment => segment.kind === 'equal' || segment.kind === keep)
    .flatMap(segment => tokens(segment.text).map(token => ({ word: key(token), changed: segment.kind === keep })))
}
