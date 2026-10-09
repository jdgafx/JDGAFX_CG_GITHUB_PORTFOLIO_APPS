import type { NpmError } from '../lib/npm'

export interface Failure {
  name: string
  error: NpmError
}

interface DataNoticesProps {
  failures: Failure[]
  /** True when no package loaded at all. The wording then says nothing can be shown. */
  allFailed: boolean
  onRetry: () => void
  onRemove: (name: string) => void
}

/** One notice per package npm could not return, each with the action that fits: retry, or remove a name that does not exist. */
export default function DataNotices({ failures, allFailed, onRetry, onRemove }: DataNoticesProps) {
  if (failures.length === 0) return null
  return (
    <div className="hub-notices">
      {failures.map(({ name, error }) => (
        <div key={name} role="alert" className="ds-notice ds-notice--error hub-notice">
          <p>
            <strong className="ds-mono">{name}</strong>: {error.message}
            {!allFailed && error.kind !== 'not-found' ? ' The other packages are shown without it.' : ''}
          </p>
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
      ))}
    </div>
  )
}
