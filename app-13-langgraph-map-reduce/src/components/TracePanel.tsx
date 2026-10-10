import { costNote, formatCost, formatMs, formatTokens } from '../lib/format'
import { laneFor } from '../lib/trace'
import type { RunView, StageName } from '../lib/view'
import type { TraceRow } from '../types/frames'

const STAGE_ORDER: StageName[] = ['split', 'reduce', 'synthesize', 'check', 'final']
const STAGE_TITLE: Record<StageName, string> = { split: 'Split', reduce: 'Reduce', synthesize: 'Synthesize', check: 'Check', final: 'Final' }
const MODEL_STAGES: ReadonlySet<StageName> = new Set<StageName>(['synthesize', 'check'])

interface ActiveStep {
  key: string
  name: string
  detail: string
}

function rowName(row: TraceRow): string {
  return row.node === 'extract' ? `Extract ${row.detail}` : STAGE_TITLE[row.node]
}

function rowDetail(row: TraceRow): string {
  if (row.status === 'failed') return row.message ?? row.detail
  return row.node === 'extract' ? 'Key points found' : row.detail
}

const tokenText = (row: TraceRow): string =>
  row.usage?.total_tokens !== undefined ? `${formatTokens(row.usage.total_tokens)} tok` : 'tokens not reported'

function costText(row: TraceRow): string {
  if (row.cost === undefined) return 'no cost reported'
  const note = costNote(row.costSource)
  return note ? `${formatCost(row.cost)} est.` : formatCost(row.cost)
}

/** Steps that have started but not finished, so the trace shows the run moving. */
function activeSteps(view: RunView): ActiveStep[] {
  const steps: ActiveStep[] = []
  for (const name of STAGE_ORDER) {
    if (view.stages[name] !== 'running') continue
    steps.push({ key: name, name: STAGE_TITLE[name], detail: MODEL_STAGES.has(name) ? 'Waiting for the model reply' : 'Local step, no model call' })
  }
  for (const branch of view.branches) {
    if (branch.status === 'running') steps.push({ key: `extract-${branch.chunk}`, name: `Extract ${branch.detail}`, detail: 'Waiting for the model reply' })
  }
  return steps
}

export function TracePanel({ view }: { view: RunView }) {
  const active = activeSteps(view)
  const lanes = laneFor(view.rows, view.starts, view.result?.metrics.totalMs ?? 0)
  const empty = view.rows.length === 0 && active.length === 0
  return (
    <section className="ds-section ds-run__trace" aria-labelledby="trace-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="trace-title" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Bars show when each step ran, so parallel chunks overlap. Steps still running appear at the end.</p>
      </div>
      {empty ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No steps yet</p>
          <p className="ds-state__body">Analyze a document to see each step, how long it took, and the model, tokens and cost it used.</p>
        </div>
      ) : (
        <ol className="ds-trace" aria-label="Run steps in order">
          {view.rows.map((row, i) => {
            const ok = row.status === 'ok'
            const lane = lanes[i]
            return (
              <li key={`${row.node}-${row.chunk ?? ''}-${i}`} className={ok ? 'ds-trace__step' : 'ds-trace__step ds-trace__step--failed'}>
                <span className="ds-trace__index">{i + 1}</span>
                <div>
                  <div className="ds-trace__head">
                    <span className="ds-trace__name">{rowName(row)}</span>
                    <span className={`ds-trace__state ds-trace__state--${ok ? 'ok' : 'failed'}`}>
                      <span className={`ds-dot ds-dot--${ok ? 'ok' : 'failed'}`} aria-hidden="true" />
                      {ok ? 'Done' : 'Failed'}
                    </span>
                  </div>
                  <div className="ds-trace__detail">{rowDetail(row)}</div>
                </div>
                <div className="ds-trace__meta">
                  <span>{formatMs(row.ms)}</span>
                  {row.model && <span>{tokenText(row)}</span>}
                  {row.model && <span>{costText(row)}</span>}
                  {row.model && (
                    <span className="ds-chip" title={row.model.replace(/^~/, '')}>
                      {row.model.replace(/^~?anthropic\//, '')}
                    </span>
                  )}
                </div>
                {lane && (
                  <div className="ds-trace__lane" aria-hidden="true">
                    <div className="ds-trace__bar" style={{ left: `${lane.left}%`, width: `${lane.width}%` }} />
                  </div>
                )}
              </li>
            )
          })}
          {active.map((step, j) => (
            <li key={step.key} className="ds-trace__step ds-trace__step--running">
              <span className="ds-trace__index">{view.rows.length + j + 1}</span>
              <div>
                <div className="ds-trace__head">
                  <span className="ds-trace__name">{step.name}</span>
                  <span className="ds-trace__state ds-trace__state--running">
                    <span className="ds-dot ds-dot--running" aria-hidden="true" />
                    Running
                  </span>
                </div>
                <div className="ds-trace__detail">{step.detail}</div>
              </div>
              <div className="ds-trace__meta" />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
