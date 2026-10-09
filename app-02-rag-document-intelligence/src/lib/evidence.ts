import { stems, tokens } from './bm25'

/** A run of the answer: plain text, or a citation naming the passages (0-based indices) the model pointed at. */
export type AnswerPart = { kind: 'text'; text: string; sentence: number } | { kind: 'cite'; indices: number[]; sentence: number }

export interface ParsedAnswer {
  parts: AnswerPart[]
  /** The answer's sentences with the citation markers removed, numbered by the `sentence` field of each part. */
  sentences: string[]
}

/** "[Chunk 3]", "[Chunk 3, Chunk 5]", "(Chunks 3 and 5)" or a bare "Chunk 3". */
const MARKER =
  /[[(]\s*Chunks?\s+\d+(?:\s*(?:,|and|&)\s*(?:Chunks?\s+)?\d+)*\s*[\])]|\bChunks?\s+\d+(?:\s*(?:,|and|&)\s*(?:Chunks?\s+)?\d+)*/gi

/** A sentence ends at . ! or ? followed by a space or the end. */
const BOUNDARY = /[.!?]+(?=\s|$)/g

/**
 * Splits the model's answer into text and citations, and assigns every part to a sentence. A marker that follows
 * the full stop ("... in 1987. [Chunk 3]") belongs to the sentence before it. Only passages in `valid` (the ones
 * the server confirmed were sent) become citations; a marker naming any other passage is dropped.
 */
export function parseAnswer(answer: string, valid: readonly number[]): ParsedAnswer {
  const allowed = new Set(valid)
  const parts: AnswerPart[] = []
  const sentences: string[] = []
  let current = ''
  let sentence = 0

  const close = () => {
    if (current.trim() !== '') {
      sentences.push(current.trim().replace(/\s+([.,;!?])/g, '$1'))
      sentence++
    }
    current = ''
  }
  const addText = (text: string) => {
    let from = 0
    for (const match of text.matchAll(BOUNDARY)) {
      const end = match.index + match[0].length
      const piece = text.slice(from, end)
      current += piece
      parts.push({ kind: 'text', text: piece, sentence })
      close()
      from = end
    }
    const rest = text.slice(from)
    if (rest !== '') {
      current += rest
      parts.push({ kind: 'text', text: rest, sentence })
    }
  }

  let at = 0
  for (const match of answer.matchAll(MARKER)) {
    addText(answer.slice(at, match.index))
    at = match.index + match[0].length
    const indices = [...new Set([...match[0].matchAll(/\d+/g)].map(m => Number(m[0])))].filter(i => allowed.has(i))
    if (indices.length === 0) continue
    // A marker right after a closed sentence (only space since the full stop) belongs to that sentence.
    const trailing = current.trim() === '' && sentences.length > 0
    parts.push({ kind: 'cite', indices, sentence: trailing ? sentences.length - 1 : sentence })
  }
  addText(answer.slice(at))
  close()
  return { parts, sentences }
}

export interface PassageSentence {
  start: number
  end: number
  text: string
}

/** Cuts a passage into sentences with their positions. A passage that starts mid-sentence keeps its fragment as a sentence. */
export function splitSentences(passage: string): PassageSentence[] {
  const out: PassageSentence[] = []
  const boundary = /[.!?]+["')\]]*\s+(?=[\p{Lu}\p{N}"'([])/gu
  let from = 0
  const push = (to: number) => {
    const raw = passage.slice(from, to)
    const trimmed = raw.trim()
    if (trimmed !== '') {
      const start = from + (raw.length - raw.trimStart().length)
      out.push({ start, end: start + trimmed.length, text: trimmed })
    }
    from = to
  }
  for (const match of passage.matchAll(boundary)) push(match.index + match[0].length)
  push(passage.length)
  return out
}

export interface Support {
  /** The sentence in the passage that best matches the answer sentence. */
  sentence: PassageSentence
  /** The words they share (as written in the passage), which is what the match is judged on. */
  shared: string[]
}

/** The sentence of one answer sentence's best match in a passage, or null when no sentence shares a word. */
function bestFor(sentences: PassageSentence[], answerSentence: string): Support | null {
  const wanted = new Set(stems(answerSentence))
  let best: Support | null = null
  for (const sentence of sentences) {
    const words = new Map<string, string>()
    for (const t of tokens(sentence.text)) {
      if (t.stem !== null && wanted.has(t.stem) && !words.has(t.stem)) words.set(t.stem, sentence.text.slice(t.start, t.end).toLowerCase())
    }
    if (words.size > (best?.shared.length ?? 0)) best = { sentence, shared: [...words.values()] }
  }
  return best
}

/**
 * For each answer sentence that cites a passage, the sentence of the passage that shares the most distinct content
 * words with it. A tie goes to the earlier sentence. Answer sentences that pick the same passage sentence give one
 * entry, with the larger set of shared words. Sorted by position. Empty when no sentence shares a word, so the panel
 * never marks a guess.
 */
export function supportingSentences(passage: string, answerSentences: readonly string[]): Support[] {
  const sentences = splitSentences(passage)
  const picked = new Map<number, Support>()
  for (const answerSentence of answerSentences) {
    const found = bestFor(sentences, answerSentence)
    const earlier = found ? picked.get(found.sentence.start) : undefined
    if (found && (!earlier || found.shared.length > earlier.shared.length)) picked.set(found.sentence.start, found)
  }
  return [...picked.values()].sort((a, b) => a.sentence.start - b.sentence.start)
}

/** The single best match over all the answer sentences: the one with the most shared words, the earlier on a tie. */
export function supportingSentence(passage: string, answerSentences: readonly string[]): Support | null {
  let best: Support | null = null
  for (const support of supportingSentences(passage, answerSentences)) {
    if (support.shared.length > (best?.shared.length ?? 0)) best = support
  }
  return best
}

/**
 * The answer sentences that cite a passage, or the whole answer when the model listed the passage as a source
 * without marking it in the text.
 */
export function sentencesCiting(parsed: ParsedAnswer, index: number): string[] {
  const citing = new Set<number>()
  for (const part of parsed.parts) if (part.kind === 'cite' && part.indices.includes(index)) citing.add(part.sentence)
  const found = [...citing].sort((a, b) => a - b).flatMap(i => parsed.sentences[i] ?? [])
  return found.length > 0 ? found : parsed.sentences
}

/** Longest stretch at the end of `a` that is also the start of `b`, at least `min` characters long, or 0. */
function overlap(a: string, b: string, min = 8): number {
  for (let k = Math.min(a.length, b.length, 200); k >= min; k--) if (a.endsWith(b.slice(0, k))) return k
  return 0
}

/**
 * The text on each side of a passage, for the source panel. Neighbouring passages overlap by a few words, so the
 * stretch already inside the passage is cut from each side; what is left is cut to at most `max` characters at a word.
 */
export function contextAround(prev: string | undefined, passage: string, next: string | undefined, max = 220): { before: string; after: string } {
  let before = prev === undefined ? '' : prev.slice(0, prev.length - overlap(prev, passage))
  let after = next === undefined ? '' : next.slice(overlap(passage, next))
  if (before.length > max) {
    before = before.slice(-max)
    before = before.slice(before.indexOf(' ') + 1)
  }
  if (after.length > max) {
    after = after.slice(0, max)
    after = after.slice(0, after.lastIndexOf(' '))
  }
  return { before: before.trim(), after: after.trim() }
}
