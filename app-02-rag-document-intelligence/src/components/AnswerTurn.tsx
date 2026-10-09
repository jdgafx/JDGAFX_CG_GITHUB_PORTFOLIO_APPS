import { AnswerText } from './AnswerText'
import { locationLabel } from '../lib/location'
import type { DocumentState, Turn } from '../types'

interface AnswerTurnProps {
  turn: Turn
  /** Where each passage sits, and what the numbers count: pages or sections. */
  document: Pick<DocumentState, 'chunkPages' | 'unit' | 'sectionTitles'>
  /** Marks a source's passages in the list while it is under the pointer or focus. Null clears the mark. */
  onHighlight: (sources: number[] | null) => void
}

/** One question and its answer. Hovering or focusing the sources marks them in the passage list. */
export function AnswerTurn({ turn, document, onHighlight }: AnswerTurnProps) {
  const sources = turn.sourceChunks

  return (
    <article className="docmind-turn">
      <h3 className="docmind-question">{turn.question}</h3>

      {turn.kind === 'no-matches' ? (
        <div className="ds-notice">{turn.answer}</div>
      ) : (
        <>
          <AnswerText text={turn.answer} />
          <div className="ds-row">
            {turn.selfRated !== null && <span className="ds-badge">Self-rated {Math.round(turn.selfRated * 100)}%</span>}
            {turn.model && (
              <span className="ds-help docmind-wrap">
                Served by <span className="ds-mono">{turn.model}</span>
              </span>
            )}
          </div>
          {turn.selfRated !== null && (
            <p className="ds-help">The model rated its own answer. The rating is not checked against the passages.</p>
          )}
          {sources.length > 0 && (
            <details
              className="docmind-sources"
              open
              onMouseEnter={() => onHighlight(sources)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(sources)}
              onBlur={() => onHighlight(null)}
            >
              <summary>{sources.length === 1 ? 'Source: 1 passage' : `Sources: ${sources.length} passages`}</summary>
              <ul>
                {sources.map(idx => {
                  const place = document.chunkPages[idx]
                  return (
                    <li key={idx} className="ds-badge ds-badge--accent">
                      Passage {idx + 1}
                      {place !== undefined && `, ${locationLabel(document, place)}`}
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  )
}
