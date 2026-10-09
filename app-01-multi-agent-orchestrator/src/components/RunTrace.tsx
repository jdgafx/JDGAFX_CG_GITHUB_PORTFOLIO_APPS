import { milliseconds } from '../lib/format'
import type { Mark } from '../lib/graphLayout'
import { laneFor, type TraceRow } from '../lib/traceRows'

const DOT: Record<Mark, string> = {
  idle: 'ds-dot--skipped',
  active: 'ds-dot--running',
  ok: 'ds-dot--ok',
  warn: 'ds-dot--stopped',
  failed: 'ds-dot--failed',
  skipped: 'ds-dot--skipped',
  stopped: 'ds-dot--stopped',
}

const STATE: Record<Mark, string> = {
  idle: '',
  active: 'ds-trace__state--running',
  ok: 'ds-trace__state--ok',
  warn: 'ds-trace__state--stopped',
  failed: 'ds-trace__state--failed',
  skipped: '',
  stopped: 'ds-trace__state--stopped',
}

function rowClass(mark: Mark): string {
  if (mark === 'active') return 'ds-trace__step ds-trace__step--running'
  if (mark === 'failed') return 'ds-trace__step ds-trace__step--failed'
  if (mark === 'stopped' || mark === 'warn') return 'ds-trace__step ds-trace__step--stopped'
  return 'ds-trace__step'
}

/** One numbered step per box in the graph, with a waterfall lane showing when each ran. */
export function RunTrace({ rows }: { rows: TraceRow[] }) {
  const lanes = laneFor(rows)
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Timed on the server, one line per step. Bars show when each step ran; the audit starts when the report is done.</p>
      </div>
      <ol className="ds-trace">
        {rows.map((row, i) => {
          const lane = lanes[i]
          return (
            <li key={row.id} className={rowClass(row.mark)}>
              <span className="ds-trace__index">{row.index}</span>
              <div>
                <div className="ds-trace__head">
                  <span className="ds-trace__name">{row.name}</span>
                  <span className={`ds-trace__state ${STATE[row.mark]}`}>
                    <span className={`ds-dot ${DOT[row.mark]}`} aria-hidden="true" />
                    {row.word}
                  </span>
                </div>
                <div className="ds-trace__detail">{row.detail}</div>
              </div>
              <div className="ds-trace__meta">
                <span>{row.ms !== undefined ? milliseconds(row.ms) : '—'}</span>
                {row.meta.map(line => (
                  <span key={line}>{line}</span>
                ))}
              </div>
              {lane && (
                <div className="ds-trace__lane" aria-hidden="true">
                  <div className={row.mark === 'active' ? 'ds-trace__bar ds-trace__bar--live' : 'ds-trace__bar'} style={{ left: `${lane.left}%`, width: `${lane.width}%` }} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
