import type { DiffKind, DiffSegment } from '../../netlify/shared/diff'
import Inline from './Inline'

import { diffLines, sentenceCaseLine } from '../lib/diffLines'

const MARK: Record<DiffKind, string> = { equal: '', ins: 'diff-ins', del: 'diff-del' }
const WORD: Record<DiffKind, string> = { equal: '', ins: 'Added: ', del: 'Removed: ' }

// Tracked changes as reading text. Added words are underlined on green and removed words struck through
// on red, so the two differ without colour. A screen reader hears "Added:" and "Removed:" before each run.
export default function DiffView({ segments, names = [] }: { segments: DiffSegment[]; names?: string[] }) {
  return (
    <div className="prose diff" tabIndex={0} role="region" aria-label="Tracked changes">
      {diffLines(segments).map((line, i) => {
        const pieces = line.tag === 'h' ? sentenceCaseLine(line.pieces, names) : line.pieces
        const children = pieces.map((piece, k) => {
          if (piece.kind === 'equal') return <span key={k}><Inline text={piece.text} /></span>
          const Tag = piece.kind === 'ins' ? 'ins' : 'del'
          return <Tag key={k} className={MARK[piece.kind]}><span className="ds-sr-only">{WORD[piece.kind]}</span>{piece.text}</Tag>
        })
        return <p key={i} className={line.tag === 'p' ? undefined : `diff-${line.tag}`}>{children}</p>
      })}
    </div>
  )
}
