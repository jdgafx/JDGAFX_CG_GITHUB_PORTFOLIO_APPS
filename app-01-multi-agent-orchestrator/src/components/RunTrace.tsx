import type { StatusView } from '../lib/agents'

export interface TraceRow {
  index: number
  name: string
  view: StatusView
  running: boolean
  ms?: number
  detail: string
  /** Lines on the right of a finished step: sources found, or tokens and cost. */
  meta: string[]
}

/** One numbered step per stage. The bar shows each stage's share of the time spent in stages. */
export function RunTrace({ rows }: { rows: TraceRow[] }) {
  const stageMs = rows.reduce((sum, row) => sum + (row.ms ?? 0), 0)

  return (
    <ol className="ds-trace">
      {rows.map(row => {
        const share = row.ms !== undefined && stageMs > 0 ? (row.ms / stageMs) * 100 : 0
        return (
          <li key={row.index} className={row.running ? 'ds-trace__step ds-trace__step--running' : 'ds-trace__step'}>
            <span className="ds-trace__index">{row.index}</span>
            <div>
              <div className="ds-row">
                <span className="ds-trace__name">{row.name}</span>
                <span className="app-trace__status">
                  <span className={row.view.dot} aria-hidden="true" />
                  {row.view.word}
                </span>
              </div>
              <div className="ds-trace__detail">{row.detail}</div>
              {share > 0 && <div className="ds-trace__bar" style={{ width: `${share}%` }} aria-hidden="true" />}
            </div>
            <div className="ds-trace__meta">
              <div>{row.ms !== undefined ? `${row.ms.toLocaleString('en-US')} ms` : '-'}</div>
              {row.meta.map(line => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
