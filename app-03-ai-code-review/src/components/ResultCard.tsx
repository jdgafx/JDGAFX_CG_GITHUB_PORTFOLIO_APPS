import type { ReactNode } from 'react'
import { SEVERITIES, SEVERITY_CONFIG, SEVERITY_HINT } from '../constants'
import { count } from '../lib/format'
import type { ContextLine } from '../lib/context'
import { countVerdicts, isShown, plural, verdictSentence, waitingSentence } from '../lib/verdicts'
import type { ReviewComment, ReviewResult, RunPhase, Severity } from '../types'
import { DroppedList } from './DroppedList'
import { Finding } from './Finding'
import { Ledger } from './Ledger'

interface StateProps {
  tone: 'empty' | 'loading' | 'error' | 'stopped'
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}

function ResultState({ tone, title, body, action }: StateProps) {
  return (
    <div className={`ds-state ds-state--${tone}`}>
      <span className="ds-state__mark" aria-hidden="true" />
      <p className="ds-state__title" tabIndex={-1} data-result-focus>
        {title}
      </p>
      <p className="ds-state__body">{body}</p>
      {tone === 'loading' && (
        <div className="ds-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {action && (
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  )
}

interface ResultCardProps {
  phase: RunPhase
  error: string | null
  result: ReviewResult | null
  /** The first pass's comments are on the page and the reads are still running: nothing in `result` is confirmed yet. */
  checking: boolean
  hasSteps: boolean
  /** Shown comments sorted for reading. Dropped ones are listed apart. */
  filters: Record<Severity, boolean>
  highlightedLine: number | null
  copied: boolean
  stale: boolean
  onToggleFilter: (severity: Severity) => void
  onShowLine: (comment: ReviewComment) => void
  contextOf: (comment: ReviewComment) => ContextLine[] | null
  hrefOf: (comment: ReviewComment) => string | null
  /** What the empty state says to do next, for the input that is loaded now. */
  emptyBody: string
  onRetry: () => void
  onCopy: () => void
  sortComments: (comments: ReviewComment[]) => ReviewComment[]
}

function Notices({ result, stale, checking }: { result: ReviewResult; stale: boolean; checking: boolean }): ReactNode {
  const counts = countVerdicts(result.comments)
  return (
    <>
      {checking && (
        <p role="status" className="ds-notice ds-notice--warning">
          Checking each comment against the code… These are the first pass's comments after the deterministic checks. None is confirmed yet, and the checked list replaces this one when both reads finish.
        </p>
      )}
      {result.pr && (
        <p className="ds-help">
          {`Read ${plural(result.pr.filesIncluded, 'file', 'files')}: ${count(result.pr.changedIncluded)} changed lines, ${count(result.pr.charsIncluded)} of ${count(result.pr.charLimit)} characters. Comments sit on changed lines only.`}
        </p>
      )}
      {!checking && !result.verified && (
        <p role="status" className="ds-notice ds-notice--warning">
          The second pass did not finish, so the surviving comments are shown as not confirmed. Only the deterministic checks ran on them. Run the review again to verify them.
        </p>
      )}
      {!checking && result.verified && counts.unverified > 0 && (
        <p role="status" className="ds-notice ds-notice--warning">
          {`${plural(counts.unverified, 'comment', 'comments')} not confirmed: the two reads disagreed, the adversarial read found code against them, or they rest on something outside the code. They are listed below, closed.`}
        </p>
      )}
      {result.malformed > 0 && (
        <p role="status" className="ds-notice">
          {`${plural(result.malformed, 'first-pass item', 'first-pass items')} had no readable line, severity or text and could not be shown.`}
        </p>
      )}
      {stale && (
        <p role="status" className="ds-notice">
          The code has changed since this review. The comments show the version that was reviewed.
        </p>
      )}
    </>
  )
}

export function ResultCard(props: ResultCardProps) {
  const { phase, error, result, checking, hasSteps, filters, highlightedLine, copied, stale, onToggleFilter, onShowLine, onRetry, onCopy, sortComments, contextOf, hrefOf, emptyBody } = props

  if (phase === 'running' && !(checking && result)) {
    return (
      <ResultState
        tone="loading"
        title="Reviewing"
        body="Pass 1 writes the comments, the checks test them, then pass 2 reads each one against the code. The first comments appear in about 15 to 25 seconds; the checked review takes about 20 to 40."
      />
    )
  }
  if (phase === 'failed') {
    return (
      <ResultState
        tone="error"
        title="The review failed"
        body={`${error ?? 'Something went wrong.'} ${hasSteps ? 'The stages that ran are in the trace.' : 'No stage had finished.'}`}
        action={{ label: 'Retry review', onClick: onRetry }}
      />
    )
  }
  if (phase === 'stopped') {
    return (
      <ResultState
        tone="stopped"
        title="Review stopped"
        body="No comments were kept from the stopped run. The provider may still bill the calls already sent."
        action={{ label: 'Review again', onClick: onRetry }}
      />
    )
  }
  if (!result) {
    return (
      <ResultState
        tone="empty"
        title="No review yet"
        body={emptyBody}
      />
    )
  }

  const counts = countVerdicts(result.comments)
  // When both reads finished, the comments they could not confirm are listed apart and closed; when a read failed they are all there is.
  const apart = result.verified
  const shown = sortComments(result.comments.filter((c) => isShown(c) && !(apart && c.verdict === 'unverified')))
  const unconfirmed = sortComments(result.comments.filter((c) => apart && c.verdict === 'unverified'))
  const dropped = result.comments.filter((c) => !isShown(c)).sort((a, b) => a.id - b.id)
  const visible = shown.filter((c) => filters[c.severity])
  const severityCounts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const c of shown) severityCounts[c.severity] += 1
  const fullyVerified = result.verified && counts.unverified === 0
  const heading = checking ? 'Checking each comment…' : fullyVerified ? 'Review checked by a second pass' : 'Review partly checked'

  return (
    <div className="result">
      <div className="ds-lead">
        <div className="ds-lead__meta">
          <h2 className="ds-section__title" tabIndex={-1} data-result-focus>
            {heading}
          </h2>
          <span className="ds-chip ds-chip--muted">{result.mode === 'pr' ? 'pull request' : 'file'}</span>
        </div>
        <p className="ds-lead__text result__sentence" role="status">
          {checking ? waitingSentence(counts) : verdictSentence(counts, result.verified)}
        </p>
        {!checking && <Ledger counts={counts} />}
        <Notices result={result} stale={stale} checking={checking} />
      </div>

      {result.comments.length === 0 ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">Nothing worth changing</p>
          <p className="ds-state__body">
            {`The reviewer read all ${count(result.lineCount)} numbered lines and wrote no comment. Reviews are selective, so a clean result is not a guarantee.`}
          </p>
        </div>
      ) : (
        <section className="ds-section" aria-labelledby="findings-title">
          <div className="ds-section__head ds-section__head--bare">
            <h2 id="findings-title" className="ds-section__title">
              {checking ? `First-pass comments, being checked (${shown.length})` : `Comments to act on (${shown.length})`}
            </h2>
          </div>
          <div className="review-controls__row">
            <div className="review-controls__filters" role="group" aria-label="Filter comments by severity">
              {SEVERITIES.map((severity) => (
                <button
                  key={severity}
                  type="button"
                  className="ds-button filter-chip"
                  aria-pressed={filters[severity]}
                  title={severityCounts[severity] === 0 ? `No ${severity} comments` : SEVERITY_HINT[severity]}
                  disabled={severityCounts[severity] === 0}
                  onClick={() => onToggleFilter(severity)}
                >
                  <span className={`ds-dot dot--${severity}`} aria-hidden="true" />
                  {SEVERITY_CONFIG[severity].label}
                  <span className="ds-num">{severityCounts[severity]}</span>
                </button>
              ))}
            </div>
            {shown.length > 0 && !checking && (
              <button type="button" className="ds-button ds-button--quiet review-controls__copy" onClick={onCopy}>
                {copied ? 'Copied' : 'Copy review'}
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="ds-state ds-state--empty">
              <span className="ds-state__mark" aria-hidden="true" />
              <p className="ds-state__title">{unconfirmed.length > 0 ? 'Nothing was confirmed' : 'Every comment was dropped'}</p>
              <p className="ds-state__body">{unconfirmed.length > 0 ? 'The comments the second pass could not confirm are listed below, with the reason for each.' : 'Open the dropped comments below to see why each one went.'}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="ds-state ds-state--empty">
              <span className="ds-state__mark" aria-hidden="true" />
              <p className="ds-state__title">Hidden by the filters</p>
              <p className="ds-state__body">{`${plural(shown.length, 'comment is', 'comments are')} hidden. Select a severity above to show it.`}</p>
            </div>
          ) : (
            <ul className="findings">
              {visible.map((comment) => (
                <Finding
                  key={comment.id}
                  comment={comment}
                  active={result.mode === 'file' && highlightedLine === comment.line}
                  contextOf={contextOf}
                  href={hrefOf(comment)}
                  onShowLine={result.mode === 'file' ? () => onShowLine(comment) : undefined}
                />
              ))}
            </ul>
          )}
          {unconfirmed.length > 0 && (
            <details className="ds-disclosure dropped" open={shown.length === 0}>
              <summary>{`Not confirmed (${unconfirmed.length})`}</summary>
              <p className="ds-help">These comments passed the checks but the second pass could not confirm them. Each says why. Treat them as leads to check, not as findings.</p>
              <ul className="findings">
                {unconfirmed.map((comment) => (
                  <Finding
                    key={comment.id}
                    comment={comment}
                    active={result.mode === 'file' && highlightedLine === comment.line}
                    contextOf={contextOf}
                    href={hrefOf(comment)}
                    onShowLine={result.mode === 'file' ? () => onShowLine(comment) : undefined}
                  />
                ))}
              </ul>
            </details>
          )}
          <DroppedList comments={dropped} />
        </section>
      )}
    </div>
  )
}
