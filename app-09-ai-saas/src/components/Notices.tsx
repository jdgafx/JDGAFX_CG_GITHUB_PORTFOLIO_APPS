import type { DownloadWindow } from '../lib/analytics'
import { longDate, shortDate } from '../lib/format'
import type { NpmError } from '../lib/npm'

export interface Failure {
  name: string
  error: NpmError
}

/** Dates beyond this many are folded into an expandable list. */
const GAP_DATES_INLINE = 4
const listDates = (dates: string[]): string => dates.map(shortDate).join(', ')

interface NoticesProps {
  failures: Failure[]
  /** True when no package loaded at all. The wording then says nothing can be shown. */
  allFailed: boolean
  span: DownloadWindow | null
  loading: boolean
  /** Packages whose release history could not be read. */
  releaseFailures: string[]
  onRetry: () => void
  onRetryReleases: () => void
  onRemove: (name: string) => void
}

/** What the page is showing and what went wrong: one state per package npm could not return, the window line, gaps and release problems. */
export default function Notices({ failures, allFailed, span, loading, releaseFailures, onRetry, onRetryReleases, onRemove }: NoticesProps) {
  return (
    <div className="ds-stack ds-run__notices">
      {failures.map(({ name, error }) => (
        <div key={name} role="alert" className="ds-state ds-state--error">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title ds-mono">{name}</p>
          <p className="ds-state__body">
            {error.message}
            {!allFailed && error.kind !== 'not-found' ? ' The other packages are shown without it.' : ''}
          </p>
          <div className="ds-state__actions">
            {error.kind === 'not-found' ? (
              <button type="button" className="ds-button" onClick={() => onRemove(name)}>
                Remove {name}
              </button>
            ) : (
              <button type="button" className="ds-button" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        </div>
      ))}

      {span && (
        <p role="status" className="hub-status ds-help">
          {loading
            ? 'Updating from npm…'
            : `Showing ${longDate(span.start)} to ${longDate(span.end)}${
                span.lagDays > 0
                  ? `, the latest day npm has published. The ${span.lagDays === 1 ? 'day' : `${span.lagDays} days`} after it ${span.lagDays === 1 ? 'is' : 'are'} not published yet.`
                  : '.'
              }`}
        </p>
      )}

      {span && span.gapDates.length > 0 && (
        <div className="ds-notice">
          {span.gapDates.length > GAP_DATES_INLINE ? (
            <details>
              <summary>npm reported no downloads for any package on {span.gapDates.length} days. Show the dates.</summary>
              <p>{listDates(span.gapDates)}.</p>
            </details>
          ) : (
            <p>npm reported no downloads for any package on {listDates(span.gapDates)}.</p>
          )}
          <p>Those days are left out of the averages, the change figures and the spike search, and show as gaps in the charts.</p>
        </div>
      )}

      {releaseFailures.length > 0 && (
        <div role="alert" className="ds-notice ds-notice--warning hub-release-notice">
          <p>
            Release history could not be read from the npm registry for <span className="ds-mono">{releaseFailures.join(', ')}</span>. Their
            unusual days are still marked, but no releases are matched to them.
          </p>
          <button type="button" className="ds-button" onClick={onRetryReleases}>
            Retry release history
          </button>
        </div>
      )}
    </div>
  )
}
