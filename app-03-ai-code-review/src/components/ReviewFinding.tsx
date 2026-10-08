import { SEVERITY_CONFIG } from '../constants'
import type { ReviewComment } from '../types'

interface ReviewFindingProps {
  comment: ReviewComment
  /** The cited line in the code that was reviewed. Undefined when that text is not held. */
  sourceLine: string | undefined
  active: boolean
  onShowLine: () => void
}

/** The cited line as text, or a plain note when the line is blank or its text is not held. */
function sourceText(sourceLine: string | undefined): { text: string; muted: boolean } {
  if (sourceLine === undefined) return { text: 'The text of this line is not available.', muted: true }
  if (sourceLine.trim() === '') return { text: 'Blank line', muted: true }
  return { text: sourceLine, muted: false }
}

/** One comment, with the code line it cites beside it. Stacks with the code on top below 720px. */
export function ReviewFinding({ comment, sourceLine, active, onShowLine }: ReviewFindingProps) {
  const { text, muted } = sourceText(sourceLine)

  return (
    <li className="finding">
      <div className={active ? 'finding__code is-active' : 'finding__code'}>
        <span className="finding__num ds-num">{comment.line}</span>
        <code className={muted ? 'finding__src is-muted' : 'finding__src'}>{text}</code>
      </div>
      <div className="finding__note">
        <div className="finding__head">
          <span className="severity">
            <span className={`ds-dot dot--${comment.severity}`} aria-hidden="true" />
            {SEVERITY_CONFIG[comment.severity].label}
          </span>
          <button
            type="button"
            className="review-line"
            aria-pressed={active}
            title={`Show line ${comment.line} in the editor`}
            onClick={onShowLine}
          >
            Line {comment.line}
          </button>
        </div>
        <p className="finding__message">{comment.message}</p>
        <p className="finding__label">Suggestion</p>
        <p className="finding__suggestion">{comment.suggestion}</p>
      </div>
    </li>
  )
}
