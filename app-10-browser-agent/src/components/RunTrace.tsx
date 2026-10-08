import { formatMs, type TraceRow } from '../lib/trace'

const BADGE: Record<TraceRow['status'], string> = {
  ok: 'ds-badge ds-badge--success',
  failed: 'ds-badge ds-badge--danger',
  skipped: 'ds-badge',
  waiting: 'ds-badge',
  running: 'ds-badge ds-badge--accent',
}

const DOT: Record<TraceRow['status'], string> = {
  ok: 'ds-dot ds-dot--ok',
  failed: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
  waiting: 'ds-dot',
  running: 'ds-dot ds-dot--running',
}

const WORD: Record<TraceRow['status'], string> = {
  ok: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  waiting: 'Waiting',
  running: 'Running',
}

interface RunTraceProps {
  rows: TraceRow[]
  summary: string
}

/** The run as a numbered sequence: planner stages first, then the browser stages and steps. */
export default function RunTrace({ rows, summary }: RunTraceProps) {
  // Bars are scaled to the slowest measured row, so their lengths compare real durations.
  const slowest = Math.max(0, ...rows.map((row) => row.ms ?? 0))

  return (
    <section className="ds-section" aria-labelledby="trace-heading">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="trace-heading">Run trace</h2>
        <p className="ds-section__sub">Planner first, then the browser. Times are measured on the server.</p>
      </div>
      <p className="bb-status" role="status" aria-live="polite">{summary}</p>
      {rows.length === 0 ? (
        <div className="ds-empty">No run yet. Enter a task to see each planned step and what the browser observed.</div>
      ) : (
        <ol className="ds-trace" aria-label="Run trace steps">
          {rows.map((row, i) => {
            const measured = row.status === 'ok' || row.status === 'failed'
            const classes = ['ds-trace__step']
            if (row.status === 'failed') classes.push('bb-step--failed')
            if (row.status === 'running') classes.push('ds-trace__step--running')
            return (
              <li key={row.key} className={classes.join(' ')}>
                <span className="ds-trace__index">{i + 1}</span>
                <div className="bb-step__body">
                  <div className="ds-trace__name">{row.name}</div>
                  {row.planned && <div className="ds-trace__detail">Plan: {row.planned}</div>}
                  <div className="ds-trace__detail">{row.detail}</div>
                  {row.observed && <div className="ds-trace__detail">Page: {row.observed.url}</div>}
                  {measured && row.ms !== null && slowest > 0 && (
                    <div
                      className="ds-trace__bar"
                      aria-hidden="true"
                      style={{ width: `${Math.max(2, (row.ms / slowest) * 100)}%` }}
                    />
                  )}
                </div>
                <div className="ds-trace__meta">
                  <span className={BADGE[row.status]}>
                    <span className={DOT[row.status]} aria-hidden="true" />
                    {WORD[row.status]}
                  </span>
                  <div>{measured && row.ms !== null ? formatMs(row.ms) : '—'}</div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
