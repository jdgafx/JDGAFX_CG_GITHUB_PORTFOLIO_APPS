import { TOP_K } from './constants'

/** BM25 constants. k1 sets how fast repeated words stop adding score; b sets how much a long passage is penalised. */
export const K1 = 1.2
export const B = 0.75

/**
 * Words carried by almost every question and almost every passage. Left in, they swamp the signal,
 * so a question about "revenue" would rank on "what" and "the".
 */
const STOP_WORDS = new Set(
  (
    'a about above after again all also am an and any are as at be been being but by can could did do does doing ' +
    'each for from get give had has have he her here him his how i if in into is it its just like many may me more ' +
    'most much my new no not now of old on one only or other our out over please said say says see she should so ' +
    'some such tell than that the their them then there these they this those to two up us very was we were what ' +
    'when where which while who whom whose why will with would yes you your yours document documents text file page pages ' +
    'take takes took taken place places make makes made use uses used happen happens long'
  ).split(' '),
)

/** Lower-cased words of two characters or more. Offsets are kept so a match can be marked in the original text. */
const WORD = /[\p{L}\p{N}]{2,}/gu

/**
 * A light suffix stripper, not a full stemmer: plurals, -ed, -ing and a trailing -e fall away, so
 * "ranked", "ranking" and "ranks" meet at "rank". It only has to be consistent between a question and a passage.
 */
export function stem(word: string): string {
  let w = word
  if (w.length <= 3) return w
  if (w.endsWith('sses')) w = w.slice(0, -2)
  else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1)

  if (w.endsWith('ing') && w.length > 5) w = undouble(w.slice(0, -3))
  else if (w.endsWith('ed') && w.length > 4) w = undouble(w.slice(0, -2))

  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1)
  return w
}

/** "runn" becomes "run", but "ll" and "ss" stay ("call", "miss"). */
function undouble(w: string): string {
  const last = w.slice(-1)
  return w.length > 3 && last === w.slice(-2, -1) && !'lsz'.includes(last) ? w.slice(0, -1) : w
}

interface Token {
  start: number
  end: number
  /** The stem, or null for a stop word. */
  stem: string | null
}

/** Every word of the text with its position. Stop words are kept in the list (stem null) so offsets stay whole. */
export function tokens(text: string): Token[] {
  const found: Token[] = []
  for (const match of text.matchAll(WORD)) {
    const word = match[0].toLowerCase()
    found.push({ start: match.index, end: match.index + word.length, stem: STOP_WORDS.has(word) ? null : stem(word) })
  }
  return found
}

/** The stems of a text's content words, in order, with repeats. */
export function stems(text: string): string[] {
  return tokens(text).flatMap(t => (t.stem === null ? [] : [t.stem]))
}

export interface QueryTerm {
  stem: string
  /** The word as the question wrote it (the first one that gave this stem). */
  word: string
}

/** Distinct content terms of a question. A question made only of stop words ("what is this about?") falls back to all its words. */
export function queryTerms(question: string): QueryTerm[] {
  const all = [...question.matchAll(WORD)].map(m => m[0].toLowerCase())
  const content = all.filter(w => !STOP_WORDS.has(w))
  const seen = new Map<string, QueryTerm>()
  for (const word of content.length > 0 ? content : all) {
    const s = stem(word)
    if (!seen.has(s)) seen.set(s, { stem: s, word })
  }
  return [...seen.values()]
}

/** Term counts for every passage, plus the document-wide figures BM25 needs. Built once per document. */
export interface Bm25Index {
  /** Per passage: stem to count. */
  counts: Array<Map<string, number>>
  /** Per passage: number of content words. */
  lengths: number[]
  /** Stem to the number of passages containing it. */
  df: Map<string, number>
  avgLength: number
}

export function buildIndex(chunks: readonly string[]): Bm25Index {
  const counts: Array<Map<string, number>> = []
  const lengths: number[] = []
  const df = new Map<string, number>()
  for (const chunk of chunks) {
    const tf = new Map<string, number>()
    let length = 0
    for (const s of stems(chunk)) {
      tf.set(s, (tf.get(s) ?? 0) + 1)
      length++
    }
    for (const s of tf.keys()) df.set(s, (df.get(s) ?? 0) + 1)
    counts.push(tf)
    lengths.push(length)
  }
  const total = lengths.reduce((sum, n) => sum + n, 0)
  return { counts, lengths, df, avgLength: chunks.length > 0 ? total / chunks.length : 0 }
}

/** The non-negative form of the inverse document frequency (the one Lucene uses). */
export function idf(passages: number, containing: number): number {
  return Math.log(1 + (passages - containing + 0.5) / (containing + 0.5))
}

export interface RankedPassage {
  index: number
  score: number
  /** The question words that appear in this passage. */
  matched: string[]
}

/** Every passage that shares a term with the question, best first. Ties keep document order. */
export function rank(index: Bm25Index, terms: readonly QueryTerm[]): RankedPassage[] {
  const passages = index.counts.length
  const ranked: RankedPassage[] = []
  for (let i = 0; i < passages; i++) {
    const tf = index.counts[i]
    if (!tf) continue
    const norm = K1 * (1 - B + (B * (index.lengths[i] ?? 0)) / (index.avgLength || 1))
    let score = 0
    const matched: string[] = []
    for (const term of terms) {
      const f = tf.get(term.stem)
      if (!f) continue
      score += idf(passages, index.df.get(term.stem) ?? 0) * ((f * (K1 + 1)) / (f + norm))
      matched.push(term.word)
    }
    if (matched.length > 0) ranked.push({ index: i, score, matched })
  }
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index)
}

export interface Retrieval {
  terms: QueryTerm[]
  /** The passages that go to the model, best first. At most `limit`. */
  ranked: RankedPassage[]
  /** How many passages share at least one term with the question. */
  matching: number
  /** How many passages were scored. */
  total: number
}

const indexes = new WeakMap<readonly string[], Bm25Index>()

/** Ranks a document's passages for a question. The index is built on first use and kept for the document. */
export function retrieve(question: string, chunks: readonly string[], limit: number = TOP_K): Retrieval {
  let index = indexes.get(chunks)
  if (!index) {
    index = buildIndex(chunks)
    indexes.set(chunks, index)
  }
  const terms = queryTerms(question)
  const all = rank(index, terms)
  return { terms, ranked: all.slice(0, limit), matching: all.length, total: chunks.length }
}

export interface Segment {
  text: string
  /** True when the text is a word that matches a question term. */
  hit: boolean
}

/** Cuts a passage into runs, marking the words whose stem is one of the question's. */
export function highlightSegments(text: string, terms: readonly QueryTerm[]): Segment[] {
  const wanted = new Set(terms.map(t => t.stem))
  const segments: Segment[] = []
  let at = 0
  const push = (to: number, hit: boolean) => {
    if (to > at) segments.push({ text: text.slice(at, to), hit })
    at = to
  }
  for (const token of tokens(text)) {
    if (token.stem === null || !wanted.has(token.stem)) continue
    push(token.start, false)
    push(token.end, true)
  }
  push(text.length, false)
  return segments
}
