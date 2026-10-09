import { SEVERITY_CONFIG } from '../constants'
import { plural } from '../lib/verdicts'
import type { ReviewComment } from '../types'
import { CitedCode, placeOf } from './Finding'
import { Inline } from './Inline'

/** Dropped comments, on demand: what each one said, the code it was about, who dropped it and why. Nothing is silently gone. */
export function DroppedList({ comments }: { comments: ReviewComment[] }) {
  if (comments.length === 0) return null
  return (
    <details className="ds-disclosure dropped">
      <summary>{`Dropped comments (${comments.length})`}</summary>
      <p className="ds-help">
        {`These ${plural(comments.length, 'comment', 'comments')} were written by the first pass and removed. Each shows why, so you can judge the call.`}
      </p>
      <ul className="dropped__list">
        {comments.map((c) => (
          <li key={c.id} className="dropped__item">
            <div className="finding__head">
              <span className="severity">
                <span className={`ds-dot dot--${c.severity}`} aria-hidden="true" />
                {SEVERITY_CONFIG[c.severity].label}
              </span>
              <span className="finding__place ds-mono">{placeOf(c)}</span>
              <span className="ds-badge">Dropped</span>
            </div>
            <CitedCode comment={c} context={null} />
            <p className="dropped__message">
              <Inline text={c.message} />
            </p>
            <p className="finding__why">
              <span className="finding__label">{c.decidedBy === 'verifier' ? 'Dropped by the second pass: ' : 'Dropped by the checks: '}</span>
              {c.reason}
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}
