import { parseInline } from './markdown'
import { markFigures, markSpans, type Marked, type Span } from './markFigures'

/** One line of the explanation, trimmed, with where it starts in the whole text. Empty lines are dropped. */
export interface Line {
  text: string
  offset: number
}

export function explanationLines(text: string): Line[] {
  const lines: Line[] = []
  let offset = 0
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed !== '') lines.push({ text: trimmed, offset: offset + raw.indexOf(trimmed) })
    offset += raw.length + 1
  }
  return lines
}

/** A piece of a line (plain, emphasis, strong or code) with its text split where a rejected figure sits. */
export interface MarkedPiece {
  kind: 'text' | 'em' | 'strong' | 'code'
  parts: Marked[]
}

/**
 * Marks the rejected figures in one line. With character spans (where the server found each rejected figure in the
 * explanation) only those exact places are marked, so a correct figure with the same text elsewhere is left alone. Without
 * spans, every written occurrence of the figures' text is marked. Markdown markers are skipped when placing pieces.
 */
export function markLine(line: Line, spans: Span[] | null, figures: string[]): MarkedPiece[] {
  let cursor = 0
  return parseInline(line.text).map((piece) => {
    const found = line.text.indexOf(piece.text, cursor)
    const start = found < 0 ? cursor : found
    cursor = start + piece.text.length
    while (cursor < line.text.length && '*_`'.includes(line.text.charAt(cursor))) cursor += 1
    if (piece.kind === 'code') return { kind: piece.kind, parts: [{ text: piece.text, flagged: false }] }
    if (spans === null) return { kind: piece.kind, parts: markFigures(piece.text, figures) }
    const mine = spans.map((span) => ({ start: span.start - line.offset - start, end: span.end - line.offset - start }))
    return { kind: piece.kind, parts: markSpans(piece.text, mine) }
  })
}
