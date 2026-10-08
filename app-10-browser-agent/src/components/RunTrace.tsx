import { formatMs, type TraceRow } from '../lib/trace'

const BADGE: Record<TraceRow['status'], string> = {
  ok: 'ds-badge ds-badge--success',
  failed: 'ds-badge ds-badge--danger',
  skipped: 'ds-badge',
  waiting: 'ds-badge',
  running: 'ds-badge ds-badge--accent',
}

interface RunTraceProps {
  rows: TraceRow[]
  summary: string
}

export default function RunTrace({ rows, summary }: RunTraceProps) {
  // Bars are scaled to the slowest measured row, so their lengths compare real durations.
  const slowest = Math.max(0, ...rows.map((row) => row.ms ?? 0))

  return (
    <section className="ds-card" aria-labelledby="trace-heading">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="trace-heading">Run trace</h2>
        <span className="ds-hint">Planner first, then the browser. Times are measured on the server.</span>
      </div>
      <div className="ds-stack">
        <p className="ds-hint" role="status" aria-live="polite">{summary}</p>
        {rows.length === 0 ? (
          <div className="ds-empty">No run yet. Enter a task to see each planned step and what the browser observed.</div>
        ) : (
          <ol className="ds-trace" aria-label="Run trace steps">
            {rows.map((row, i) => {
              const measured = row.status === 'ok' || row.status === 'failed'
              return (
                <li
                  key={row.key}
                  className={`ds-trace__step${row.status === 'failed' ? ' bb-step--failed' : ''}${row.status === 'running' ? ' bb-step--running' : ''}`}
                >
                  <span className="ds-trace__index">{String(i + 1).padStart(2, '0')}</span>
                  <div className="bb-step__body">
                    <div className="ds-trace__name">{row.name}</div>
                    {row.planned && <div className="ds-trace__detail">Plan: {row.planned}</div>}
                    <div className="ds-trace__detail">{row.detail}</div>
                    {row.observed && <div className="ds-trace__detail ds-mono">Page: {row.observed.url}</div>}
                    {measured && row.ms !== null && slowest > 0 && (
                      <div
                        className="ds-trace__bar"
                        aria-hidden="true"
                        style={{ width: `${Math.max(2, (row.ms / slowest) * 100)}%` }}
                      />
                    )}
                  </div>
                  <div className="ds-trace__meta">
                    <span className={BADGE[row.status]}>{row.status}</span>
                    <div>{measured && row.ms !== null ? formatMs(row.ms) : '—'}</div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
