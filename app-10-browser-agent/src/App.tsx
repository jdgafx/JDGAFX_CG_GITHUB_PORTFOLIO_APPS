import { useState } from 'react'
import AllowlistPanel from './components/AllowlistPanel'
import ObservedPage from './components/ObservedPage'
import PlanRail from './components/PlanRail'
import RunControls, { type TaskErrorView } from './components/RunControls'
import RunMetrics from './components/RunMetrics'
import RunTrace from './components/RunTrace'
import TaskPanel from './components/TaskPanel'
import { useBrowseRun } from './hooks/useBrowseRun'
import type { Phase, RunState } from './lib/runState'
import { buildTraceRows, expectationOf, metricsFor, planItems, statusSummary } from './lib/trace'

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
  const busy = state.phase === 'planning' || state.phase === 'running'
  const plan = () => void planAndRun(task.trim())

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
          <p className="ds-showcase">
            <strong>What this showcases:</strong> a planner that acts on the live web inside a bounded, allowlisted browser session, with every observation shown as it happens.
          </p>
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <TaskPanel task={task} busy={busy} onTaskChange={setTask} onSubmit={plan} />
            <AllowlistPanel />
            <RunControls
              task={task}
              phase={state.phase}
              canRunAgain={state.steps.length > 0}
              hasRun={state.phase !== 'idle'}
              error={errorView(state)}
              onPlan={plan}
              onStop={stop}
              onRunAgain={runAgain}
              onReset={reset}
            />
          </div>

          <div className="ds-run">
            <section className="ds-section" aria-labelledby="hero-heading">
              <div className="ds-section__head">
                <h2 className="ds-section__title" id="hero-heading">Plan and observed page</h2>
                <p className="ds-section__sub">
                  Each step changes state as the run reaches it. The page is what the browser saw, not what the plan expected.
                </p>
              </div>
              <div className="ds-panel bb-hero">
                <div className="bb-hero__plan">
                  <h3 className="bb-subhead">Plan</h3>
                  <PlanRail items={planItems(state)} />
                </div>
                <ObservedPage
                  observed={state.observed}
                  sessionId={state.sessionId}
                  expectation={expectationOf(state.steps)}
                />
              </div>
            </section>
            <RunMetrics metrics={metricsFor(state)} />
            <RunTrace rows={buildTraceRows(state)} summary={statusSummary(state)} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
