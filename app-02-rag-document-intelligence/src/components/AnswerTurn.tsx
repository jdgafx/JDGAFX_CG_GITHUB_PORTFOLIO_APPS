import { AnswerText } from './AnswerText'
import type { Turn } from '../types'

interface AnswerTurnProps {
  turn: Turn
  chunkPages: number[]
  onHighlight: (indices: number[]) => void
}

/** One question and its answer. Hovering or focusing the sources marks them in the passage list. */
export function AnswerTurn({ turn, chunkPages, onHighlight }: AnswerTurnProps) {
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
            {turn.selfRated !== null && (
              <span className="ds-badge">Self-rated {Math.round(turn.selfRated * 100)}%</span>
            )}
            {turn.model && <span className="ds-hint docmind-wrap">Served by {turn.model}</span>}
          </div>
          {turn.selfRated !== null && (
            <p className="ds-hint">
              The model rated its own answer. The rating is not checked against the passages.
            </p>
          )}
          {sources.length > 0 && (
            <details
              className="docmind-sources"
              onMouseEnter={() => onHighlight(sources)}
              onMouseLeave={() => onHighlight([])}
              onFocus={() => onHighlight(sources)}
              onBlur={() => onHighlight([])}
            >
              <summary>
                {sources.length === 1 ? 'Source: 1 passage' : `Sources: ${sources.length} passages`}
              </summary>
              <ul>
                {sources.map(idx => {
                  const page = chunkPages[idx]
                  return (
                    <li key={idx} className="ds-badge ds-badge--accent">
                      Passage {idx + 1}
                      {page !== undefined && `, page ${page}`}
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
