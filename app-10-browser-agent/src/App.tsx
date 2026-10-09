import { useState } from 'react'
import AllowlistPanel from './components/AllowlistPanel'
import Header from './components/Header'
import ResultCard from './components/ResultCard'
import RunControls from './components/RunControls'
import RunMetrics from './components/RunMetrics'
import RunTrace from './components/RunTrace'
import TaskPanel from './components/TaskPanel'
import { useBrowseRun } from './hooks/useBrowseRun'
import { useResultFocus, type RunPhase } from './lib/useResultFocus'
import type { Phase } from './lib/runState'
import { buildTraceRows, statusSummary } from './lib/trace'

const FOCUS_PHASE: Record<Phase, RunPhase> = {
  idle: 'idle',
  planning: 'running',
  running: 'running',
  complete: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

export default function App() {
  const [task, setTask] = useState('')
  const [collapseKey, setCollapseKey] = useState(0)
  const [railScrolled, setRailScrolled] = useState(false)
  const { state, planAndRun, runAgain, stop, reset } = useBrowseRun()
  const busy = state.phase === 'planning' || state.phase === 'running'
  const plan = () => void planAndRun(task.trim())
  const editTask = () => {
    const field = document.getElementById('task-input') as HTMLTextAreaElement | null
    field?.focus()
    field?.select()
  }

  // On a phone the replay sits below the controls: the hook scrolls it into view and focuses its heading when a run ends.
  useResultFocus(FOCUS_PHASE[state.phase], { onRunStart: (narrow) => narrow && setCollapseKey((n) => n + 1) })

  return (
    <div className="ds-app" data-run={FOCUS_PHASE[state.phase] === 'running' ? 'running' : FOCUS_PHASE[state.phase]}>
      <Header phase={state.phase} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls" data-scrolled={railScrolled ? 'true' : undefined} onScroll={(event) => setRailScrolled(event.currentTarget.scrollTop > 4)}>
            <TaskPanel task={task} busy={busy} collapseKey={collapseKey} onTaskChange={setTask} onSubmit={plan} />
            <RunControls
              task={task}
              phase={state.phase}
              canRunAgain={state.steps.length > 0}
              onPlan={plan}
              onStop={stop}
              onRunAgain={runAgain}
              onReset={() => {
                reset()
                document.getElementById('task-input')?.focus({ preventScroll: true })
              }}
            />
            <AllowlistPanel />
          </div>

          <div className="ds-run">
            <ResultCard state={state} onPlan={plan} onRunAgain={runAgain} onEditTask={editTask} />
            <RunMetrics state={state} phase={state.phase} />
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
