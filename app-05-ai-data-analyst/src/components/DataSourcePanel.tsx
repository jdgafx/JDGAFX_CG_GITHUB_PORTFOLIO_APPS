import type { DatasetState } from '../hooks/useLiveDataset'
import type { DataSourceInfo } from '../types'

interface DataSourcePanelProps {
  state: DatasetState
  /** True while a question is running, so the data cannot change under it. */
  disabled: boolean
  onReload: () => void
}

/** The link text for a source: host and path, without the query string. */
function linkText(url: string): string {
  const { host, pathname } = new URL(url)
  return `${host}${pathname}`
}

function fetchedParts(at: Date): { time: string; date: string } {
  return {
    time: at.toLocaleTimeString(undefined, { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    date: at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
  }
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ds-strip__item">
      <div className="ds-strip__label">{label}</div>
      <div className="ds-strip__value">{value}</div>
      {hint && <div className="ds-strip__hint">{hint}</div>}
    </div>
  )
}

function SourceHead({ source }: { source: DataSourceInfo }) {
  const live = source.kind === 'live'
  return (
    <div className="app-source__head">
      <span className={`ds-badge ${live ? 'ds-badge--success' : ''}`}>
        <span className={`ds-dot ${live ? 'ds-dot--ok' : ''}`} aria-hidden="true" />
        {live ? 'Live' : 'Your file'}
      </span>
      <span className="app-source__provider">{source.provider}</span>
    </div>
  )
}

/** What is loaded: where it came from, how many rows, and when it was fetched. */
export default function DataSourcePanel({ state, disabled, onReload }: DataSourcePanelProps) {
  if (state.status === 'idle') {
    return <p className="ds-empty">Upload a CSV, or pick a live dataset above.</p>
  }

  if (state.status === 'loading') {
    return (
      <div className="app-source" aria-busy="true" role="status">
        <div className="app-source__head">
          <span className="ds-badge ds-badge--accent">
            <span className="ds-dot ds-dot--running" aria-hidden="true" />
            Fetching
          </span>
        </div>
        <p className="app-source__detail">Reading the live data from its public API. This takes a moment.</p>
        <div className="app-source__bar" aria-hidden="true" />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="ds-notice ds-notice--error app-banner" role="alert">
        <span>{state.message}</span>
        <button type="button" className="ds-button app-banner__dismiss" disabled={disabled} onClick={onReload}>
          Retry
        </button>
      </div>
    )
  }

  const { data, source } = state.loaded
  const fetched = fetchedParts(source.fetchedAt)
  const rows = data.truncated ? (data.totalRows ?? data.rows.length) : data.rows.length
  return (
    <div className="app-source">
      <SourceHead source={source} />
      <h3 className="app-source__title">{source.label}</h3>
      <p className="app-source__detail">{source.detail}</p>
      <div className="app-source__stats">
        <Stat
          label="Rows"
          value={data.rows.length.toLocaleString()}
          hint={data.truncated ? `of ${rows.toLocaleString()} in the file` : undefined}
        />
        <Stat label="Columns" value={String(data.headers.length)} />
        <Stat label={source.kind === 'live' ? 'Fetched' : 'Loaded'} value={fetched.time} hint={fetched.date} />
      </div>
      {source.url && (
        <div className="app-source__foot">
          <a className="app-source__link ds-mono" href={source.url} target="_blank" rel="noreferrer noopener">
            {linkText(source.url)}
          </a>
          <button type="button" className="ds-button app-source__reload" disabled={disabled} onClick={onReload}>
            Fetch again
          </button>
        </div>
      )}
    </div>
  )
}
