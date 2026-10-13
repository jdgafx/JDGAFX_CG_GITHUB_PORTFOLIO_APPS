import { useState } from 'react'
import AllowlistPanel from './components/AllowlistPanel'
import Header from './components/Header'
import HnPanel from './components/HnPanel'
import HowTo from './components/HowTo'
import { ReplayLabel } from './components/ReplayLabel'
import ResultCard from './components/ResultCard'
import RunControls from './components/RunControls'
import RunMetrics from './components/RunMetrics'
import RunTrace from './components/RunTrace'
import TaskPanel from './components/TaskPanel'
import { useBrowseRun } from './hooks/useBrowseRun'
import { runExample } from './lib/howto'
import { useFrontPage } from './lib/useFrontPage'
import { useReplay } from './lib/useReplay'
import { useResultFocus, type RunPhase } from './replay'
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
  // True while the run on screen is the load-time replay, until the visitor starts a run of their own.
  const [replaying, setReplaying] = useState(false)
  const { state, planAndRun, runAgain, stop, reset } = useBrowseRun()
  const frontPage = useFrontPage()
  const busy = state.phase === 'planning' || state.phase === 'running'

  // On load, plays back the stored real run of the example through the code below, if the recording is fresh. It sends nothing.
  const replay = useReplay({
    idle: state.phase === 'idle' && task === '',
    start: (recorded) => {
      setReplaying(true)
      setTask(recorded)
      return planAndRun(recorded)
    },
    clear: () => {
      setReplaying(false)
      setTask('')
      reset()
    },
  })

  /** Anything the visitor starts ends the replay first, so its requests go to the server and never to the recording. */
  const ownRun = (start: () => void) => () => {
    replay.stop()
    setReplaying(false)
    start()
  }
  const plan = ownRun(() => void planAndRun(task.trim()))
  const runLive = ownRun(() => {
    if (replay.info) void planAndRun(replay.info.task)
  })
  const editTask = () => {
    const field = document.getElementById('task-input') as HTMLTextAreaElement | null
    field?.focus()
    field?.select()
  }

  // On a phone the replay sits below the controls: the hook scrolls it into view and focuses its heading when a run ends.
  useResultFocus(FOCUS_PHASE[state.phase], { onRunStart: (narrow) => narrow && setCollapseKey((n) => n + 1), replay: replaying })

  return (
    <div className="ds-app" data-run={FOCUS_PHASE[state.phase] === 'running' ? 'running' : FOCUS_PHASE[state.phase]} data-replay={replaying ? 'true' : undefined}>
      <Header state={state} replaying={replaying} />

      <main className="ds-main">
        <div className="ds-intro">
          <HowTo
            phase={state.phase}
            runId={state.runId}
            onTry={ownRun(() => void runExample(setTask, planAndRun))}
          />
          <HnPanel page={frontPage.page} onReload={frontPage.reload} />
        </div>
        <div className="ds-bench">
          <div className="ds-controls" data-scrolled={railScrolled ? 'true' : undefined} onScroll={(event) => setRailScrolled(event.currentTarget.scrollTop > 4)}>
            <TaskPanel task={task} busy={busy} collapseKey={collapseKey} onTaskChange={setTask} onSubmit={plan} />
            <RunControls
              task={task}
              phase={state.phase}
              canRunAgain={state.steps.length > 0}
              onPlan={plan}
              onStop={() => {
                replay.stop()
                stop()
              }}
              onRunAgain={ownRun(runAgain)}
              onReset={() => {
                replay.stop()
                setReplaying(false)
                reset()
                document.getElementById('task-input')?.focus({ preventScroll: true })
              }}
            />
            <AllowlistPanel />
          </div>

          <div className="ds-run">
            {replaying && replay.info ? <ReplayLabel info={replay.info} onRunLive={runLive} /> : null}
            <ResultCard state={state} onPlan={plan} onRunAgain={ownRun(runAgain)} onEditTask={editTask} />
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
