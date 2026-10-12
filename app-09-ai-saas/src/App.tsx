import { useEffect, useRef } from 'react'
import { figureNumbers, fillCode, judge, validateShape } from '../shared/claims'
import { computeFacts } from '../shared/aggregates'
import { buildPastRows } from '../shared/modelInput'
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
import UnusualTable from './components/UnusualTable'
import { shownList } from './lib/labels'
import { useRun, type Core, type RunDeps } from './lib/useRun'

const CORE: Core = { computeWindow, computeFacts, judge, topUnusual, buildPastRows, figureNumbers, fillCode, validateShape }

/** `deps` lets a test supply its own fetches and clock; the page itself passes none. */
export default function App({ deps }: { deps?: Partial<RunDeps> }) {
  const r = useRun({ core: CORE, ...deps })
  const { run, view } = r
  const core = deps?.core ?? CORE
  const snap = run.snapshot
  const targets = snap ? snap.names.filter(n => Object.hasOwn(snap.rowsByName, n)) : []
  const packages = targets.map(name => ({ name, outcome: run.outcomes[name] ?? ({ status: 'pending' } as const) }))
  const allFailed = run.phase === 'done' && packages.length > 0 && packages.every(p => p.outcome.status === 'error')
  const phase = run.phase === 'idle' ? 'idle' : run.phase === 'running' ? 'running' : allFailed ? 'failed' : 'done'

  // When a run ends, focus moves to the explanation heading.
  const before = useRef(run.phase)
  useEffect(() => {
    if (before.current === 'running' && run.phase === 'done') document.getElementById('explanation-title')?.focus()
    before.current = run.phase
  }, [run.phase])

  const figures = snap?.window ? core.figureNumbers(shownList(packages).map(s => s.judged.map(j => j.seg))) : []

  return (
    <div className="ds-app" data-run={phase}>
      <Header phase={phase} live={liveState(r.liveSlots.downloads, r.liveSlots.releases)} />
      <main className="ds-main">
        <HowTo hasResult={run.phase === 'done'} disabled={!r.canStart} onTry={r.tryIt} />
        <div className="ds-bench">
          <Controls
            names={r.names}
            days={r.days}
            busy={run.phase === 'running'}
            canRun={r.canRun}
            onAdd={r.addName}
            onRemove={r.removeName}
            onPreset={r.setPreset}
            onDays={r.setDays}
            onExplain={r.explain}
          />
          <div className="ds-run">
            {run.phase !== 'idle' && snap && (
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
