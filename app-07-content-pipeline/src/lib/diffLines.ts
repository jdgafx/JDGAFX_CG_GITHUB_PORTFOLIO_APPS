import type { DiffKind, DiffSegment } from '../../netlify/shared/diff'
import { sentenceCase } from './titles'

export interface Piece {
  kind: DiffKind
  text: string
}

export interface Line {
  // 'h' for a heading, 'li' for a list item, 'p' for a paragraph.
  tag: 'h' | 'li' | 'p'
  pieces: Piece[]
}

const PREFIX = /^(\s*)(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/

// Splits the diff into the lines of the new text. A deleted run never breaks a line: its line breaks
// become spaces, so a removed sentence shows inline where it stood.
export function diffLines(segments: DiffSegment[]): Line[] {
  const lines: Piece[][] = [[]]
  for (const segment of segments) {
    if (segment.kind === 'del') {
      lines[lines.length - 1]?.push({ kind: 'del', text: segment.text.replace(/\s*\n\s*/g, ' ') })
      continue
    }
    segment.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1]?.push({ kind: segment.kind, text: part })
    })
  }
  return lines
    .filter(pieces => pieces.some(piece => piece.text.trim()))
    .map((pieces): Line => {
      const first = pieces.find(piece => piece.kind !== 'del')
      const marker = first ? PREFIX.exec(first.text)?.[2] : undefined
      if (!first || !marker) return { tag: 'p', pieces }
      first.text = first.text.replace(PREFIX, '$1')
      return { tag: marker.startsWith('#') ? 'h' : 'li', pieces }
    })
}

// Puts a heading line into sentence case. The case of the words that stay in the new text is decided on
// the whole line, then applied letter by letter to its equal and added pieces; removed words keep theirs.
export function sentenceCaseLine(pieces: Piece[], names: string[]): Piece[] {
  const kept = pieces.filter(piece => piece.kind !== 'del')
  const before = kept.map(piece => piece.text).join('')
  const after = sentenceCase(before, names)
  if (after === before) return pieces
  let at = 0
  return pieces.map(piece => {
    if (piece.kind === 'del') return piece
    const text = after.slice(at, at + piece.text.length)
    at += piece.text.length
    return { ...piece, text }
  })
}
