/**
 * Where sentences and clauses end, in one place. A sentence ends at . ! or ? followed by a space or the end, and at a line
 * break: never at a decimal point ("20.5%"), at a dot inside a name ("Next.js", "ms-vue.config") or after an
 * abbreviation ("e.g."). A clause also ends at ; : and a dash, and a blank line starts a new paragraph.
 */

const ABBREVIATION = '(?<!\\b(?:e\\.g|i\\.e|vs|etc|approx|cf))'
const SENTENCE_END = `${ABBREVIATION}[.!?](?=\\s|$)|(?<=[\\d%)])\\.(?=[A-Z])|\\n`
const CLAUSE_END = `${SENTENCE_END}|[;:—]`

export interface Span {
  start: number
  end: number
}

export interface Segment extends Span {
  paragraph: number
}

/** The spans of `text` between boundaries, boundary characters left out. */
function spansBy(text: string, pattern: string): Span[] {
  const spans: Span[] = []
  let start = 0
  for (const m of text.matchAll(new RegExp(pattern, 'g'))) {
    spans.push({ start, end: m.index ?? 0 })
    start = (m.index ?? 0) + m[0].length
  }
  spans.push({ start, end: text.length })
  return spans
}

/** The sentences of `text`. */
export function sentenceSpans(text: string): Span[] {
  return spansBy(text, SENTENCE_END)
}

/** The sentence the character at `index` is in. */
export function sentenceAt(text: string, index: number): Span {
  const spans = sentenceSpans(text)
  return spans.find((s) => index >= s.start && index <= s.end) ?? spans[spans.length - 1]
}

/** The text from the start of the sentence to `index`. */
export function sentenceBefore(text: string, index: number): string {
  return text.slice(sentenceAt(text, Math.max(0, index - 1)).start, index)
}

/** The clauses of `text` (split at sentence ends and at ; : and dashes), each with the paragraph it is in. */
export function clauseSpans(text: string): Segment[] {
  const breaks = [...text.matchAll(/\n[ \t]*\n/g)].map((m) => (m.index ?? 0) + m[0].length)
  const paragraphAt = (pos: number) => breaks.filter((b) => b <= pos).length
  return spansBy(text, CLAUSE_END).map((span) => ({ ...span, paragraph: paragraphAt(span.start) }))
}
