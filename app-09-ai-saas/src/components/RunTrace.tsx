import type { TraceStep } from '../lib/api'
import type { RunStatus } from '../lib/insightRun'
import { buildRows, lanes, type RowState } from '../lib/traceRows'

const DOT: Record<RowState, string> = {
  ok: 'ds-dot--ok',
  failed: 'ds-dot--failed',
  skipped: 'ds-dot--skipped',
  running: 'ds-dot--running',
  stopped: 'ds-dot--stopped',
  notRun: 'ds-dot--skipped',
  waiting: 'ds-dot--skipped',
}

const WORD: Record<RowState, string> = {
  ok: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  running: 'Running',
  stopped: 'Stopped',
  notRun: 'Not run',
  waiting: 'Waiting',
}

interface RunTraceProps {
  steps: TraceStep[]
  status: RunStatus
  /** True when some of the answer arrived, so a stop during streaming can say so. */
  partialAnswer: boolean
}

/** The stages of one run as a waterfall: each bar sits where its stage started and is as long as it took. */
export default function RunTrace({ steps, status, partialAnswer }: RunTraceProps) {
  const rows = buildRows(steps, status, partialAnswer)
  const bars = lanes(rows)
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare ds-section__head--row">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Bars show when each step ran. Every step is timed on the server.</p>
      </div>
      <ol className="ds-trace">
        {rows.map((row, i) => {
          // A failed check or a cut-off answer on a finished run warns about the text; it is not a failed run, so it is amber.
          const soft = status === 'done' && row.state === 'failed' && (row.name === 'Check figures' || row.name === 'Validate output')
          const shown: RowState = soft ? 'stopped' : row.state
          const word = soft ? (row.name === 'Check figures' ? 'Check failed' : 'Cut off') : WORD[row.state]
          return (
          <li key={row.name} className={shown === 'running' || shown === 'failed' || shown === 'stopped' ? `ds-trace__step ds-trace__step--${shown}` : 'ds-trace__step'}>
            <span className="ds-trace__index">{i + 1}</span>
            <div>
              <div className="ds-trace__head">
                <span className="ds-trace__name">{row.name}</span>
                <span className={`ds-trace__state ds-trace__state--${shown}`}>
                  <span className={`ds-dot ${DOT[shown]}`} aria-hidden="true" />
                  {word}
                </span>
              </div>
              <p className="ds-trace__detail">{row.detail}</p>
            </div>
            <div className="ds-trace__meta">
              {row.ms !== undefined && <span>{row.ms.toLocaleString('en-US')} ms</span>}
              {row.tokens !== undefined && <span>{row.tokens.toLocaleString('en-US')} tok</span>}
            </div>
            {bars[i] && (
              <div className="ds-trace__lane" aria-hidden="true">
                <div className={row.state === 'running' ? 'ds-trace__bar ds-trace__bar--live' : 'ds-trace__bar'} style={{ left: `${bars[i].left}%`, width: `${bars[i].width}%` }} />
              </div>
            )}
          </li>
          )
        })}
      </ol>
    </section>
  )
}
