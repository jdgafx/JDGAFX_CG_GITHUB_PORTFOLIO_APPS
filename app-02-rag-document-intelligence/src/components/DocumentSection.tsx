import { count } from '../lib/format'
import { unitHeading } from '../lib/location'
import type { SourceRequest } from '../lib/loadSource'
import type { DocumentState } from '../types'
import { ErrorBanner } from './ErrorBanner'
import { SourcePicker } from './SourcePicker'

interface DocumentSectionProps {
  doc: DocumentState | null
  /** True while a document loads or a run is in progress. Disables the action buttons. */
  busy: boolean
  /** The status line while a document loads, or null. */
  activity: string | null
  error: string | null
  canRetry: boolean
  onLoad: (request: SourceRequest) => void
  onRetry: () => void
  onError: (message: string) => void
  onReset: () => void
}

/** The source controls: three ways to bring a document in, then its details and Start over once one is loaded. */
export function DocumentSection({ doc, busy, activity, error, canRetry, onLoad, onRetry, onError, onReset }: DocumentSectionProps) {
  return (
    <section className="ds-section" aria-label="Document">
      {doc ? (
        <div className="ds-stack">
          <div className="docmind-doc-head">
            <p className="docmind-doc-title docmind-wrap">{doc.title}</p>
            <p className="ds-help docmind-wrap">
              {doc.source.url ? (
                <a href={doc.source.url} target="_blank" rel="noopener noreferrer">
                  {doc.source.label}
                </a>
              ) : (
                doc.source.label
              )}
            </p>
          </div>
          <dl className="ds-kv">
            <dt>Passages</dt>
            <dd>{count(doc.chunks.length)}</dd>
            <dt>{unitHeading(doc)}</dt>
            <dd>{count(doc.pages)}</dd>
            <dt>Characters</dt>
            <dd>{count(doc.charCount)}</dd>
          </dl>
          <div className="ds-row">
            <button type="button" className="ds-button" onClick={onReset} disabled={busy}>
              Start over
            </button>
            <span className="ds-help">Clears the document and the answers.</span>
          </div>
        </div>
      ) : (
        <SourcePicker busy={busy} onLoad={onLoad} onError={onError} />
      )}

      <p className="ds-help" role="status">
        {activity ?? ''}
      </p>
      <ErrorBanner message={error} />
      {canRetry && (
        <div className="ds-row">
          <button type="button" className="ds-button" onClick={onRetry} disabled={busy}>
            Try again
          </button>
          <span className="ds-help">Repeats the request that failed.</span>
        </div>
      )}
    </section>
  )
}
