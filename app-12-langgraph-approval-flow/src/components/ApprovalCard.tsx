import { useState, type FormEvent } from 'react'
import { EDIT_LABELS_MAX, NOTE_MAX_LENGTH } from '../lib/limits'
import { LABEL_VOCABULARY, PRIORITIES, type HumanDecision, type Priority, type ReviewPayload } from '../types'
import { Chips, PriorityBadge } from './Chips'
import { Md } from './Md'

interface ApprovalCardProps {
  proposal: ReviewPayload
  busy: boolean
  onDecide: (decision: HumanDecision) => void
}

/** The labels the edit form offers: the fixed list, plus any label the rules proposed, such as the area. */
function labelChoices(proposed: readonly string[]): string[] {
  return [...new Set<string>([...LABEL_VOCABULARY, ...proposed])]
}

/** The proposal the graph paused on, with the three answers a maintainer can give. */
export function ApprovalCard({ proposal, busy, onDecide }: ApprovalCardProps) {
  const { classification, triage } = proposal
  const original = triage.action === 'close_duplicate' ? triage.duplicateOf : null
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
    <section className="ds-approval" aria-labelledby="approval-heading">
      <div className="ds-approval__head">
        <h2 id="approval-heading" className="ds-section__title" tabIndex={-1} data-result-focus>
          {original ? `Close as duplicate of #${original.number}?` : 'Maintainer review needed'}
        </h2>
        <span className="ds-badge ds-badge--warning">
          <span className="ds-dot ds-dot--paused" aria-hidden="true" />
          Paused at review
        </span>
      </div>
      <p className="ds-help">
        The graph paused here and saved its checkpoint. Reload the page and come back: the run waits. Choose one answer to resume
        it. Nothing is posted to GitHub.
      </p>

      {original ? (
        <p className="gg-proposal">
          <span className="gg-proposal__label">Proposed action</span>
          <span>
            Close this issue as a duplicate of{' '}
            <a href={original.htmlUrl} target="_blank" rel="noopener noreferrer">
              #{original.number} {original.title}
            </a>
            . The evidence is in the duplicate check below.
          </span>
        </p>
      ) : null}

      <dl className="ds-kv gg-kv">
        <dt>Why it paused</dt>
        <dd>
          <ul className="gg-reasons">
            {triage.reasons.map((reason) => (
              <li key={reason}>
                <Md text={reason} />
              </li>
            ))}
          </ul>
        </dd>
        <dt>Read as</dt>
        <dd>
          {classification.type}
          {classification.area ? `, area ${classification.area}` : ''}, severity {classification.severity},{' '}
          {Math.round(classification.confidence * 100)}% confidence
        </dd>
        <dt>Summary</dt>
        <dd>
          <Md text={classification.summary || 'The classifier gave no summary.'} />
        </dd>
        <dt>Proposed labels</dt>
        <dd>
          <Chips items={triage.labels} empty="None" />
        </dd>
        <dt>Proposed priority</dt>
        <dd>
          <PriorityBadge priority={triage.priority} />
        </dd>
      </dl>

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
              {original ? ' An edit sets labels and priority only: it does not close the issue as a duplicate.' : ''}
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
          Kept on the run and shown on the triage card. It is not sent to GitHub. {note.length} of {NOTE_MAX_LENGTH} characters.
        </p>
      </div>

      {problem ? (
        <p className="ds-notice ds-notice--error" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="ds-approval__actions" role="group" aria-label="Your decision" aria-describedby="decision-help">
        <button type="button" className="ds-button ds-button--primary" disabled={busy} onClick={() => onDecide({ action: 'approve', note: note.trim() || undefined })}>
          {original ? `Approve: close as duplicate of #${original.number}` : 'Approve'}
        </button>
        <button type="button" className="ds-button" disabled={busy} aria-expanded={editing} aria-controls="edit-triage-form" onClick={() => { setProblem(null); setEditing((open) => !open) }}>
          Edit labels and priority
        </button>
        <button type="button" className="ds-button ds-button--danger" disabled={busy} onClick={() => onDecide({ action: 'reject', note: note.trim() || undefined })}>
          Reject
        </button>
      </div>
      <p id="decision-help" className="ds-help">
        Approve keeps the proposed {original ? 'action, ' : ''}labels and priority. Edit changes the labels and priority. Reject applies
        nothing, and its draft is fixed wording that says only that a maintainer looked.
      </p>
    </section>
  )
}
