import { formatUsd } from '../lib/format'
import type { RunResult } from '../types'

export function outcomeOf(result: Pick<RunResult, 'action' | 'amount'>): string {
  return result.action === 'refund' ? `Refund of ${formatUsd(result.amount)}` : 'No refund'
}

/** The customer email for a finished run, and who decided the outcome. */
export function ReplyCard({ result }: { result: RunResult }) {
  return (
    <section className="ds-section" aria-labelledby="reply-heading">
      <div className="ds-section__head ds-section__head--row">
        <div>
          <h2 id="reply-heading" className="ds-section__title">
            Customer reply
          </h2>
          <p className="ds-section__sub">The email the customer receives.</p>
        </div>
        <span className={result.action === 'refund' ? 'ds-badge ds-badge--success' : 'ds-badge'}>{outcomeOf(result)}</span>
      </div>
      <div className="ds-panel gg-email">
        <p className="gg-subject">{result.reply.subject}</p>
        <p className="gg-body">{result.reply.body}</p>
      </div>
      <p className="ds-help">
        Decided by {result.humanDecision ? 'a person' : 'the policy'}
        {result.humanDecision?.note ? `. Reviewer note: ${result.humanDecision.note}` : ''}.
      </p>
    </section>
  )
}
