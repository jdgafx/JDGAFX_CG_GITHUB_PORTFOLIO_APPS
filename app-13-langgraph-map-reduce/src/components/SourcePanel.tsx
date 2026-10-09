import { Md } from './Md'
import { pickSentences, segmentsFor, type Cell, type PointRef } from '../lib/evidence'
import type { ChunkKeyPoints } from '../types/frames'

export type Selection = { kind: 'point'; key: string } | { kind: 'chunk'; id: number } | null

interface Props {
  selection: Selection
  point: PointRef | null
  cells: Cell[]
  texts: Map<number, string> | null
  keyPoints: ChunkKeyPoints[]
  onPoint: (key: string) => void
}

function ChunkText({ id, text, picked }: { id: number; text: string; picked: number[] }) {
  return (
    <p className="source__text" lang="en">
      {segmentsFor(text, picked).map((segment, i) =>
        segment.hit ? (
          <mark key={i} className="source__hit">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
      <span className="ds-sr-only"> End of chunk {id}.</span>
    </p>
  )
}

/** The evidence behind one summary point, or the detail of one chunk. */
export function SourcePanel({ selection, point, cells, texts, keyPoints, onPoint }: Props) {
  const body = (() => {
    if (selection === null) return null
    if (texts === null) {
      return <p className="ds-notice">The chunk text is not available for this run.</p>
    }
    if (selection.kind === 'point' && point) {
      const cited = point.chunks.filter((id) => texts.has(id))
      return (
        <>
          <h3 className="source__title">Source for this point</h3>
          <blockquote className="source__quote"><Md text={point.text} /></blockquote>
          {cited.length === 0 ? (
            <p className="ds-notice">This point cites no chunk, so there is no source text to show.</p>
          ) : (
            cited.map((id) => {
              const text = texts.get(id) ?? ''
              const picked = pickSentences(point.text, text)
              return (
                <article key={id} className="source__chunk" aria-label={`Chunk ${id}`}>
                  <h4 className="source__chunk-title">
                    Chunk {id}
                    <span className="ds-hint">{picked.length === 0 ? 'no sentence shares words with the point' : `${picked.length === 1 ? 'closest sentence' : 'closest sentences'} marked`}</span>
                  </h4>
                  <ChunkText id={id} text={text} picked={picked} />
                </article>
              )
            })
          )}
          <p className="ds-help">Marked sentences share the most content words with the point. The marking is a guide, not a proof.</p>
        </>
      )
    }
    if (selection.kind === 'chunk') {
      const cell = cells.find((c) => c.id === selection.id)
      const text = texts.get(selection.id)
      if (!cell || text === undefined) return null
      const points = keyPoints.find((k) => k.chunk === cell.id)?.points ?? []
      return (
        <>
          <h3 className="source__title">
            Chunk {cell.id}
            {cell.retried ? <span className="ds-badge ds-badge--warning">Retried</span> : null}
          </h3>
          <section aria-label={`Summary points citing chunk ${cell.id}`}>
            <h4 className="source__chunk-title">Cited by {cell.count} {cell.count === 1 ? 'point' : 'points'}</h4>
            {cell.cited.length === 0 ? (
              <p className="ds-help">
                {cell.kind === 'no-points' ? 'No key points were found in this chunk, so the summary could not use it.' : 'The summary does not cite this chunk.'}
              </p>
            ) : (
              <ul className="source__list">
                {cell.cited.map((ref) => (
                  <li key={ref.key}>
                    <button type="button" className="source__link" onClick={() => onPoint(ref.key)}>
                      <Md text={ref.text} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label={`Key points extracted from chunk ${cell.id}`}>
            <h4 className="source__chunk-title">Key points extracted</h4>
            {points.length === 0 ? (
              <p className="ds-help">None. The extraction found nothing to keep.</p>
            ) : (
              <ul className="source__list source__list--plain">
                {points.map((p, i) => (
                  <li key={i}>
                    <Md text={p} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label={`Text of chunk ${cell.id}`}>
            <h4 className="source__chunk-title">Chunk text</h4>
            <ChunkText id={cell.id} text={text} picked={[]} />
          </section>
        </>
      )
    }
    return null
  })()

  return (
    <div className="source" role="region" aria-label="Source text" aria-live="polite">
      {body}
    </div>
  )
}
