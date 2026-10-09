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
  /** The issue the current run triages, as "owner/name#number", to mark its row. */
  activeKey: string | null
  onTriage: (issue: IssueInput) => void
}

export const keyOf = (issue: Pick<IssueInput, 'repo' | 'number'>) => `${issue.repo}#${issue.number}`

/** The newest open issues of the chosen repo. Each one can be sent to the graph. */
export function IssueList({ state, busy, activeKey, onTriage }: IssueListProps) {
  return (
    <section className="ds-section" aria-labelledby="issues-heading">
      <div className="ds-section__head">
        <h2 id="issues-heading" className="ds-section__title">
          Open issues{state.repo ? `: ${state.repo}` : ''}
        </h2>
        <p className="ds-section__sub">
          Pick one to triage. The page sends its title, text and labels to the graph. Nothing is posted to GitHub.
        </p>
      </div>

      {state.loading ? <p className="ds-help">Loading issues from GitHub…</p> : null}
      {state.error ? (
        <p className="ds-notice ds-notice--error" role="alert">
          {state.error}
        </p>
      ) : null}
      {!state.loading && !state.error && state.repo && state.items.length === 0 ? (
        <div className="ds-empty">No open issues in {state.repo}. Pick another repo.</div>
      ) : null}
      {!state.loading && !state.error && !state.repo ? <div className="ds-empty">Pick a repo to list its issues.</div> : null}

      <ul className="gg-issues" aria-busy={state.loading}>
        {state.items.map((issue) => (
          <li key={issue.number} className={keyOf(issue) === activeKey ? 'gg-issue gg-issue--active' : 'gg-issue'}>
            <div className="gg-issue__text">
              <p className="gg-issue__title">
                <span className="gg-issue__number">#{issue.number}</span> {issue.title}
              </p>
              <p className="ds-hint gg-issue__meta">
                <span>{formatAge(issue.createdAt)}</span>
                <span>
                  {issue.comments} comment{issue.comments === 1 ? '' : 's'}
                </span>
                {issue.labels.slice(0, SHOWN_LABELS).map((label) => (
                  <span key={label} className="gg-chip">
                    {label}
                  </span>
                ))}
                {issue.labels.length > SHOWN_LABELS ? <span>+{issue.labels.length - SHOWN_LABELS} more</span> : null}
              </p>
            </div>
            <button
              type="button"
              className="ds-button"
              disabled={busy}
              onClick={() => onTriage(issue)}
              aria-label={`Triage issue ${issue.number}: ${issue.title}`}
            >
              Triage
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
