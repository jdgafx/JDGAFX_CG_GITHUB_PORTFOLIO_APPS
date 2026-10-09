import { useState, type FormEvent } from 'react'
import { EDIT_LABELS_MAX, NOTE_MAX_LENGTH } from '../lib/limits'
import { LABEL_VOCABULARY, PRIORITIES, type HumanDecision, type Priority, type ReviewPayload } from '../types'

interface ApprovalCardProps {
  proposal: ReviewPayload
  busy: boolean
  onDecide: (decision: HumanDecision) => void
}

/** The labels the edit form offers: the fixed list, plus any label the rules proposed, such as the area. */
function labelChoices(proposed: readonly string[]): string[] {
  return [...new Set<string>([...LABEL_VOCABULARY, ...proposed])]
}

function Chips({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <span className="ds-help">{empty}</span>
  return (
    <span className="gg-chips">
      {items.map((item) => (
        <span key={item} className="gg-chip">
          {item}
        </span>
      ))}
    </span>
  )
}

/** The proposal the graph paused on, with the three answers a maintainer can give. */
export function ApprovalCard({ proposal, busy, onDecide }: ApprovalCardProps) {
  const { classification, triage } = proposal
  const [editing, setEditing] = useState(false)
  const [labels, setLabels] = useState<string[]>(triage.labels)
  const [priority, setPriority] = useState<Priority>(triage.priority)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const toggle = (label: string) =>
    setLabels((current) => (current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label]))

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (labels.length < 1 || labels.length > EDIT_LABELS_MAX) {
      setProblem(`Pick 1 to ${EDIT_LABELS_MAX} labels. To apply none, reject instead.`)
      return
    }
    setProblem(null)
    onDecide({ action: 'edit', labels, priority, note: note.trim() || undefined })
  }

  return (
    <section className="ds-panel gg-approval" aria-labelledby="approval-heading">
      <div className="ds-section__head ds-section__head--row">
        <div>
          <h2 id="approval-heading" className="ds-section__title">
            Maintainer review needed
          </h2>
          <p className="ds-section__sub">
            The graph paused here and saved its checkpoint. Reload the page and come back: the run waits. Choose one answer to resume it.
          </p>
        </div>
        <span className="ds-badge ds-badge--warning">
          <span className="ds-dot gg-dot--waiting" aria-hidden="true" />
          Paused at review
        </span>
      </div>

      <dl className="gg-facts">
        <div>
          <dt>Why it paused</dt>
          <dd>
            <ul className="gg-reasons">
              {triage.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>Read as</dt>
          <dd>
            {classification.type}
            {classification.area ? `, area ${classification.area}` : ''}, severity {classification.severity},{' '}
            {Math.round(classification.confidence * 100)}% confidence
          </dd>
        </div>
        <div>
          <dt>Summary</dt>
          <dd>{classification.summary || 'The classifier gave no summary.'}</dd>
        </div>
        <div>
          <dt>Proposed labels</dt>
          <dd>
            <Chips items={triage.labels} empty="None" />
          </dd>
        </div>
        <div>
          <dt>Proposed priority</dt>
          <dd>
            <span className={`gg-chip gg-chip--${triage.priority}`}>{triage.priority}</span>
          </dd>
        </div>
      </dl>

      <div className="gg-decision">
        <div className="gg-actions" role="group" aria-label="Your decision" aria-describedby="decision-help">
          <button
            type="button"
            className="ds-button ds-button--primary"
            disabled={busy}
            onClick={() => onDecide({ action: 'approve', note: note.trim() || undefined })}
          >
            Approve
          </button>
          <button
            type="button"
            className="ds-button"
            disabled={busy}
            aria-expanded={editing}
            aria-controls="edit-triage-form"
            onClick={() => {
              setProblem(null)
              setEditing((open) => !open)
            }}
          >
            Edit labels and priority
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
          Approve keeps the proposed labels and priority. Edit changes them. Reject applies neither, and its draft is
          fixed wording that says only that a maintainer looked.
        </p>
      </div>

      {editing ? (
        <form id="edit-triage-form" className="gg-edit" onSubmit={submitEdit} noValidate>
          <fieldset className="gg-labels" disabled={busy} aria-describedby="edit-labels-help">
            <legend className="ds-label">Labels</legend>
            <div className="gg-labels__grid">
              {labelChoices(triage.labels).map((label) => (
                <label key={label} className="gg-check">
                  <input type="checkbox" checked={labels.includes(label)} onChange={() => toggle(label)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p id="edit-labels-help" className="ds-help">
              Pick 1 to {EDIT_LABELS_MAX}. Tick the ones to apply.
            </p>
          </fieldset>
          <div className="ds-field">
            <label htmlFor="edit-priority" className="ds-label">
              Priority
            </label>
            <select
              id="edit-priority"
              className="ds-select"
              value={priority}
              disabled={busy}
              onChange={(event) => setPriority(event.target.value as Priority)}
              aria-describedby="edit-priority-help"
            >
              {PRIORITIES.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <p id="edit-priority-help" className="ds-help">
              How soon a maintainer should look at it.
            </p>
          </div>
          <button type="submit" className="ds-button ds-button--primary" disabled={busy}>
            Apply the edited triage
          </button>
        </form>
      ) : null}

      <div className="ds-field">
        <label htmlFor="review-note" className="ds-label">
          Note for the record (optional)
        </label>
        <textarea
          id="review-note"
          className="ds-textarea gg-note"
          maxLength={NOTE_MAX_LENGTH}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby="review-note-help"
        />
        <p id="review-note-help" className="ds-help">
          Kept on the run and shown on the triage card. It is not sent to GitHub.
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
