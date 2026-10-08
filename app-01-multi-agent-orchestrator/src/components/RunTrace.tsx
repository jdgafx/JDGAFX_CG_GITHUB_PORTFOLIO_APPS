import { formatUsd } from '../lib/usage'

export interface TraceRow {
  index: number
  name: string
  status: 'waiting' | 'running' | 'ok' | 'failed' | 'skipped' | 'stopped'
  ms?: number
  detail: string
  tokens?: number
  cost?: number
}

const TONE: Record<TraceRow['status'], string> = {
  waiting: 'ds-badge',
  running: 'ds-badge ds-badge--accent',
  ok: 'ds-badge ds-badge--success',
  failed: 'ds-badge ds-badge--danger',
  skipped: 'ds-badge',
  stopped: 'ds-badge ds-badge--warning',
}

/** One step per stage. The bar shows each stage's share of the time spent in stages. */
export function RunTrace({ rows }: { rows: TraceRow[] }) {
  const stageMs = rows.reduce((sum, row) => sum + (row.ms ?? 0), 0)

  return (
    <ol className="ds-trace">
      {rows.map(row => {
        const share = row.ms !== undefined && stageMs > 0 ? (row.ms / stageMs) * 100 : 0
        return (
          <li key={row.index} className="ds-trace__step">
            <span className="ds-trace__index">{row.index}</span>
            <div>
              <div className="ds-row">
                <span className="ds-trace__name">{row.name}</span>
                <span className={TONE[row.status]}>{row.status}</span>
              </div>
              <div className="ds-trace__detail">{row.detail}</div>
              {share > 0 && <div className="ds-trace__bar" style={{ width: `${share}%` }} aria-hidden="true" />}
            </div>
            <div className="ds-trace__meta">
              <div>{row.ms !== undefined ? `${row.ms.toLocaleString('en-US')} ms` : '-'}</div>
              {row.status === 'ok' && (
                <div>{row.tokens !== undefined ? `${row.tokens.toLocaleString('en-US')} tokens` : 'tokens not reported'}</div>
              )}
              {row.status === 'ok' && <div>{row.cost !== undefined ? formatUsd(row.cost) : 'cost not reported'}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
