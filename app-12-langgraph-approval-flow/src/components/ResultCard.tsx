import type { HumanDecision, IssueRef } from '../types'
import type { Phase, RunView } from '../lib/run-state'
import { approvalVisible, type StreamFlow } from '../lib/stream-view'
import { ApprovalCard } from './ApprovalCard'
import { DuplicatesCard } from './DuplicatesCard'
import { TriageCard } from './TriageCard'

interface StateProps {
  tone: 'empty' | 'loading' | 'error' | 'stopped'
  title: string
  body: string
  actions?: Array<{ label: string; onClick: () => void; primary?: boolean }>
}

function ResultState({ tone, title, body, actions }: StateProps) {
  return (
    <div className={`ds-state ds-state--${tone}`}>
      <span className="ds-state__mark" aria-hidden="true" />
      <p className="ds-state__title" tabIndex={-1} data-result-focus>
        {title}
      </p>
      <p className="ds-state__body">{body}</p>
      {tone === 'loading' ? (
        <div className="ds-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {actions ? (
        <div className="ds-state__actions">
          {actions.map((action) => (
            <button key={action.label} type="button" className={action.primary ? 'ds-button ds-button--primary' : 'ds-button'} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Banner({ issue }: { issue: IssueRef }) {
  return (
    <p className="gg-banner">
      <span className="gg-banner__repo">
        {issue.repo} #{issue.number}
      </span>
      <span className="gg-banner__title">{issue.title}</span>
      {issue.htmlUrl.startsWith('https://github.com/') ? (
        <a className="gg-banner__link" href={issue.htmlUrl} target="_blank" rel="noopener noreferrer">
          Open on GitHub
        </a>
      ) : null}
    </p>
  )
}

interface ResultCardProps {
  run: RunView
  phase: Phase
  flow: StreamFlow
  busy: boolean
  /** The step running now, or null. */
  searching: boolean
  onDecide: (decision: HumanDecision) => void
  onRetry: () => void
  onAgain: () => void
  onRefreshThreads: () => void
}

/** The result leads the run column once a run has ended: the card to answer, the finished triage, or why there is none. */
export function ResultCard({ run, phase, flow, busy, searching, onDecide, onRetry, onAgain, onRefreshThreads }: ResultCardProps) {
  let main: React.ReactNode
  if (approvalVisible(phase, flow, run.proposal !== null) && run.proposal) {
    main = <ApprovalCard key={run.threadId ?? 'proposal'} proposal={run.proposal} busy={busy} onDecide={onDecide} />
  } else if (run.result) {
    main = <TriageCard result={run.result} />
  } else if (phase === 'failed') {
    main = (
      <ResultState
        tone="error"
        title="The run did not finish"
        body={`${run.error ?? 'It stopped before a result.'} ${run.trace.length > 0 ? 'The steps that ran are in the trace.' : 'No step had finished.'}`}
        actions={
          run.retryable
            ? [
                { label: 'Retry the failed step', onClick: onRetry, primary: true },
                { label: 'Triage another issue', onClick: onAgain },
              ]
            : [{ label: 'Try again', onClick: onAgain, primary: true }]
        }
      />
    )
  } else if (phase === 'stopped') {
    main = (
      <ResultState
        tone="stopped"
        title="Run stopped"
        body="You stopped waiting. The server may still finish the thread: check Saved threads in a moment. The steps that finished stay in the trace."
        actions={[
          { label: 'Check saved threads', onClick: onRefreshThreads },
          { label: 'Triage again', onClick: onAgain, primary: true },
        ]}
      />
    )
  } else if (phase === 'running') {
    main = <ResultState tone="loading" title="Triaging" body={searching ? 'Searching the repository for duplicates.' : 'The triage card appears here when the run ends or pauses for a maintainer.'} />
  } else {
    main = (
      <ResultState
        tone="empty"
        title="No triage yet"
        body="Pick a repository, choose one of its issues, and press Triage. The card, the duplicate check and the graph appear here."
      />
    )
  }

  return (
    <section className="ds-section ds-run__result" aria-label="Triage result" aria-live="polite">
      {run.issue ? <Banner issue={run.issue} /> : null}
      {main}
      <DuplicatesCard report={run.duplicates} searching={searching} />
    </section>
  )
}
