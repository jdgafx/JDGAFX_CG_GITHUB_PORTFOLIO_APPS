import { milliseconds, usd } from '../lib/format'
import type { LatestRun, TraceStep } from '../types'

type Row = { step: TraceStep; running: boolean }

const WORD = { ok: 'Done', failed: 'Failed', skipped: 'Skipped', running: 'Running' } as const
const DOT = { ok: 'ds-dot--ok', failed: 'ds-dot--failed', skipped: 'ds-dot--skipped', running: 'ds-dot--running' } as const

/** Lanes for the waterfall: each step starts where the one before it ended, on one shared time axis. */
function lanes(rows: Row[]): Array<{ left: number; width: number } | null> {
  const spent = rows.reduce((sum, row) => sum + (row.step.ms ?? 0), 0)
  const axis = Math.max(spent, 1) * (rows.some(row => row.running) ? 1.15 : 1)
  let at = 0
  return rows.map(({ step, running }) => {
    const left = (at / axis) * 100
    at += step.ms ?? 0
    if (running) return { left, width: Math.max(100 - left, 2) * 0.12 }
    if (step.ms === null || step.status === 'skipped') return null
    return { left, width: Math.max((step.ms / axis) * 100, 0.8) }
  })
}

interface RunTraceProps {
  running: boolean
  pending: string | null
  liveTrace: TraceStep[]
  latest: LatestRun | null
}

/** Every step of the latest question as a waterfall: the browser's ranking first, then the server's steps. */
export function RunTrace({ running, pending, liveTrace, latest }: RunTraceProps) {
  const steps = running ? liveTrace : (latest?.report.trace ?? [])
  const rows: Row[] = steps.map(step => ({ step, running: false }))
  if (running && pending) {
    rows.push({ step: { name: pending, status: 'ok', ms: null, detail: 'Waiting for this step to finish.' }, running: true })
  }
  const lane = lanes(rows)

  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Bars show when each step ran. A retried model call is listed as its own step.</p>
      </div>
      {rows.length === 0 ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No steps yet</p>
          <p className="ds-state__body">Ask a question to see each step, how long it took, and the tokens and cost it used.</p>
        </div>
      ) : (
        <ol className="ds-trace" aria-label="Run steps">
          {rows.map(({ step, running: live }, i) => {
            const state = live ? 'running' : step.status
            return (
              <li
                key={`${step.name}-${i}`}
                className={live ? 'ds-trace__step ds-trace__step--running' : step.status === 'failed' ? 'ds-trace__step ds-trace__step--failed' : 'ds-trace__step'}
              >
                <span className="ds-trace__index">{i + 1}</span>
                <div>
                  <div className="ds-trace__head">
                    <span className="ds-trace__name">{step.name}</span>
                    <span className={`ds-trace__state ds-trace__state--${state}`}>
                      <span className={`ds-dot ${DOT[state]}`} aria-hidden="true" />
                      {WORD[state]}
                    </span>
                  </div>
                  <div className="ds-trace__detail">{step.detail}</div>
                </div>
                <div className="ds-trace__meta">
                  <span>{live ? 'in progress' : step.status === 'skipped' ? 'not run' : step.ms === null ? 'not timed' : milliseconds(step.ms)}</span>
                  {typeof step.tokens === 'number' && <span>{`${step.tokens.toLocaleString('en-US')} tok`}</span>}
                  {typeof step.cost === 'number' && <span>{usd(step.cost)}</span>}
                </div>
                {lane[i] && (
                  <div className="ds-trace__lane" aria-hidden="true">
                    <div
                      className={live ? 'ds-trace__bar ds-trace__bar--live' : 'ds-trace__bar'}
                      style={{ left: `${lane[i].left}%`, width: `${lane[i].width}%` }}
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
