import { formatAge } from '../lib/format'
import type { IssueInput } from '../types'

export interface IssuesState {
  loading: boolean
  /** The repo the items belong to, as "owner/name". */
  repo: string | null
  items: IssueInput[]
  error: string | null
}

const SHOWN_LABELS = 3

interface IssueListProps {
  state: IssuesState
  busy: boolean
  /** The issue chosen to triage, as "owner/name#number". */
  selectedKey: string | null
  onSelect: (issue: IssueInput) => void
  /** The list is a disclosure so a phone can fold it away when a run starts. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const keyOf = (issue: Pick<IssueInput, 'repo' | 'number'>) => `${issue.repo}#${issue.number}`

/** The issues of the chosen repo. One is selected, and the Triage button in the dock sends it to the graph. */
export function IssueList({ state, busy, selectedKey, onSelect, open, onOpenChange }: IssueListProps) {
  const selected = state.items.find((issue) => keyOf(issue) === selectedKey) ?? null
  return (
    <section className="ds-section" aria-labelledby="issues-heading">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="issues-heading" className="ds-section__title">
          Issue
        </h2>
        <p className="ds-section__sub">
          {selected ? (
            <>
              Selected: <strong>#{selected.number}</strong> {selected.title}
            </>
          ) : (
            'Choose one to triage. The page sends its title, text and labels to the graph.'
          )}
        </p>
      </div>
      <details className="ds-disclosure" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
        <summary>{state.repo ? `Issues of ${state.repo}${state.items.length > 0 ? ` (${state.items.length})` : ''}` : 'Issues'}</summary>
      {state.loading ? (
        <div className="ds-state ds-state--loading" role="status">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">Loading issues</p>
          <p className="ds-state__body">Asking GitHub for the newest open issues.</p>
        </div>
      ) : null}
      {state.error ? (
        <p className="ds-notice ds-notice--error" role="alert">
          {state.error}
        </p>
      ) : null}
      {!state.loading && !state.error && state.repo && state.items.length === 0 ? (
        <p className="ds-help">No open issues in {state.repo}. Pick another repo.</p>
      ) : null}
      {!state.loading && !state.error && !state.repo ? <p className="ds-help">Pick a repo to list its issues.</p> : null}

      {state.items.length > 0 ? (
        <ul className="ds-choice-list" aria-busy={state.loading}>
          {state.items.map((issue) => {
            const chosen = keyOf(issue) === selectedKey
            return (
              <li key={issue.number}>
                <button
                  type="button"
                  className={chosen ? 'ds-choice ds-choice--selected' : 'ds-choice'}
                  aria-pressed={chosen}
                  disabled={busy}
                  onClick={() => onSelect(issue)}
                >
                  <span className="ds-choice__label">#{issue.number}</span>
                  <span className="ds-choice__text">{issue.title}</span>
                  <span className="ds-choice__meta">
                    {formatAge(issue.createdAt)}, {issue.comments} comment{issue.comments === 1 ? '' : 's'}
                    {issue.labels.length > 0 ? `, ${issue.labels.slice(0, SHOWN_LABELS).join(', ')}` : ''}
                    {issue.labels.length > SHOWN_LABELS ? ` +${issue.labels.length - SHOWN_LABELS}` : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      </details>
    </section>
  )
}
