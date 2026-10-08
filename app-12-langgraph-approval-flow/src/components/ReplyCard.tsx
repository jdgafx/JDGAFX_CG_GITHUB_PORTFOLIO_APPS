import { formatUsd } from '../lib/format'
import type { RunResult } from '../types'

export function outcomeOf(result: Pick<RunResult, 'action' | 'amount'>): string {
  return result.action === 'refund' ? `Refund of ${formatUsd(result.amount)}` : 'No refund'
}

/** The customer email for a finished run, and who decided the outcome. */
export function ReplyCard({ result }: { result: RunResult }) {
  return (
    <section className="ds-card" aria-labelledby="reply-heading">
      <div className="ds-card__head">
        <h2 id="reply-heading" className="ds-card__title">Customer reply</h2>
        <span className={`ds-badge ds-badge--${result.action === 'refund' ? 'success' : 'accent'}`}>
          {outcomeOf(result)}
        </span>
      </div>
      <p className="gg-subject">{result.reply.subject}</p>
      <p className="gg-body">{result.reply.body}</p>
      <p className="ds-hint">
        Decided by {result.humanDecision ? 'a person' : 'the policy'}
        {result.humanDecision?.note ? `. Reviewer note: ${result.humanDecision.note}` : ''}.
      </p>
    </section>
  )
}
