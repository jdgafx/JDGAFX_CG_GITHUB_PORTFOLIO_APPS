import { formatCost, formatMs, formatTokens } from '../lib/format'
import type { Phase, RunView } from '../lib/run-state'
import type { NodeName, TraceRow } from '../types'

/** Where each finished step sat on the run's timeline, as percentages. Steps run one after another. */
export function lanesOf(rows: readonly TraceRow[]): Array<{ left: number; width: number } | null> {
  const total = rows.reduce((sum, row) => sum + (row.status === 'skipped' || row.status === 'pending' ? 0 : row.ms), 0)
  let at = 0
  return rows.map((row) => {
    if (row.status === 'skipped' || row.status === 'pending' || total === 0) return null
    const lane = { left: (at / total) * 100, width: Math.max((row.ms / total) * 100, 1.5) }
    at += row.ms
    return lane
  })
}

const STATE: Record<TraceRow['status'], { word: string; mod: string; dot: string }> = {
  ok: { word: 'Done', mod: 'ok', dot: 'ds-dot--ok' },
  failed: { word: 'Failed', mod: 'failed', dot: 'ds-dot--failed' },
  skipped: { word: 'Skipped', mod: 'ok', dot: 'ds-dot--skipped' },
  pending: { word: 'Waiting', mod: 'ok', dot: 'ds-dot--paused' },
}

interface TraceCardProps {
  run: RunView
  current: NodeName | null
  phase: Phase
}

/** The steps in the order they ran. The step in progress shows at the end until it finishes. */
export function TraceCard({ run, current, phase }: TraceCardProps) {
  const rows = run.trace
  const lanes = lanesOf(rows)
  const stoppedNode = (Object.keys(run.nodes) as NodeName[]).find((name) => run.nodes[name] === 'stopped') ?? null
  const empty = rows.length === 0 && current === null && stoppedNode === null
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Bars show how long each step took. Steps run one after another, in this order.</p>
      </div>
      {empty ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No steps yet</p>
          <p className="ds-state__body">Triage an issue to see each step, how long it took, and the model, tokens and cost it used.</p>
        </div>
      ) : (
        <ol className="ds-trace" aria-label="Run steps in order">
          {rows.map((row, index) => {
            const state = STATE[row.status]
            const lane = lanes[index]
            const stopped = phase === 'stopped' && row.status === 'failed'
            return (
              <li key={`${row.node}-${index}`} className={row.status === 'failed' ? 'ds-trace__step ds-trace__step--failed' : 'ds-trace__step'}>
                <span className="ds-trace__index">{index + 1}</span>
                <div>
                  <div className="ds-trace__head">
                    <span className="ds-trace__name">{row.node}</span>
                    <span className={`ds-trace__state ds-trace__state--${stopped ? 'stopped' : state.mod}`}>
                      <span className={`ds-dot ${state.dot}`} aria-hidden="true" />
                      {state.word}
                    </span>
                  </div>
                  <div className="ds-trace__detail">{row.detail}</div>
                </div>
                <div className="ds-trace__meta">
                  <span>{formatMs(row.ms)}</span>
                  {row.usage?.total_tokens !== undefined ? <span>{formatTokens(row.usage.total_tokens)} tok</span> : null}
                  {row.cost !== undefined ? <span>{formatCost(row.cost, row.costSource)}</span> : null}
                  {row.model ? (
                    <span className="ds-chip" title={row.model}>
                      {row.model.replace(/^anthropic\//, '')}
                    </span>
                  ) : null}
                </div>
                {lane ? (
                  <div className="ds-trace__lane" aria-hidden="true">
                    <div className="ds-trace__bar" style={{ left: `${lane.left}%`, width: `${lane.width}%` }} />
                  </div>
                ) : null}
              </li>
            )
          })}
          {stoppedNode !== null ? (
            <li className="ds-trace__step ds-trace__step--stopped">
              <span className="ds-trace__index">{rows.length + 1}</span>
              <div>
                <div className="ds-trace__head">
                  <span className="ds-trace__name">{stoppedNode}</span>
                  <span className="ds-trace__state ds-trace__state--stopped">
                    <span className="ds-dot ds-dot--stopped" aria-hidden="true" />
                    Stopped
                  </span>
                </div>
                <div className="ds-trace__detail">You stopped waiting during this step. The server may still have finished it.</div>
              </div>
              <div className="ds-trace__meta" />
            </li>
          ) : null}
          {current !== null ? (
            <li className="ds-trace__step ds-trace__step--running">
              <span className="ds-trace__index">{rows.length + 1}</span>
              <div>
                <div className="ds-trace__head">
                  <span className="ds-trace__name">{current}</span>
                  <span className="ds-trace__state ds-trace__state--running">
                    <span className="ds-dot ds-dot--running" aria-hidden="true" />
                    Running
                  </span>
                </div>
                <div className="ds-trace__detail">{current === 'duplicates' ? 'Searching GitHub, then waiting for the model to judge the top candidates' : 'Running now'}</div>
              </div>
              <div className="ds-trace__meta" />
            </li>
          ) : null}
        </ol>
      )}
    </section>
  )
}
