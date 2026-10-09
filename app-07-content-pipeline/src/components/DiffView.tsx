import type { DiffKind, DiffSegment } from '../../netlify/shared/diff'
import Inline from './Inline'

interface Piece {
  kind: DiffKind
  text: string
}

interface Line {
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

const MARK: Record<DiffKind, string> = { equal: '', ins: 'diff-ins', del: 'diff-del' }
const WORD: Record<DiffKind, string> = { equal: '', ins: 'Added: ', del: 'Removed: ' }

// Tracked changes as reading text. Added words are underlined on green and removed words struck through
// on red, so the two differ without colour. A screen reader hears "Added:" and "Removed:" before each run.
export default function DiffView({ segments }: { segments: DiffSegment[] }) {
  return (
    <div className="prose diff" tabIndex={0} role="region" aria-label="Tracked changes">
      {diffLines(segments).map((line, i) => {
        const children = line.pieces.map((piece, k) => {
          if (piece.kind === 'equal') return <span key={k}><Inline text={piece.text} /></span>
          const Tag = piece.kind === 'ins' ? 'ins' : 'del'
          return <Tag key={k} className={MARK[piece.kind]}><span className="ds-sr-only">{WORD[piece.kind]}</span>{piece.text}</Tag>
        })
        return <p key={i} className={line.tag === 'p' ? undefined : `diff-${line.tag}`}>{children}</p>
      })}
    </div>
  )
}
