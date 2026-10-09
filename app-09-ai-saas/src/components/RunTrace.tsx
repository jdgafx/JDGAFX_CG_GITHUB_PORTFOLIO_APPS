import { TRACE_STAGES, type TraceStep } from '../lib/api'
import type { RunStatus } from '../lib/insightRun'

type RowState = TraceStep['status'] | 'running' | 'stopped' | 'notRun' | 'waiting'

interface Row {
  name: string
  state: RowState
  detail: string
  ms?: number
  tokens?: number
}

const DOT: Record<RowState, string> = {
  ok: 'ds-dot ds-dot--ok',
  failed: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
  running: 'ds-dot ds-dot--running',
  stopped: 'ds-dot ds-dot--skipped',
  notRun: 'ds-dot ds-dot--skipped',
  waiting: 'ds-dot',
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

/**
 * One row per stage, in the server's order. A received step is matched by name. A stage not yet received is
 * waiting before a run, running or stopped at the point the run is at, and not run after that.
 */
function buildRows(steps: TraceStep[], status: RunStatus, partialAnswer: boolean): Row[] {
  const firstOpen = TRACE_STAGES.find((stage) => !steps.some((step) => step.name === stage.name))?.name
  const rows: Row[] = TRACE_STAGES.map((stage): Row => {
    const step = steps.find((candidate) => candidate.name === stage.name)
    if (step) return { name: stage.name, state: step.status, detail: step.detail, ms: step.ms, tokens: step.tokens }
    if (status === 'idle') return { name: stage.name, state: 'waiting', detail: stage.does }
    if (stage.name === firstOpen && status === 'running') {
      return { name: stage.name, state: 'running', detail: 'In progress' }
    }
    if (stage.name === firstOpen && status === 'stopped') {
      const streaming = stage.name === 'Stream answer' && partialAnswer
      return {
        name: stage.name,
        state: 'stopped',
        detail: streaming ? 'Stopped while the answer was streaming. The text that arrived is kept.' : 'Stopped before this stage ran',
      }
    }
    return { name: stage.name, state: 'notRun', detail: 'Not run' }
  })

  // A stage name this page does not know is still shown, after the five stages, rather than dropped.
  for (const step of steps) {
    if (!TRACE_STAGES.some((stage) => stage.name === step.name)) {
      rows.push({ name: step.name, state: step.status, detail: step.detail, ms: step.ms, tokens: step.tokens })
    }
  }
  return rows
}

interface RunTraceProps {
  steps: TraceStep[]
  status: RunStatus
  /** True when some of the answer arrived, so a stop during streaming can say so. */
  partialAnswer: boolean
}

/** The stages of one run, in order. Before a run each row says what its stage does; then the server's own timings. */
export default function RunTrace({ steps, status, partialAnswer }: RunTraceProps) {
  const rows = buildRows(steps, status, partialAnswer)
  const totalMs = rows.reduce((sum, row) => sum + (row.ms ?? 0), 0)

  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">The five stages in order, each timed on the server. Rows fill in as the run goes.</p>
      </div>
      <ol className="ds-trace">
        {rows.map((row, i) => (
          <li
            key={row.name}
            className={row.state === 'running' ? 'ds-trace__step ds-trace__step--running' : 'ds-trace__step'}
          >
            <span className="ds-trace__index">{i + 1}</span>
            <div className="hub-trace__body">
              <div className="ds-row">
                <span className="ds-trace__name">{row.name}</span>
                <span className={`hub-state hub-state--${row.state}`}>
                  <span className={DOT[row.state]} aria-hidden="true" />
                  {WORD[row.state]}
                </span>
              </div>
              <p className="ds-trace__detail">{row.detail}</p>
              {row.ms !== undefined && row.ms > 0 && totalMs > 0 && (
                <div className="ds-trace__bar" style={{ width: `${(row.ms / totalMs) * 100}%` }} aria-hidden="true" />
              )}
            </div>
            <span className="ds-trace__meta">
              {row.ms !== undefined && `${row.ms} ms`}
              {row.tokens !== undefined && <span className="hub-trace__extra">{row.tokens.toLocaleString()} tokens</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
