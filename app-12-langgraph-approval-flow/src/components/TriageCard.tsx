import { NODES, type RunResult, type TriageOutcome } from '../types'

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
            {skipped ? <span className="visually-hidden"> (skipped)</span> : null}
            {paused ? <span className="visually-hidden"> (paused for a maintainer)</span> : null}
          </li>
        )
      })}
    </ol>
  )
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

/** The final triage card: labels, priority, the drafted comment and how the decision was reached. */
export function TriageCard({ result }: { result: RunResult }) {
  const rejected = result.outcome === 'rejected'
  return (
    <section className="ds-section" aria-labelledby="triage-heading">
      <div className="ds-section__head ds-section__head--row">
        <div>
          <h2 id="triage-heading" className="ds-section__title">
            Triage card
          </h2>
          <p className="ds-section__sub">The final labels and priority, and the comment a maintainer could post.</p>
        </div>
        <span className={rejected ? 'ds-badge' : 'ds-badge ds-badge--success'}>{outcomeOf(result)}</span>
      </div>

      <dl className="ds-panel gg-card-facts">
        <div>
          <dt>Labels</dt>
          <dd>
            <Chips items={result.labels} empty="None applied" />
          </dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{result.priority ? <span className={`gg-chip gg-chip--${result.priority}`}>{result.priority}</span> : <span className="ds-help">Not set</span>}</dd>
        </div>
        <div>
          <dt>Read as</dt>
          <dd>
            {result.classification.type}
            {result.classification.area ? `, area ${result.classification.area}` : ''}, {Math.round(result.classification.confidence * 100)}% confidence
          </dd>
        </div>
        <div>
          <dt>Decision path</dt>
          <dd>
            <PathSteps path={result.path} />
            <span className="ds-help gg-path__why">
              {result.path === 'human'
                ? `Paused at review. ${result.triage.reason}`
                : result.triage.reason}
              {result.humanDecision?.note ? ` Maintainer note: ${result.humanDecision.note}` : ''}
            </span>
          </dd>
        </div>
      </dl>

      <div className="ds-panel gg-draft">
        <p className="gg-draft__label">Draft comment for the issue author</p>
        <p className="gg-body">{result.reply.body}</p>
      </div>
      <p className="ds-notice gg-draft-only" role="note">
        Draft only. Nothing is posted to GitHub, and no label or priority is applied there.
      </p>
    </section>
  )
}
