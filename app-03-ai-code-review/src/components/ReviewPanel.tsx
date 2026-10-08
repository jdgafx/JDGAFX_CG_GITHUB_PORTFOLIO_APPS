import type { ReactNode } from 'react'
import { commentBudget } from '../../netlify/shared/review'
import { SEVERITIES, SEVERITY_CONFIG, SEVERITY_HINT } from '../constants'
import type { ReviewComment, ReviewResult, RunPhase, Severity } from '../types'
import { ReviewFinding } from './ReviewFinding'

interface ReviewPanelProps {
  phase: RunPhase
  error: string | null
  result: ReviewResult | null
  visibleComments: ReviewComment[]
  counts: Record<Severity, number>
  filters: Record<Severity, boolean>
  highlightedLine: number | null
  copied: boolean
  /** The lines of the code that was reviewed. Cited text is read from here, never from the live editor. */
  reviewedLines: string[]
  /** True when the code was edited after the review ran. */
  stale: boolean
  onToggleFilter: (severity: Severity) => void
  onShowLine: (line: number) => void
  onRetry: () => void
  onCopy: () => void
}

const count = (value: number) => value.toLocaleString('en-US')

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${count(n)} ${many}`)

/** One sentence on where the review stands. It is the text of the live region. */
function statusLine(phase: RunPhase, total: number): string {
  if (phase === 'running') return 'Reviewing your code.'
  if (phase === 'failed') return 'The review failed.'
  if (phase === 'stopped') return 'Review stopped. Select Review code to run it again.'
  if (phase === 'done') {
    return total === 0 ? 'Review complete. No issues found.' : `Review complete. ${plural(total, 'issue', 'issues')} found.`
  }
  return 'Nothing reviewed yet.'
}

/** The comment budget as cells: one per comment the reviewer could return, filled for each one it did return. */
function Budget({ lineCount, returned }: { lineCount: number; returned: number }) {
  const budget = commentBudget(lineCount)
  return (
    <div className="budget">
      <div className="budget__cells" aria-hidden="true">
        {Array.from({ length: budget }, (_, i) => (
          <span key={i} className={i < returned ? 'budget__cell is-used' : 'budget__cell'} />
        ))}
      </div>
      <p className="ds-help">
        {`The reviewer could return up to ${plural(budget, 'comment', 'comments')} for ${plural(lineCount, 'line', 'lines')}. It returned ${count(returned)}.`}
      </p>
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
  reviewedLines,
  stale,
  onToggleFilter,
  onShowLine,
  onRetry,
  onCopy,
}: ReviewPanelProps) {
  const total = result?.comments.length ?? 0

  let content: ReactNode
  if (phase === 'running') {
    content = (
      <div className="ds-empty">The reviewer is reading the code. Comments appear here when the run finishes.</div>
    )
  } else if (phase === 'failed') {
    content = (
      <div role="alert" className="ds-notice ds-notice--error ds-stack">
        <p>{error}</p>
        <p className="ds-help">Sends the same code again as a new request.</p>
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
        The reviewer read all {count(result.lineCount)} lines and flagged nothing worth changing. Reviews are
        AI-selective, so a clean result is not a guarantee.
      </div>
    )
  } else if (result && visibleComments.length === 0) {
    content = (
      <div className="ds-empty">
        {total === 1 ? '1 issue is' : `${count(total)} issues are`} hidden by the severity filters. Select a severity
        above to show it.
      </div>
    )
  } else if (result) {
    content = (
      <>
        {result.truncated && (
          <p role="status" className="ds-notice">
            The reviewer hit its length limit, so this list may be incomplete. Try a shorter snippet for full coverage.
          </p>
        )}
        {stale && (
          <p role="status" className="ds-notice">
            The code has changed since this review. The comments show the version that was reviewed.
          </p>
        )}
        <ul className="findings">
          {visibleComments.map((comment, i) => (
            <ReviewFinding
              key={`${comment.line}-${comment.severity}-${i}`}
              comment={comment}
              sourceLine={reviewedLines[comment.line - 1]}
              active={highlightedLine === comment.line}
              onShowLine={() => onShowLine(comment.line)}
            />
          ))}
        </ul>
        <p className="ds-help">Select Line to show that line in the editor. Select it again to clear the highlight.</p>
        <p className="ds-help">
          Reviews are AI-selective: the highest-value findings across the file, not an exhaustive audit of every line.
        </p>
      </>
    )
  } else if (phase === 'stopped') {
    content = <div className="ds-empty">No comments were kept from the stopped run.</div>
  } else {
    content = (
      <div className="ds-empty">No review yet. Load the sample or paste code, then select Review code.</div>
    )
  }

  return (
    <section className="ds-section" aria-labelledby="review-title">
      <div className="ds-section__head">
        <h2 id="review-title" className="ds-section__title">
          Review
        </h2>
        <p className="ds-section__sub">Each comment names a line of your code, and the code on that line sits beside it.</p>
      </div>

      <div className="review-controls" role="group" aria-label="Filter comments by severity">
        <div className="review-controls__row">
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
              <span className={`ds-dot dot--${severity}`} aria-hidden="true" />
              {SEVERITY_CONFIG[severity].label}
              {result && <span className="ds-num">{counts[severity]}</span>}
            </button>
          ))}
          {phase === 'done' && total > 0 && (
            <button type="button" className="ds-button filter-chip" onClick={onCopy}>
              {copied ? 'Copied' : 'Copy review'}
            </button>
          )}
        </div>
        <p className="ds-help">Show or hide each severity. After a run, Copy review puts every comment on the clipboard as text.</p>
      </div>

      <div className="ds-panel review-panel">
        <p className="review-status" aria-live="polite">
          {statusLine(phase, total)}
        </p>
        {result && <Budget lineCount={result.lineCount} returned={total} />}
        {content}
      </div>
    </section>
  )
}
