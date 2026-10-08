import { SAMPLE_TICKETS, type SampleTicket } from '../constants'
import { ticketProblem, TICKET_MAX_LENGTH, TICKET_MIN_LENGTH } from '../lib/limits'

interface TicketFormProps {
  ticket: string
  busy: boolean
  onChange: (text: string) => void
  onSample: (id: SampleTicket['id']) => void
  onRun: () => void
}

export function TicketForm({ ticket, busy, onChange, onSample, onRun }: TicketFormProps) {
  const problem = ticketProblem(ticket)
  const length = [...ticket.trim()].length

  return (
    <section className="ds-card" aria-labelledby="ticket-heading">
      <div className="ds-card__head">
        <h2 id="ticket-heading" className="ds-card__title">Support ticket</h2>
        <span className="ds-hint">Two sample tickets are ready to run</span>
      </div>

      <div className="ds-row" role="group" aria-label="Sample tickets">
        {SAMPLE_TICKETS.map((sample) => (
          <button key={sample.id} type="button" className="ds-button" disabled={busy} onClick={() => onSample(sample.id)}>
            {sample.label}
          </button>
        ))}
      </div>
      <ul className="gg-samples">
        {SAMPLE_TICKETS.map((sample) => (
          <li key={sample.id}>
            <strong>{sample.label}:</strong> {sample.outcome}
          </li>
        ))}
      </ul>

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
          aria-describedby="ticket-count ticket-rule"
        />
      </div>
      <p id="ticket-count" className="ds-hint">
        {length} characters. Use {TICKET_MIN_LENGTH} to {TICKET_MAX_LENGTH.toLocaleString('en-US')}.
      </p>
      {problem && ticket.length > 0 ? (
        <p id="ticket-rule" className="ds-notice ds-notice--error" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="ds-row gg-run-row">
        <button type="button" className="ds-button ds-button--primary" disabled={busy || problem !== null} onClick={onRun}>
          {busy ? 'Running...' : 'Run the graph'}
        </button>
      </div>
    </section>
  )
}
