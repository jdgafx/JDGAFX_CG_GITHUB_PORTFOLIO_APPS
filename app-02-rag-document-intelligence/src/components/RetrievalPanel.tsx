import { useEffect, useRef } from 'react'
import { AnswerTurn } from './AnswerTurn'
import { DocumentViewer } from './DocumentViewer'
import type { DocumentState, RunState, Turn } from '../types'

interface RetrievalPanelProps {
  doc: DocumentState | null
  /** Changes when a document loads, so the passage list starts again from its beginning. */
  docVersion: number
  turns: Turn[]
  sent: number[]
  citedLatest: number[]
  /** Passages to mark as cited now: a hovered source, or else the latest answer's sources. */
  highlight: number[]
  latestState: RunState | null
  reveal: { index: number } | null
  onHighlight: (sources: number[] | null) => void
}

/** The hero. The answers sit beside the passages they came from, so each source can be checked. */
export function RetrievalPanel({
  doc,
  docVersion,
  turns,
  sent,
  citedLatest,
  highlight,
  latestState,
  reveal,
  onHighlight,
}: RetrievalPanelProps) {
  return (
    <section className="ds-section docmind-hero" aria-labelledby="section-passages">
      <div className="ds-section__head">
        <h2 id="section-passages" className="ds-section__title">
          Passages
        </h2>
        <p className="ds-section__sub">Shaded passages went to the model. Solid ones back the answer.</p>
      </div>

      {doc ? (
        <div className="docmind-hero__body">
          <Answers turns={turns} chunkPages={doc.chunkPages} onHighlight={onHighlight} />
          <DocumentViewer
            key={docVersion}
            document={doc}
            sent={sent}
            citedLatest={citedLatest}
            highlight={highlight}
            latestState={latestState}
            reveal={reveal}
          />
        </div>
      ) : (
        <div className="ds-empty">
          <p className="ds-label">Add a document to see its passages.</p>
          <p className="ds-help">
            Each answer comes from the passages the browser picks. They appear here, with the ones the answer cites.
          </p>
        </div>
      )}
    </section>
  )
}

interface AnswersProps {
  turns: Turn[]
  chunkPages: number[]
  onHighlight: (sources: number[] | null) => void
}

/** The conversation. The newest answer stays in view inside this column, not the page. */
function Answers({ turns, chunkPages, onHighlight }: AnswersProps) {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length])

  if (turns.length === 0) {
    return (
      <div className="ds-empty">
        <p className="ds-help">
          No answer yet. Ask a question to see the answer, the passages it cites, and the page each one is on.
        </p>
      </div>
    )
  }

  return (
    <div ref={logRef} className="docmind-conversation" role="log" aria-label="Answers">
      {turns.map(turn => (
        <AnswerTurn key={turn.id} turn={turn} chunkPages={chunkPages} onHighlight={onHighlight} />
      ))}
    </div>
  )
}
