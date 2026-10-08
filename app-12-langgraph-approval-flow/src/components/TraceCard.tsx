import { formatCost, formatMs, formatTokens } from '../lib/format'
import type { RunView } from '../lib/run-state'
import { totalsOf } from '../lib/totals'
import type { TraceRow } from '../types'

function rowMeta(row: TraceRow): string[] {
  if (row.status === 'skipped') return ['skipped']
  const parts = [formatMs(row.ms)]
  if (row.model) parts.push(row.model)
  if (row.usage?.total_tokens !== undefined) parts.push(`${formatTokens(row.usage.total_tokens)} tokens`)
  if (row.cost !== undefined) parts.push(formatCost(row.cost, row.costSource))
  return parts
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ds-metric">
      <div className="ds-metric__label">{label}</div>
      <div className="ds-metric__value metric-value--small">{value}</div>
      {hint ? <div className="ds-metric__hint">{hint}</div> : null}
    </div>
  )
}

/** Each node's row: its time, served model, tokens and cost. Totals sit under the rows. */
export function TraceCard({ run }: { run: RunView }) {
  const totals = run.result?.totals ?? totalsOf(run.trace)
  const costValue = totals.cost === null ? 'not reported' : formatCost(totals.cost, totals.costSource ?? undefined)
  const modelValue = totals.models.length > 0 ? totals.models.join(', ') : 'not reported'

  return (
    <section className="ds-card" aria-labelledby="trace-heading">
      <div className="ds-card__head">
        <h2 id="trace-heading" className="ds-card__title">Run trace</h2>
        <span className="ds-hint">Time, model, tokens and cost for each node</span>
      </div>

      {run.trace.length === 0 ? (
        <div className="ds-empty">Nothing has run yet. The trace fills in as each node finishes.</div>
      ) : (
        <ol className="ds-trace">
          {run.trace.map((row, index) => (
            <li key={`${row.node}-${index}`} className="ds-trace__step">
              <span className="ds-trace__index">{index + 1}</span>
              <div>
                <div className="ds-trace__name">{row.node}</div>
                <div className="ds-trace__detail">{row.detail}</div>
              </div>
              <div className="ds-trace__meta">
                {rowMeta(row).map((part) => (
                  <div key={part}>{part}</div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="ds-metrics gg-metrics">
        <Metric label="Node time" value={formatMs(totals.nodeMs)} />
        <Metric label="Tokens" value={formatTokens(totals.tokens)} />
        <Metric label="Cost" value={costValue} hint={totals.costSource === 'estimated' ? 'From list prices' : undefined} />
        <Metric label="Served model" value={modelValue} />
      </div>
    </section>
  )
}
