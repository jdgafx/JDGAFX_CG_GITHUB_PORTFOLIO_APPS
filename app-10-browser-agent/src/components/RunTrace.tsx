import { formatMs, lanesFor, type TraceRow } from '../lib/trace'

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
  const lanes = lanesFor(rows)
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-heading">
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="trace-heading">Run trace</h2>
        <p className="ds-section__sub">Bars show how long each step took, in the order they ran. Times are measured on the server.</p>
      </div>
      {rows.length > 0 && <p className="bb-status" role="status" aria-live="polite">{summary}</p>}
      {rows.length === 0 ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No steps yet</p>
          <p className="ds-state__body">Plan and run a task to see each step, how long it took and the page the browser was on.</p>
        </div>
      ) : (
        <ol className="ds-trace" aria-label="Run trace steps">
          {rows.map((row, i) => {
            const measured = row.status === 'ok' || row.status === 'failed'
            const lane = lanes[i]
            const classes = ['ds-trace__step']
            if (row.status === 'failed') classes.push('ds-trace__step--failed')
            if (row.status === 'running') classes.push('ds-trace__step--running')
            return (
              <li key={row.key} className={classes.join(' ')}>
                <span className="ds-trace__index">{i + 1}</span>
                <div>
                  <div className="ds-trace__head">
                    <span className="ds-trace__name">{row.name}</span>
                    <span className={row.status === 'skipped' || row.status === 'waiting' ? 'ds-trace__state' : `ds-trace__state ds-trace__state--${row.status}`}>
                      <span className={DOT[row.status]} aria-hidden="true" />
                      {WORD[row.status]}
                    </span>
                  </div>
                  <div className="ds-trace__detail">{row.detail}</div>
                  {row.observed && <div className="ds-trace__detail ds-mono">Page: {row.observed.url}</div>}
                </div>
                <div className="ds-trace__meta">
                  <span>{measured && row.ms !== null ? formatMs(row.ms) : '—'}</span>
                </div>
                {lane && (
                  <div className="ds-trace__lane" aria-hidden="true">
                    <div className="ds-trace__bar" style={{ left: `${lane.left}%`, width: `${lane.width}%` }} />
                  </div>
                )}
                {row.status === 'running' && (
                  <div className="ds-trace__lane" aria-hidden="true">
                    <div className="ds-trace__bar ds-trace__bar--live" style={{ left: '0%', width: '100%' }} />
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
