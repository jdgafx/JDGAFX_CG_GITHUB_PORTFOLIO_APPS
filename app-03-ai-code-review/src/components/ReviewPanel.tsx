import type { ReactNode } from 'react'
import { SEVERITIES, SEVERITY_CONFIG, SEVERITY_HINT } from '../constants'
import type { ReviewComment, ReviewResult, RunPhase, Severity } from '../types'
import { ReviewCard } from './ReviewCard'

interface ReviewPanelProps {
  phase: RunPhase
  error: string | null
  result: ReviewResult | null
  visibleComments: ReviewComment[]
  counts: Record<Severity, number>
  filters: Record<Severity, boolean>
  highlightedLine: number | null
  copied: boolean
  onToggleFilter: (severity: Severity) => void
  onShowLine: (line: number) => void
  onRetry: () => void
  onCopy: () => void
}

/** One sentence on where the review stands. It is the text of the live region. */
function statusLine(phase: RunPhase, total: number): string {
  if (phase === 'running') return 'Reviewing your code.'
  if (phase === 'failed') return 'The review failed.'
  if (phase === 'done') {
    return total === 0
      ? 'Review complete. No issues found.'
      : `Review complete. ${total === 1 ? '1 issue' : `${total} issues`} found.`
  }
  return 'Paste code and run a review to see comments here.'
}

function Skeleton() {
  return (
    <div className="ds-stack" aria-hidden="true">
      <div className="review-skeleton" />
      <div className="review-skeleton review-skeleton--medium" />
      <div className="review-skeleton review-skeleton--short" />
    </div>
  )
}

export function ReviewPanel({
  phase,
  error,
  result,
  visibleComments,
  counts,
  filters,
  highlightedLine,
  copied,
  onToggleFilter,
  onShowLine,
  onRetry,
  onCopy,
}: ReviewPanelProps) {
  const total = result?.comments.length ?? 0

  let content: ReactNode
  if (phase === 'running') {
    content = <Skeleton />
  } else if (phase === 'failed') {
    content = (
      <div role="alert" className="ds-notice ds-notice--error ds-stack">
        <p>{error}</p>
        <div>
          <button type="button" className="ds-button" onClick={onRetry}>
            Retry review
          </button>
        </div>
      </div>
    )
  } else if (result && total === 0) {
    content = (
      <div className="ds-empty">
        The reviewer read all {result.lineCount.toLocaleString('en-US')} lines and flagged nothing worth changing.
        Reviews are AI-selective, so a clean result is not a guarantee.
      </div>
    )
  } else if (result && visibleComments.length === 0) {
    content = (
      <div className="ds-empty">
        {total === 1 ? '1 issue is' : `${total} issues are`} hidden by the severity filters. Select a severity above
        to show it.
      </div>
    )
  } else if (result) {
    content = (
      <>
        {result.truncated && (
          <p role="status" className="ds-notice">
            The reviewer hit its length limit, so this list may be incomplete. Try a shorter snippet for full
            coverage.
          </p>
        )}
        <ol className="review-list">
          {visibleComments.map((comment, i) => (
            <ReviewCard
              key={`${comment.line}-${comment.severity}-${i}`}
              comment={comment}
              active={highlightedLine === comment.line}
              onShowLine={() => onShowLine(comment.line)}
            />
          ))}
        </ol>
        <p className="ds-hint">
          Reviews are AI-selective: the highest-value findings across the file, not an exhaustive audit of every
          line.
        </p>
      </>
    )
  } else {
    content = <div className="ds-empty">No review yet. Paste code, then select Review code.</div>
  }

  return (
    <section className="ds-card" aria-labelledby="review-title">
      <div className="ds-card__head">
        <h2 id="review-title" className="ds-card__title">
          Review
        </h2>
        <div className="ds-row">
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              type="button"
              className="ds-button filter-chip"
              aria-pressed={filters[severity]}
              title={SEVERITY_HINT[severity]}
              disabled={!result}
              onClick={() => onToggleFilter(severity)}
            >
              {SEVERITY_CONFIG[severity].label}
              {result ? ` ${counts[severity]}` : ''}
            </button>
          ))}
          {phase === 'done' && total > 0 && (
            <button type="button" className="ds-button" onClick={onCopy}>
              {copied ? 'Copied' : 'Copy review'}
            </button>
          )}
        </div>
      </div>
      <p className="ds-hint" aria-live="polite">
        {statusLine(phase, total)}
      </p>
      <div className="ds-stack">{content}</div>
    </section>
  )
}
