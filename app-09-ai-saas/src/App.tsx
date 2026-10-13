import { useEffect, useRef, useState } from 'react'
import { figureNumbers, fillCode, judge, validateShape } from '../shared/claims'
import { computeFacts } from '../shared/aggregates'
import { buildPastRows } from '../shared/modelInput'
import type { Day } from '../shared/types'
import { topUnusual } from '../shared/unusual'
import { computeWindow } from '../shared/window'
import Charts from './components/Charts'
import Controls from './components/Controls'
import Explanation from './components/Explanation'
import FigureCheck from './components/FigureCheck'
import Header from './components/Header'
import HowTo from './components/HowTo'
import { liveState } from './components/LiveChip'
import Metrics from './components/Metrics'
import Notices from './components/Notices'
import Readout from './components/Readout'
import { ReplayLabel } from './components/ReplayLabel'
import UnusualTable from './components/UnusualTable'
import { shownList } from './lib/labels'
import { todayUtc } from './lib/npmClient'
import { useReplay } from './lib/useReplay'
import { postExplain, TRY_IT, useRun, type Core, type RunDeps } from './lib/useRun'
import { useResultFocus } from './replay'

const CORE: Core = { computeWindow, computeFacts, judge, topUnusual, buildPastRows, figureNumbers, fillCode, validateShape }

/** `deps` lets a test supply its own fetches and clock; the page itself passes none. */
export default function App({ deps }: { deps?: Partial<RunDeps> }) {
  /** The day a replay is pinned to while it plays: the downloads are npm's for the day the run was recorded, so its figures still hold. */
  const pinned = useRef<Day | null>(null)
  /** Set when a replay could not be answered from its recording: the failure that follows is not the visitor's, so the screen resets instead. */
  const diverged = useRef(false)
  const today = deps?.today ?? todayUtc
  const post = deps?.postExplain ?? postExplain
  const r = useRun({
    core: CORE,
    ...deps,
    today: () => pinned.current ?? today(),
    // Once a replay has lost its recording the shim is gone, so an explanation request would be a real model call nobody asked for.
    postExplain: (req, signal) => (diverged.current ? Promise.reject(new TypeError('Failed to fetch')) : post(req, signal)),
  })
  const { run, view } = r
  /** True while the result on screen is the load-time replay, until Run it live or a run of the visitor's own replaces it. */
  const [replaying, setReplaying] = useState(false)
  const core = deps?.core ?? CORE
  const snap = run.snapshot
  const targets = snap ? snap.names.filter(n => Object.hasOwn(snap.rowsByName, n)) : []
  const packages = targets.map(name => ({ name, outcome: run.outcomes[name] ?? ({ status: 'pending' } as const) }))
  // No explanation could be asked for (no window: npm blocked, no recent days) is a failed run as much as every call failing.
  const allFailed = run.phase === 'done' && (snap?.window == null || (packages.length > 0 && packages.every(p => p.outcome.status === 'error')))
  const phase = run.phase === 'idle' ? 'idle' : run.phase === 'running' ? 'running' : allFailed ? 'failed' : 'done'

  // When a run ends, focus moves to the explanation heading; on a phone the result scrolls into view, except after the load-time replay.
  useResultFocus(phase, { replay: replaying })

  // On load, plays back the stored real run of the Try it comparison through the code above, if it is fresh and is of this comparison.
  const sameComparison = r.names.length === TRY_IT.names.length && r.names.every((n, i) => n === TRY_IT.names[i]) && r.days === TRY_IT.days
  const replay = useReplay({
    ready: r.canRun && run.phase === 'idle' && sameComparison,
    start: runDate => {
      pinned.current = runDate
      setReplaying(true)
      r.tryIt()
    },
    clear: () => {
      diverged.current = true
      pinned.current = null
      setReplaying(false)
    },
  })
  const { reset } = r
  useEffect(() => {
    if (diverged.current && run.phase === 'done') {
      diverged.current = false
      reset()
    }
  }, [run.phase, reset])

  /** Anything the visitor does ends the replay and goes back to today's date. */
  const visitor =
    <A extends unknown[], T>(fn: (...args: A) => T) =>
    (...args: A): T => {
      replay.stop()
      pinned.current = null
      setReplaying(false)
      return fn(...args)
    }
  const runLive = visitor(r.tryIt)

  const figures = snap?.window ? core.figureNumbers(shownList(packages).map(s => s.judged.map(j => j.seg))) : []

  return (
    <div className="ds-app" data-run={phase}>
      <Header phase={phase} live={liveState(r.liveSlots.downloads, r.liveSlots.releases)} />
      <main className="ds-main">
        <HowTo hasResult={run.phase === 'done'} disabled={!r.canStart} onTry={runLive} />
        <div className="ds-bench">
          <Controls
            names={r.names}
            days={r.days}
            busy={run.phase === 'running'}
            canRun={r.canRun}
            onAdd={visitor(r.addName)}
            onRemove={visitor(r.removeName)}
            onPreset={visitor(r.setPreset)}
            onDays={visitor(r.setDays)}
            onExplain={visitor(r.explain)}
          />
          <div className="ds-run">
            {replaying && replay.info && run.phase !== 'idle' && <ReplayLabel info={replay.info} onRunLive={runLive} disabled={run.phase === 'running'} />}
            {run.phase !== 'idle' && snap && (snap.window || view === null) && (
              // With no window the same notices already show below, from the view: the run's copy only stands in until it exists.
              <div className="ds-run__result ds-stack">
                {snap.window ? (
                  <>
                    <Explanation names={targets} window={snap.window} packages={packages} facts={snap.facts} figures={figures} />
                    {run.phase === 'done' && <FigureCheck window={snap.window} packages={packages} facts={snap.facts} figures={figures} rowsByName={snap.rowsByName} />}
                  </>
                ) : (
                  <Notices view={snap} />
                )}
              </div>
            )}
            {run.phase !== 'idle' && (
              <div className="ds-run__readout">
                <Readout run={run} />
              </div>
            )}
            <div className="ds-run__stage ds-stack" aria-busy={view === null && r.names.length > 0}>
              {r.names.length === 0 && <p className="ds-empty">Add a package to see its downloads.</p>}
              {r.names.length > 0 && view === null && (
                <div className="ds-state ds-state--loading" role="status">
                  <span className="ds-state__mark" aria-hidden="true" />
                  <p className="ds-state__title">Loading</p>
                  <p className="ds-state__body">Fetching downloads and release history from npm.</p>
                </div>
              )}
              {view && <Notices view={view} />}
              {view?.window && (
                <>
                  <Metrics facts={view.facts} window={view.window} />
                  <Charts names={view.names} window={view.window} rowsByName={view.rowsByName} facts={view.facts} releases={view.releases} releaseState={view.releaseState} />
                  <UnusualTable facts={view.facts} />
                </>
              )}
            </div>
          </div>
        </div>
      </main>
      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
