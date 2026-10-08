import { formatCost, formatMs, formatTokens } from '../lib/format'
import type { RunView } from '../lib/run-state'
import type { NodeName, TraceRow } from '../types'

interface MetaPart {
  text: string
  code?: boolean
  dot?: string
}

/** One step's figures: its state when that is not plain success, then time, model, tokens and cost. */
function rowMeta(row: TraceRow): MetaPart[] {
  if (row.status === 'skipped') return [{ text: 'skipped', dot: 'ds-dot--skipped' }]
  const parts: MetaPart[] = []
  if (row.status === 'failed') parts.push({ text: 'failed', dot: 'ds-dot--failed' })
  parts.push({ text: formatMs(row.ms) })
  if (row.model) parts.push({ text: row.model, code: true })
  if (row.usage?.total_tokens !== undefined) parts.push({ text: `${formatTokens(row.usage.total_tokens)} tokens` })
  if (row.cost !== undefined) parts.push({ text: formatCost(row.cost, row.costSource) })
  return parts
}

interface TraceCardProps {
  run: RunView
  current: NodeName | null
}

/** The steps in the order they ran. The step in progress shows at the end until it finishes. */
export function TraceCard({ run, current }: TraceCardProps) {
  const rows = run.trace
  const nothingYet = rows.length === 0 && current === null

  return (
    <section className="ds-section" aria-labelledby="trace-heading">
      <div className="ds-section__head">
        <h2 id="trace-heading" className="ds-section__title">
          Run trace
        </h2>
        <p className="ds-section__sub">Each step in the order it ran, with its time, model, tokens and cost.</p>
      </div>

      {nothingYet ? (
        <div className="ds-empty">No steps yet. Each step appears here as it finishes.</div>
      ) : (
        <ol className="ds-trace">
          {rows.map((row, index) => (
            <li key={`${row.node}-${index}`} className="ds-trace__step">
              <span className="ds-trace__index">{index + 1}</span>
              <div>
                <div className="ds-trace__name gg-code">{row.node}</div>
                <div className="ds-trace__detail">{row.detail}</div>
              </div>
              <div className="ds-trace__meta">
                {rowMeta(row).map((part, partIndex) => (
                  <div key={partIndex} className={part.code ? 'gg-code' : undefined}>
                    {part.dot ? <span className={`ds-dot ${part.dot}`} aria-hidden="true" /> : null}
                    {part.text}
                  </div>
                ))}
              </div>
            </li>
          ))}
          {current !== null ? (
            <li className="ds-trace__step ds-trace__step--running">
              <span className="ds-trace__index">{rows.length + 1}</span>
              <div>
                <div className="ds-trace__name gg-code">{current}</div>
                <div className="ds-trace__detail">Running now.</div>
              </div>
              <div className="ds-trace__meta">
                <div>
                  <span className="ds-dot ds-dot--running" aria-hidden="true" />
                  running
                </div>
              </div>
            </li>
          ) : null}
        </ol>
      )}
    </section>
  )
}
