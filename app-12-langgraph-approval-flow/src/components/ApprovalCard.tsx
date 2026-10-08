import { useState, type FormEvent } from 'react'
import { formatUsd } from '../lib/format'
import { NOTE_MAX_LENGTH } from '../lib/limits'
import type { HumanDecision, ReviewPayload } from '../types'
import { outcomeOf } from './ReplyCard'

interface ApprovalCardProps {
  proposal: ReviewPayload
  busy: boolean
  onDecide: (decision: HumanDecision) => void
}

/** Checks a typed amount before it is sent. The server checks it again. */
function amountProblem(text: string, orderTotal: number | null): string | null {
  const amount = Number(text)
  if (text.trim() === '' || !Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.'
  if (Math.round(amount * 100) / 100 !== amount) return 'Use at most two decimals.'
  if (orderTotal === null) return 'No order matches this ticket, so the amount cannot be edited. Approve or reject instead.'
  if (amount > orderTotal) return `The amount cannot be more than the order total of ${formatUsd(orderTotal)}.`
  return null
}

/** The proposal the graph paused on, with the three answers a person can give. */
export function ApprovalCard({ proposal, busy, onDecide }: ApprovalCardProps) {
  const [editing, setEditing] = useState(false)
  const [amountText, setAmountText] = useState(String(proposal.proposal.amount))
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const issue = amountProblem(amountText, proposal.orderTotal)
    setProblem(issue)
    if (issue) return
    onDecide({ action: 'edit', amount: Number(amountText), note: note.trim() || undefined })
  }

  const customerAsked = proposal.requestedAmount !== null ? formatUsd(proposal.requestedAmount) : 'not stated'
  const orderId = proposal.orderId ?? 'not stated'
  const orderLine =
    proposal.orderTotal !== null ? `${orderId}, total ${formatUsd(proposal.orderTotal)}` : `${orderId}, no matching order`

  return (
    <section className="ds-panel gg-approval" aria-labelledby="approval-heading">
      <div className="ds-section__head ds-section__head--row">
        <div>
          <h2 id="approval-heading" className="ds-section__title">
            Approval needed
          </h2>
          <p className="ds-section__sub">The graph paused on this proposal. Choose one answer to resume the run.</p>
        </div>
        <span className="ds-badge ds-badge--warning">
          <span className="ds-dot gg-dot--waiting" aria-hidden="true" />
          Paused at review
        </span>
      </div>

      <dl className="gg-facts">
        <div>
          <dt>Proposed outcome</dt>
          <dd>{outcomeOf(proposal.proposal)}</dd>
        </div>
        <div>
          <dt>Order</dt>
          <dd>{orderLine}</dd>
        </div>
        <div>
          <dt>Customer asked for</dt>
          <dd>{customerAsked}</dd>
        </div>
        <div>
          <dt>Policy reason</dt>
          <dd>{proposal.policy.reason}</dd>
        </div>
        <div>
          <dt>Rationale</dt>
          <dd>{proposal.proposal.rationale}</dd>
        </div>
      </dl>

      <div className="gg-decision">
        <div className="gg-actions" role="group" aria-label="Your decision" aria-describedby="decision-help">
          <button
            type="button"
            className="ds-button ds-button--primary"
            disabled={busy}
            onClick={() => onDecide({ action: 'approve' })}
          >
            Approve refund
          </button>
          <button
            type="button"
            className="ds-button"
            disabled={busy}
            aria-expanded={editing}
            aria-controls="edit-amount-form"
            onClick={() => {
              setProblem(null)
              setEditing((open) => !open)
            }}
          >
            Edit amount
          </button>
          <button
            type="button"
            className="ds-button"
            disabled={busy}
            onClick={() => onDecide({ action: 'reject', note: note.trim() || undefined })}
          >
            Reject
          </button>
        </div>
        <p id="decision-help" className="ds-help">
          Approve refunds the proposed amount. Edit amount sets another one. Reject refunds nothing.
        </p>
      </div>

      {editing ? (
        <form id="edit-amount-form" className="gg-edit" onSubmit={submitEdit} noValidate>
          <div className="ds-field">
            <label htmlFor="edit-amount" className="ds-label">
              Refund amount in dollars
            </label>
            <input
              id="edit-amount"
              className="ds-input"
              type="text"
              inputMode="decimal"
              value={amountText}
              disabled={busy}
              onChange={(event) => setAmountText(event.target.value)}
              aria-describedby="edit-amount-help"
            />
            <p id="edit-amount-help" className="ds-help">
              {proposal.orderTotal !== null
                ? `Up to ${formatUsd(proposal.orderTotal)}, the order total.`
                : 'Not available for this ticket.'}
            </p>
          </div>
          <button type="submit" className="ds-button ds-button--primary" disabled={busy}>
            Refund edited amount
          </button>
        </form>
      ) : null}

      <div className="ds-field">
        <label htmlFor="review-note" className="ds-label">
          Note for the record (optional)
        </label>
        <textarea
          id="review-note"
          className="ds-textarea"
          maxLength={NOTE_MAX_LENGTH}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby="review-note-help"
        />
        <p id="review-note-help" className="ds-help">
          Kept on the run and shown under the customer reply.
        </p>
      </div>

      {problem ? (
        <p className="ds-notice ds-notice--error" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  )
}
