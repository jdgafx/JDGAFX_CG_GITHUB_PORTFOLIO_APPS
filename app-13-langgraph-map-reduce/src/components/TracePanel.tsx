import type { TraceRow } from '../types/frames'
import { costNote, formatCost, formatMs, formatTokens } from '../lib/format'

function stepName(row: TraceRow): string {
  return row.node === 'extract' ? `extract, ${row.detail}` : row.node
}

function tokenText(row: TraceRow): string {
  return row.usage?.total_tokens !== undefined ? `${formatTokens(row.usage.total_tokens)} tokens` : 'no token count'
}

function costText(row: TraceRow): string {
  if (row.cost === undefined) return 'no cost'
  const note = costNote(row.costSource)
  return note ? `${formatCost(row.cost)} ${note}` : formatCost(row.cost)
}

export function TracePanel({ rows }: { rows: TraceRow[] }) {
  return (
    <section className="ds-card" aria-labelledby="trace-title">
      <div className="ds-card__head">
        <h2 id="trace-title" className="ds-card__title">
          Run trace
        </h2>
        <span className="ds-hint">one row per finished node</span>
      </div>
      {rows.length === 0 ? (
        <div className="ds-empty">Steps appear here as they finish.</div>
      ) : (
        <ol className="ds-trace" aria-label="Finished node runs">
          {rows.map((row, i) => (
            <li key={`${row.node}-${row.chunk ?? ''}-${i}`} className="ds-trace__step">
              <span className="ds-trace__index">{i + 1}</span>
              <div>
                <div className="ds-trace__name">{stepName(row)}</div>
                <div className="ds-trace__detail">
                  {row.status === 'failed' ? `Failed: ${row.message ?? row.detail}` : row.detail}
                </div>
              </div>
              <div className="ds-trace__meta">
                <div>{formatMs(row.ms)}</div>
                <div>{row.model ?? 'no model'}</div>
                <div>{tokenText(row)}</div>
                <div>{costText(row)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
