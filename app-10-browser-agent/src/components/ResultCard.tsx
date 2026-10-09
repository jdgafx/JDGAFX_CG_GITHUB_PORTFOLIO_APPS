import { useMemo } from 'react'
import { replayItems } from '../lib/replay'
import type { RunState } from '../lib/runState'
import { expectationOf } from '../lib/trace'
import Replay from './Replay'

interface StateProps {
  tone: 'empty' | 'loading' | 'error' | 'stopped'
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}

function ResultState({ tone, title, body, action }: StateProps) {
  return (
    <div className={`ds-state ds-state--${tone}`}>
      <span className="ds-state__mark" aria-hidden="true" />
      <p className="ds-state__title" tabIndex={-1} data-result-focus>{title}</p>
      <p className="ds-state__body">{body}</p>
      {tone === 'loading' && (
        <div className="ds-skeleton" aria-hidden="true"><span /><span /><span /></div>
      )}
      {action && (
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={action.onClick}>{action.label}</button>
        </div>
      )}
    </div>
  )
}

interface ResultCardProps {
  state: RunState
  onPlan: () => void
  onRunAgain: () => void
}

function headline(state: RunState): string {
  const total = state.steps.length
  switch (state.phase) {
    case 'complete': return 'Run complete'
    case 'stopped': return 'Run stopped'
    case 'failed': {
      const index = state.error?.index ?? null
      return index === null ? 'The browser run failed' : `Step ${index + 1} of ${total} failed`
    }
    default: return 'Replay'
  }
}

/** The replay leads the page once a run has ended. Before a plan exists it shows the empty, planning or planning-failed state. */
export default function ResultCard({ state, onPlan, onRunAgain }: ResultCardProps) {
  const items = useMemo(() => replayItems(state), [state])
  const { phase } = state

  if (state.steps.length === 0) {
    const states: Partial<Record<typeof phase, StateProps>> = {
      idle: { tone: 'empty', title: 'No replay yet', body: 'Enter a task or pick an example, then plan and run it. Each step leaves a picture of the real page here, next to the text the browser read.' },
      planning: { tone: 'loading', title: 'Planning the steps', body: 'One model call turns your task into browser steps. The filmstrip appears when the plan is ready.' },
      failed: { tone: 'error', title: 'Planning failed', body: state.error?.message ?? 'No plan was made.', action: { label: 'Plan again', onClick: onPlan } },
    }
    const shown = states[phase] ?? states.idle!
    return (
      <section className="ds-section ds-run__result" aria-label="Replay" aria-live="polite">
        <ResultState {...shown} />
      </section>
    )
  }

  const finished = items.filter((item) => item.status === 'ok').length
  const ended = phase === 'complete' || phase === 'failed' || phase === 'stopped'
  const badge = phase === 'complete' ? 'ds-badge--success' : phase === 'failed' ? 'ds-badge--danger' : phase === 'stopped' ? 'ds-badge--warning' : 'ds-badge--accent'
  return (
    <section className="ds-section ds-run__result" aria-label="Replay">
      <div className="ds-lead">
        <div className="ds-lead__meta">
          <h2 tabIndex={-1} data-result-focus className="ds-section__title">{headline(state)}</h2>
          <span className={`ds-badge ${badge}`}>
            <span className="ds-dot" aria-hidden="true" />
            {finished} of {state.steps.length} steps done
          </span>
        </div>
        {phase === 'failed' && state.error ? (
          <div className="ds-state ds-state--error" role="alert">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">{state.error.index === null ? 'The run did not finish' : `Step ${state.error.index + 1} did not work`}</p>
            <p className="ds-state__body">{state.error.message} The picture shows the page where it stopped.</p>
            <div className="ds-state__actions">
              <button type="button" className="ds-button" onClick={onRunAgain}>Run plan again</button>
            </div>
          </div>
        ) : null}
        {phase === 'stopped' ? (
          <div className="ds-state ds-state--stopped" role="status">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">Stopped by you</p>
            <p className="ds-state__body">The steps that finished keep their pictures. No task result was produced.</p>
            <div className="ds-state__actions">
              <button type="button" className="ds-button" onClick={onRunAgain}>Run plan again</button>
            </div>
          </div>
        ) : null}
        <Replay items={items} phase={phase} runId={state.runId} expectation={expectationOf(state.steps)} sessionId={state.sessionId} />
        <p className="ds-lead__foot">
          {ended
            ? 'Each picture is a small JPEG the server took of the live page right after the step, so it matches the text beside it. Nothing is stored.'
            : 'Pictures arrive as each step ends. Select a step to look back while the run continues.'}
        </p>
      </div>
    </section>
  )
}
