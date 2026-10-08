import { useState } from 'react'
import ObservedPage from './components/ObservedPage'
import RunMetrics from './components/RunMetrics'
import RunTrace from './components/RunTrace'
import TaskPanel, { type TaskErrorView } from './components/TaskPanel'
import { useBrowseRun } from './hooks/useBrowseRun'
import type { Phase, RunState } from './lib/runState'
import { buildTraceRows, expectationOf, metricsFor, statusSummary } from './lib/trace'

const BADGE: Record<Phase, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'ds-badge' },
  planning: { label: 'Planning', className: 'ds-badge ds-badge--accent' },
  running: { label: 'Running', className: 'ds-badge ds-badge--accent' },
  complete: { label: 'Complete', className: 'ds-badge ds-badge--success' },
  failed: { label: 'Failed', className: 'ds-badge ds-badge--danger' },
  stopped: { label: 'Stopped', className: 'ds-badge ds-badge--warning' },
}

/** Planning and running fail differently, so the error says which one failed. */
function errorView(state: RunState): TaskErrorView | null {
  if (state.phase !== 'failed' || !state.error) return null
  if (state.steps.length === 0) {
    return { title: 'Planning failed', message: state.error.message, planAgain: true }
  }
  const { index, message } = state.error
  return {
    title: index === null ? 'The browser run failed' : `Step ${index + 1} of ${state.steps.length} failed`,
    message,
    planAgain: false,
  }
}

export default function App() {
  const [task, setTask] = useState('')
  const { state, planAndRun, runAgain, stop, reset } = useBrowseRun()

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div>
            <h1 className="ds-title">BrowseBot</h1>
            <p className="ds-subtitle">
              A model drafts browser steps. A Browserbase session runs them on allowed sites and reports what it saw.
            </p>
          </div>
          <span className={BADGE[state.phase].className}>{BADGE[state.phase].label}</span>
        </div>
      </header>

      <main className="ds-main">
        <TaskPanel
          task={task}
          phase={state.phase}
          canRunAgain={state.steps.length > 0}
          hasRun={state.phase !== 'idle'}
          error={errorView(state)}
          onTaskChange={setTask}
          onPlan={() => void planAndRun(task.trim())}
          onStop={stop}
          onRunAgain={runAgain}
          onReset={reset}
        />

        <div className="ds-grid-2">
          <RunTrace rows={buildTraceRows(state)} summary={statusSummary(state)} />
          <div className="ds-stack">
            <RunMetrics metrics={metricsFor(state)} />
            <ObservedPage
              observed={state.observed}
              sessionId={state.sessionId}
              expectation={expectationOf(state.steps)}
            />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
