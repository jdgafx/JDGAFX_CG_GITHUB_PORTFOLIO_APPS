import { formatUsd } from '../lib/usage'

export interface TraceRow {
  index: number
  name: string
  status: 'waiting' | 'running' | 'ok' | 'cut off' | 'failed' | 'skipped' | 'stopped'
  ms?: number
  detail: string
  tokens?: number
  cost?: number
}

const LABEL: Record<TraceRow['status'], string> = {
  waiting: 'Waiting',
  running: 'Running',
  ok: 'Finished',
  'cut off': 'Cut off',
  failed: 'Failed',
  skipped: 'Not run',
  stopped: 'Stopped',
}

const DOT: Record<TraceRow['status'], string> = {
  waiting: 'ds-dot',
  running: 'ds-dot ds-dot--running',
  ok: 'ds-dot ds-dot--ok',
  'cut off': 'ds-dot app-dot--warning',
  failed: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
  stopped: 'ds-dot app-dot--warning',
}

/** One numbered step per stage. The bar shows each stage's share of the time spent in stages. */
export function RunTrace({ rows }: { rows: TraceRow[] }) {
  const stageMs = rows.reduce((sum, row) => sum + (row.ms ?? 0), 0)

  return (
    <ol className="ds-trace">
      {rows.map(row => {
        const share = row.ms !== undefined && stageMs > 0 ? (row.ms / stageMs) * 100 : 0
        const finished = row.status === 'ok' || row.status === 'cut off'
        const running = row.status === 'running'
        return (
          <li key={row.index} className={running ? 'ds-trace__step ds-trace__step--running' : 'ds-trace__step'}>
            <span className="ds-trace__index">{row.index}</span>
            <div>
              <div className="ds-row">
                <span className="ds-trace__name">{row.name}</span>
                <span className="app-trace__status">
                  <span className={DOT[row.status]} aria-hidden="true" />
                  {LABEL[row.status]}
                </span>
              </div>
              <div className="ds-trace__detail">{row.detail}</div>
              {share > 0 && <div className="ds-trace__bar" style={{ width: `${share}%` }} aria-hidden="true" />}
            </div>
            <div className="ds-trace__meta">
              <div>{row.ms !== undefined ? `${row.ms.toLocaleString('en-US')} ms` : '-'}</div>
              {finished && (
                <div>{row.tokens !== undefined ? `${row.tokens.toLocaleString('en-US')} tokens` : 'tokens not reported'}</div>
              )}
              {finished && <div>{row.cost !== undefined ? formatUsd(row.cost) : 'cost not reported'}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
