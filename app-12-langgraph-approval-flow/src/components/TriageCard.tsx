import { NODES, type RunResult, type TriageOutcome } from '../types'
import { Chips, PriorityBadge } from './Chips'
import { Md } from './Md'

const OUTCOME_TEXT: Record<TriageOutcome, string> = {
  auto: 'Auto-triaged by the rules',
  approved: 'Approved by a maintainer',
  edited: 'Edited by a maintainer',
  rejected: 'Rejected by a maintainer',
}

export function outcomeOf(result: Pick<RunResult, 'outcome'>): string {
  return OUTCOME_TEXT[result.outcome]
}

/** The decision path as the steps that ran. Review is struck out when the rules settled the case alone. */
function PathSteps({ path }: { path: RunResult['path'] }) {
  return (
    <ol className="gg-path" aria-label="Decision path">
      {NODES.map((node) => {
        const skipped = node === 'review' && path === 'auto'
        const paused = node === 'review' && path === 'human'
        return (
          <li key={node} className={skipped ? 'gg-path__step gg-path__step--skipped' : paused ? 'gg-path__step gg-path__step--paused' : 'gg-path__step'}>
            {node}
            {skipped ? <span className="ds-sr-only"> (skipped)</span> : null}
            {paused ? <span className="ds-sr-only"> (paused for a maintainer)</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

/** The final triage card: what was decided, the drafted comment, and how the decision was reached. */
export function TriageCard({ result }: { result: RunResult }) {
  const rejected = result.outcome === 'rejected'
  const original = result.action === 'close_duplicate' ? result.triage.duplicateOf : null
  return (
    <section className="ds-lead" aria-labelledby="triage-heading">
      <div className="ds-lead__meta">
        <h2 id="triage-heading" className="ds-section__title" tabIndex={-1} data-result-focus>
          Triage card
        </h2>
        <span className={rejected ? 'ds-badge' : 'ds-badge ds-badge--success'}>
          <span className={rejected ? 'ds-dot ds-dot--skipped' : 'ds-dot ds-dot--ok'} aria-hidden="true" />
          {outcomeOf(result)}
        </span>
      </div>

      {original ? (
        <p className="gg-proposal">
          <span className="gg-proposal__label">Approved action</span>
          <span>
            Close as a duplicate of{' '}
            <a href={original.htmlUrl} target="_blank" rel="noopener noreferrer">
              #{original.number} {original.title}
            </a>
            . Draft only: it was not closed on GitHub.
          </span>
        </p>
      ) : null}

      <dl className="ds-kv gg-kv">
        <dt>Labels</dt>
        <dd>
          <Chips items={result.labels} empty="None applied" />
        </dd>
        <dt>Priority</dt>
        <dd>{result.priority ? <PriorityBadge priority={result.priority} /> : <span className="ds-help">Not set</span>}</dd>
        <dt>Read as</dt>
        <dd>
          {result.classification.type}
          {result.classification.area ? `, area ${result.classification.area}` : ''}, {Math.round(result.classification.confidence * 100)}% confidence
        </dd>
        <dt>Decision path</dt>
        <dd>
          <PathSteps path={result.path} />
          <span className="ds-help gg-path__why">
            {result.path === 'human' ? 'Paused at review. ' : ''}
            <Md text={result.triage.reason} />
            {result.humanDecision?.note ? ` Maintainer note: ${result.humanDecision.note}` : ''}
          </span>
        </dd>
      </dl>

      <div className="gg-draft">
        <p className="gg-draft__label">Draft comment for the issue author</p>
        <div className="ds-lead__text">
          {result.reply.body.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>
              <Md text={paragraph} />
            </p>
          ))}
        </div>
      </div>
      <p className="ds-lead__foot">Draft only. Nothing is posted to GitHub, and no label, priority or close is applied there.</p>
    </section>
  )
}
