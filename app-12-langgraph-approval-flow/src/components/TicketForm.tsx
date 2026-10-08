import { SAMPLE_TICKETS, type SampleTicket } from '../constants'
import { ticketProblem, TICKET_MAX_LENGTH, TICKET_MIN_LENGTH } from '../lib/limits'

interface TicketFormProps {
  ticket: string
  busy: boolean
  onChange: (text: string) => void
  onSample: (id: SampleTicket['id']) => void
  onRun: () => void
}

/** The controls for one run: the sample tickets, the ticket text, and the Start button. */
export function TicketForm({ ticket, busy, onChange, onSample, onRun }: TicketFormProps) {
  const problem = ticketProblem(ticket)
  const length = [...ticket.trim()].length

  return (
    <section className="ds-section" aria-labelledby="ticket-heading">
      <div className="ds-section__head">
        <h2 id="ticket-heading" className="ds-section__title">
          Support ticket
        </h2>
        <p className="ds-section__sub">The graph reads this message, applies the refund policy, and writes the reply.</p>
      </div>

      <div className="gg-samples" role="group" aria-labelledby="samples-label" aria-describedby="samples-help">
        <span id="samples-label" className="ds-label">
          Sample tickets
        </span>
        {SAMPLE_TICKETS.map((sample) => (
          <button
            key={sample.id}
            type="button"
            className="ds-button gg-sample"
            disabled={busy}
            aria-pressed={ticket === sample.text}
            onClick={() => onSample(sample.id)}
          >
            <span className="gg-sample__label">{sample.label}</span>
            <span className="gg-sample__outcome">{sample.outcome}</span>
          </button>
        ))}
        <p id="samples-help" className="ds-help">
          One needs approval. The other is approved automatically.
        </p>
      </div>

      <div className="ds-field">
        <label htmlFor="ticket-text" className="ds-label">
          Ticket text
        </label>
        <textarea
          id="ticket-text"
          className="ds-textarea"
          value={ticket}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby="ticket-help ticket-count ticket-rule"
        />
        <p id="ticket-help" className="ds-help">
          The customer's message. The agent extracts the order and the issue.
        </p>
      </div>
      <p id="ticket-count" className="ds-hint">
        {length} characters. Use {TICKET_MIN_LENGTH} to {TICKET_MAX_LENGTH.toLocaleString('en-US')}.
      </p>
      {problem && ticket.length > 0 ? (
        <p id="ticket-rule" className="ds-notice ds-notice--error" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="gg-start-block">
        <button
          type="button"
          className="ds-button ds-button--primary gg-start"
          disabled={busy || problem !== null}
          aria-busy={busy}
          onClick={onRun}
        >
          {busy ? 'Running…' : 'Start the refund run'}
        </button>
        <p className="ds-help">The graph runs each step and pauses at review when a person must decide.</p>
      </div>
    </section>
  )
}
