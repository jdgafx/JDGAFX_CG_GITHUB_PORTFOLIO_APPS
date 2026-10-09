import { summaryDetail, summaryLine } from '../lib/audit'
import type { AuditView } from '../lib/auditState'
import { VERDICT_ORDER, VERDICT_VIEW } from '../lib/verdict'
import { VerdictMark } from './VerdictMark'

interface AuditSummaryProps {
  view: AuditView
  onRetry: () => void
}

/** The audit's headline: "14 of 16 cited claims supported", a bar of the four verdicts, and a legend with the counts. */
export function AuditSummary({ view, onRetry }: AuditSummaryProps) {
  const { phase, summary } = view

  if (phase === 'idle') return null
  if (phase === 'none') return <p className="ds-help audit-note">{view.note ?? 'Nothing to check.'}</p>

  if (phase === 'failed' || phase === 'stopped') {
    return (
      <div className="ds-state ds-state--partial audit-state" role="status">
        <span className="ds-state__mark" aria-hidden="true" />
        <p className="ds-state__title" tabIndex={-1} data-audit-focus>{phase === 'stopped' ? 'Audit stopped' : 'Audit did not finish'}</p>
        <p className="ds-state__body">
          {phase === 'stopped' ? 'You stopped it.' : view.error}{' '}
          {summary.total} cited {summary.total === 1 ? 'sentence is' : 'sentences are'} listed as not checked. The pre-check beside each one still ran.
        </p>
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={onRetry}>
            {phase === 'stopped' ? 'Audit again' : 'Try the audit again'}
          </button>
        </div>
      </div>
    )
  }

  const running = phase === 'running'
  const bar = VERDICT_ORDER.map(verdict => ({ verdict, count: summary[verdict] })).filter(part => part.count > 0)
  const label = bar.map(part => `${part.count} ${VERDICT_VIEW[part.verdict].word.toLowerCase()}`).join(', ')

  return (
    <section className="audit-summary" aria-label="Citation audit" data-phase={phase}>
      <p className="audit-summary__line" role="status" tabIndex={-1} data-audit-focus>
        {running ? (
          <>
            <span className="ds-num">Auditing {summary.total}</span> cited {summary.total === 1 ? 'claim' : 'claims'}
          </>
        ) : (
          <>
            <span className="ds-num">{summaryLine(summary)}</span>
          </>
        )}
      </p>
      <p className="ds-hint audit-summary__sub">
        {running
          ? 'Each cited sentence is checked against the text of the source it cites.'
          : `${summaryDetail(summary)}.${view.result && view.result.overLimit > 0 ? ` ${view.result.overLimit} past the limit were not checked.` : ''}`}
      </p>
      {running ? (
        <div className="audit-bar audit-bar--pending" aria-hidden="true" />
      ) : (
        <div className="audit-bar" role="img" aria-label={`Audit result: ${label}`}>
          {bar.map(part => (
            <span key={part.verdict} data-verdict={part.verdict} style={{ flexGrow: part.count }} />
          ))}
        </div>
      )}
      {!running && (
        <ul className="audit-legend" aria-label="Verdict counts">
          {VERDICT_ORDER.map(verdict => (
            <li key={verdict} data-verdict={verdict} data-zero={summary[verdict] === 0 ? 'true' : undefined}>
              <span className="verdict">
                <VerdictMark verdict={verdict} />
                <span className="ds-num">{summary[verdict]}</span> {VERDICT_VIEW[verdict].word.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
