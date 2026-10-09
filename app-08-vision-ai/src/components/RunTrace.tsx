import type { StepStatus, TraceStep, RunSummary } from '../lib/api'
import { formatCount, formatMs, formatUsd } from '../lib/format'

const STEP_STATE: Record<StepStatus, { word: string; dot: string; tone: string }> = {
  running: { word: 'Running', dot: 'ds-dot--running', tone: 'ds-trace__state--running' },
  ok: { word: 'Done', dot: 'ds-dot--ok', tone: 'ds-trace__state--ok' },
  failed: { word: 'Failed', dot: 'ds-dot--failed', tone: 'ds-trace__state--failed' },
  skipped: { word: 'Skipped', dot: 'ds-dot--skipped', tone: '' },
  stopped: { word: 'Stopped', dot: 'ds-dot--stopped', tone: 'ds-trace__state--stopped' },
}

interface Lane {
  left: number
  width: number
}

/** Each finished step starts where the one before it ended, on one time axis, so the slow step is the long bar. */
export function lanesFor(steps: readonly TraceStep[], totalMs: number): (Lane | null)[] {
  const spent = steps.reduce((sum, step) => sum + (step.ms ?? 0), 0)
  const axis = Math.max(totalMs, spent, 1) * (steps.some(step => step.status === 'running') ? 1.15 : 1)
  let at = 0
  return steps.map(step => {
    const left = (at / axis) * 100
    at += step.ms ?? 0
    if (step.ms === undefined) return step.status === 'running' ? { left, width: Math.max(100 - left, 2) * 0.12 } : null
    return { left, width: Math.max((step.ms / axis) * 100, 0.8) }
  })
}

interface RunTraceProps {
  steps: TraceStep[]
  summary: RunSummary | null
}

export default function RunTrace({ steps, summary }: RunTraceProps) {
  const lanes = lanesFor(steps, summary?.totalMs ?? 0)

  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Bars show when each step ran.</p>
      </div>

      {steps.length === 0 ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No steps yet</p>
          <p className="ds-state__body">Run an analysis to see each step with its time, outcome, tokens and cost.</p>
        </div>
      ) : (
        <ol className="ds-trace">
          {steps.map((step, index) => {
            const state = STEP_STATE[step.status]
            const lane = lanes[index]
            const tone = step.status === 'running' || step.status === 'failed' || step.status === 'stopped' ? ` ds-trace__step--${step.status}` : ''
            return (
              <li key={`${step.name}-${index}`} className={`ds-trace__step${tone}`}>
                <span className="ds-trace__index">{index + 1}</span>
                <div>
                  <div className="ds-trace__head">
                    <span className="ds-trace__name">{step.name}</span>
                    <span className={`ds-trace__state ${state.tone}`}>
                      <span className={`ds-dot ${state.dot}`} aria-hidden="true" />
                      {state.word}
                    </span>
                  </div>
                  <div className="ds-trace__detail">{step.detail}</div>
                </div>
                <div className="ds-trace__meta">
                  <span>{step.ms === undefined ? '—' : formatMs(step.ms)}</span>
                  {step.tokens !== undefined && <span>{formatCount(step.tokens)} tok</span>}
                  {step.cost !== undefined && <span>{formatUsd(step.cost)}</span>}
                </div>
                {lane && (
                  <div className="ds-trace__lane" aria-hidden="true">
                    <div
                      className={step.status === 'running' ? 'ds-trace__bar ds-trace__bar--live' : 'ds-trace__bar'}
                      style={{ left: `${lane.left}%`, width: `${lane.width}%` }}
                    />
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
