import type { Chunk, Coverage, Summary } from '../types/frames'

/** One summary point with a stable key, so the page can select it and the strip can look it up. */
export interface PointRef {
  key: string
  section: number
  index: number
  text: string
  chunks: number[]
}

/** Every point of the summary in reading order. The key is "section.index". */
export function pointRefs(summary: Summary): PointRef[] {
  return summary.sections.flatMap((section, s) =>
    section.points.map((point, i) => ({ key: `${s}.${i}`, section: s, index: i, text: point.text, chunks: point.chunks })),
  )
}

/** The points that cite each chunk. Ids outside the known set are ignored; a point counts once per chunk. */
export function citationsByChunk(refs: PointRef[], chunkIds: number[]): Map<number, PointRef[]> {
  const byChunk = new Map<number, PointRef[]>(chunkIds.map((id) => [id, []]))
  for (const ref of refs) {
    for (const id of new Set(ref.chunks)) byChunk.get(id)?.push(ref)
  }
  return byChunk
}

/** Shade steps for the heat strip: 0 for a chunk nothing cites, then 1 to 4 by share of the most-cited chunk. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4
}

/** Why a chunk is not covered: it gave no key points, or the summary does not cite it. */
export type CellKind = 'covered' | 'uncited' | 'no-points'

export interface Cell {
  id: number
  count: number
  level: 0 | 1 | 2 | 3 | 4
  kind: CellKind
  retried: boolean
  cited: PointRef[]
}

/** One cell per chunk id, in order, from the summary and the coverage the server computed. */
export function buildCells(chunkIds: number[], summary: Summary, coverage: Coverage, retried: ReadonlySet<number>): Cell[] {
  const cited = citationsByChunk(pointRefs(summary), chunkIds)
  const max = Math.max(0, ...[...cited.values()].map((list) => list.length))
  const noPoints = new Set(coverage.noPoints)
  const covered = new Set(coverage.covered)
  return chunkIds.map((id) => {
    const list = cited.get(id) ?? []
    return {
      id,
      count: list.length,
      level: heatLevel(list.length, max),
      kind: noPoints.has(id) ? 'no-points' : covered.has(id) ? 'covered' : 'uncited',
      retried: retried.has(id),
      cited: list,
    }
  })
}

/**
 * The chunk ids of the document the way the server split it. The server splits the same text with the same
 * function, so the ids match; a result whose count differs (an edited document) is refused by the caller.
 */
export function chunkTexts(chunks: Chunk[], expectedCount: number): Map<number, string> | null {
  if (chunks.length !== expectedCount) return null
  return new Map(chunks.map((c) => [c.id, c.text]))
}

const STOP_WORDS = new Set(
  (
    'a about above after again all also am an and any are as at be because been before being below between both but by can ' +
    'could did do does doing down during each few for from further had has have having he her here hers him his how i if in ' +
    'into is it its just me more most my no nor not of off on once only or other our out over own same she should so some ' +
    'such than that the their them then there these they this those through to too under until up very was we were what ' +
    'when where which while who whom why will with would you your'
  ).split(' '),
)

/** Folds plural s, -ing and -ed, so "splashed" meets "splashing" and "landing" meets "landed". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Lower-case content words: letters and digits, three or more characters, no stop words, plural s, -ing and -ed folded. */
export function contentWords(text: string): Set<string> {
  const words = new Set<string>()
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue
    words.add(stem(raw))
  }
  return words
}

/** A sentence ends at . ! or ? (and a closing quote or bracket after it), then a space, or at a line break. */
const BREAK = /(?<=[.!?]["'\u201d\u2019)]?)[ \t]+|\n+/g

/** A chunk's sentences, each with the whitespace that followed it, so the pieces rejoin to the exact chunk text. */
function pieces(chunkText: string): Array<{ sentence: string; gap: string }> {
  const out: Array<{ sentence: string; gap: string }> = []
  let at = 0
  for (const m of chunkText.matchAll(BREAK)) {
    const index = m.index ?? 0
    if (index > at) out.push({ sentence: chunkText.slice(at, index), gap: m[0] })
    else if (out.length > 0) out[out.length - 1]!.gap += m[0]
    at = index + m[0].length
  }
  if (at < chunkText.length) out.push({ sentence: chunkText.slice(at), gap: '' })
  return out
}

/** A section heading left on its own line: short, no closing punctuation. It is never picked as a supporting sentence. */
export function isHeading(sentence: string): boolean {
  return sentence.length <= 70 && sentence.split(/\s+/).length <= 8 && !/[.!?]["'\u201d\u2019)]?$/.test(sentence)
}

export function sentencesOf(chunkText: string): string[] {
  return pieces(chunkText).map((p) => p.sentence)
}

/**
 * The sentences of a chunk that best support a summary point: the ones sharing the most content words with it.
 * Ties go to the earlier sentence. A sentence needs at least one shared word, and a second pick needs at least
 * half the best score, so one clear match is not padded with a weak one. Returns indices in reading order.
 */
export function pickSentences(point: string, chunkText: string, limit = 2): number[] {
  const wanted = contentWords(point)
  const scored = sentencesOf(chunkText).map((sentence, index) => {
    let score = 0
    if (isHeading(sentence)) return { index, score }
    for (const word of contentWords(sentence)) if (wanted.has(word)) score += 1
    return { index, score }
  })
  const best = Math.max(0, ...scored.map((s) => s.score))
  if (best === 0) return []
  return scored
    .filter((s) => s.score > 0 && s.score * 2 >= best)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.index)
    .sort((a, b) => a - b)
}

export interface Segment {
  text: string
  hit: boolean
}

/** The chunk as runs of plain and highlighted text. The texts joined give back the chunk exactly. */
export function segmentsFor(chunkText: string, picked: number[]): Segment[] {
  const hits = new Set(picked)
  const out: Segment[] = []
  pieces(chunkText).forEach(({ sentence, gap }, i) => {
    const text = sentence + gap
    const hit = hits.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += text
    else out.push({ text, hit })
  })
  return out
}

/** The retried chunks, read from the streamed branches: a chunk with more than one extract attempt. */
export function retriedChunks(branches: ReadonlyArray<{ chunk: number; attempts: number }>): Set<number> {
  return new Set(branches.filter((b) => b.attempts > 1).map((b) => b.chunk))
}
