import { formatCost, formatCount, formatMs } from '../lib/format'
import type { RunStep, RunView, StepStatus } from '../types'

const STATUS: Record<StepStatus, { word: string; dot: string; tone: string }> = {
  ok: { word: 'Done', dot: 'ds-dot--ok', tone: 'ds-trace__state--ok' },
  failed: { word: 'Failed', dot: 'ds-dot--failed', tone: 'ds-trace__state--failed' },
  skipped: { word: 'Skipped', dot: 'ds-dot--skipped', tone: '' },
}

/** Lanes for the waterfall: each step starts where the one before it ended, on one shared time axis. */
export function lanesFor(steps: RunStep[]): { left: number; width: number }[] {
  const axis = Math.max(1, steps.reduce((sum, step) => sum + step.ms, 0))
  let at = 0
  return steps.map((step) => {
    const left = (at / axis) * 100
    at += step.ms
    return { left, width: Math.max((step.ms / axis) * 100, 0.8) }
  })
}

function rowClass(step: RunStep, stopped: boolean): string {
  if (step.status === 'failed') return 'ds-trace__step ds-trace__step--failed'
  return stopped && step.status === 'skipped' ? 'ds-trace__step ds-trace__step--stopped' : 'ds-trace__step'
}

/** The steps of the run on screen as a waterfall. While the reply is in flight one live row stands in for them. */
export default function RunTrace({ run, running }: { run: RunView | null; running: boolean }) {
  const steps = run?.trace ?? []
  const lanes = lanesFor(steps)
  const stopped = run?.outcome === 'stopped'
  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">Agent run</h2>
        <p className="ds-section__sub">Bars show when each step ran. Steps that did not run are marked skipped.</p>
      </div>
      {running ? (
        <ol className="ds-trace" aria-label="Steps in this run">
          <li className="ds-trace__step ds-trace__step--running">
            <span className="ds-trace__index" aria-hidden="true">1</span>
            <div>
              <div className="ds-trace__head">
                <span className="ds-trace__name">Waiting for the reply</span>
                <span className="ds-trace__state ds-trace__state--running">
                  <span className="ds-dot ds-dot--running" aria-hidden="true" />
                  Running
                </span>
              </div>
              <div className="ds-trace__detail">The server sends every step when the reply arrives.</div>
            </div>
            <div className="ds-trace__lane" aria-hidden="true">
              <div className="ds-trace__bar ds-trace__bar--live" style={{ left: 0, width: '100%' }} />
            </div>
          </li>
        </ol>
      ) : steps.length === 0 ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No steps yet</p>
          <p className="ds-state__body">Each step appears here once a question runs, with its time and token use.</p>
        </div>
      ) : (
        <ol className="ds-trace" aria-label="Steps in this run">
          {steps.map((step, index) => {
            const status = STATUS[step.status]
            const lane = lanes[index]
            return (
              <li key={`${index}-${step.name}`} className={rowClass(step, stopped)}>
                <span className="ds-trace__index">{index + 1}</span>
                <div>
                  <div className="ds-trace__head">
                    <span className="ds-trace__name">{step.name}</span>
                    <span className={`ds-trace__state ${status.tone}`}>
                      <span className={`ds-dot ${status.dot}`} aria-hidden="true" />
                      {status.word}
                    </span>
                  </div>
                  <div className="ds-trace__detail">{step.detail}</div>
                </div>
                <div className="ds-trace__meta">
                  <span>{step.status === 'skipped' ? 'not run' : formatMs(step.ms)}</span>
                  {step.tokens !== undefined && <span>{formatCount(step.tokens)} tok</span>}
                  {step.cost !== undefined && <span>{formatCost(step.cost)}</span>}
                </div>
                {lane && step.status !== 'skipped' && (
                  <div className="ds-trace__lane" aria-hidden="true">
                    <div className="ds-trace__bar" style={{ left: `${lane.left}%`, width: `${lane.width}%` }} />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
