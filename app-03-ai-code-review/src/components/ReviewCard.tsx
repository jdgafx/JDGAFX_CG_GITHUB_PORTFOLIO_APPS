import { SEVERITY_CONFIG } from '../constants'
import type { ReviewComment } from '../types'

interface ReviewCardProps {
  comment: ReviewComment
  active: boolean
  onShowLine: () => void
}

export function ReviewCard({ comment, active, onShowLine }: ReviewCardProps) {
  const config = SEVERITY_CONFIG[comment.severity]

  return (
    <li className={`review-item review-item--${comment.severity}`}>
      <div className="review-item__head">
        <span className={`ds-badge ${config.badge}`}>{config.label}</span>
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
      <p className="review-item__message">{comment.message}</p>
      <p className="review-item__suggestion">
        <strong>Suggestion:</strong> {comment.suggestion}
      </p>
    </li>
  )
}
