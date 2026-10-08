import { costNote, formatCost, formatMs, formatTokens } from '../lib/format'
import type { RunView, StageName } from '../lib/view'
import type { TraceRow } from '../types/frames'
import { STAGE_LABEL, dotClass } from './GraphNodes'

interface ActiveStep {
  key: string
  name: string
  detail: string
}

const STAGE_ORDER: StageName[] = ['split', 'reduce', 'synthesize', 'check', 'final']
const MODEL_STAGES: ReadonlySet<StageName> = new Set<StageName>(['synthesize', 'check'])

function rowName(row: TraceRow): string {
  return row.node === 'extract' ? `Extract ${row.detail}` : STAGE_LABEL[row.node]
}

function rowDetail(row: TraceRow): string {
  if (row.status === 'failed') return row.message ?? row.detail
  return row.node === 'extract' ? 'Key points found' : row.detail
}

function tokenText(row: TraceRow): string {
  return row.usage?.total_tokens !== undefined ? `${formatTokens(row.usage.total_tokens)} tokens` : 'Tokens not reported'
}

function costText(row: TraceRow): string {
  if (row.cost === undefined) return 'Cost not reported'
  const note = costNote(row.costSource)
  return note ? `${formatCost(row.cost)} ${note}` : formatCost(row.cost)
}

/** Steps that have started but not finished, so the trace shows the run moving. */
function activeSteps(view: RunView): ActiveStep[] {
  const steps: ActiveStep[] = []
  for (const name of STAGE_ORDER) {
    if (view.stages[name] !== 'running') continue
    steps.push({
      key: name,
      name: STAGE_LABEL[name],
      detail: MODEL_STAGES.has(name) ? 'Waiting for the model reply' : 'Local step, no model call',
    })
  }
  for (const branch of view.branches) {
    if (branch.status !== 'running') continue
    steps.push({ key: `extract-${branch.chunk}`, name: `Extract ${branch.detail}`, detail: 'Waiting for the model reply' })
  }
  return steps
}

function TraceRowItem({ index, row }: { index: number; row: TraceRow }) {
  const ok = row.status === 'ok'
  return (
    <li className="ds-trace__step">
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__name">{rowName(row)}</div>
        <div className="ds-trace__detail">
          <span className="trace-state">
            <span className={dotClass(ok ? 'ok' : 'failed')} aria-hidden="true" />
            {ok ? 'Done' : 'Failed'}
          </span>{' '}
          {rowDetail(row)}
        </div>
      </div>
      <div className="ds-trace__meta">
        <div>{formatMs(row.ms)}</div>
        <div className="model-id">{row.model ?? 'Model not reported'}</div>
        <div>{tokenText(row)}</div>
        <div>{costText(row)}</div>
      </div>
    </li>
  )
}

function ActiveRowItem({ index, step }: { index: number; step: ActiveStep }) {
  return (
    <li className="ds-trace__step ds-trace__step--running">
      <span className="ds-trace__index">{index}</span>
      <div>
        <div className="ds-trace__name">{step.name}</div>
        <div className="ds-trace__detail">
          <span className="trace-state">
            <span className={dotClass('running')} aria-hidden="true" />
            Running
          </span>{' '}
          {step.detail}
        </div>
      </div>
      <div className="ds-trace__meta" />
    </li>
  )
}

export function TracePanel({ view }: { view: RunView }) {
  const active = activeSteps(view)
  const empty = view.rows.length === 0 && active.length === 0
  return (
    <section className="ds-section" aria-labelledby="trace-title">
      <div className="ds-section__head">
        <h2 id="trace-title" className="ds-section__title">
          Trace
        </h2>
        <p className="ds-section__sub">
          One numbered row for each step as it finishes. Steps still running appear at the end.
        </p>
      </div>
      {empty ? (
        <p className="empty-note">Steps appear here as each one finishes. Load the sample and analyze it to see every step.</p>
      ) : (
        <ol className="ds-trace" aria-label="Run steps in order">
          {view.rows.map((row, i) => (
            <TraceRowItem key={`${row.node}-${row.chunk ?? ''}-${i}`} index={i + 1} row={row} />
          ))}
          {active.map((step, j) => (
            <ActiveRowItem key={step.key} index={view.rows.length + j + 1} step={step} />
          ))}
        </ol>
      )}
    </section>
  )
}
