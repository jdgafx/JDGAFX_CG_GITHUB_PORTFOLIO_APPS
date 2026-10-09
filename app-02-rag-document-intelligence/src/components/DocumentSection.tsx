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
    <section className="ds-section" aria-labelledby="section-document">
      <div className="ds-section__head">
        <h2 id="section-document" className="ds-section__title">
          Document
        </h2>
        <p className="ds-section__sub">The text you ask about. Only passages that match a question go to the model.</p>
      </div>

      {doc ? (
        <div className="ds-stack">
          <p className="ds-label docmind-wrap">{doc.title}</p>
          <p className="ds-help docmind-wrap">
            Source:{' '}
            {doc.source.url ? (
              <a href={doc.source.url} target="_blank" rel="noopener noreferrer">
                {doc.source.label}
              </a>
            ) : (
              doc.source.label
            )}
          </p>
          <div className="ds-strip docmind-doc-strip" role="group" aria-label="Document figures">
            <Figure label="Passages" value={doc.chunks.length.toLocaleString('en-US')} />
            <Figure label={unitHeading(doc)} value={doc.pages.toLocaleString('en-US')} />
            <Figure label="Characters" value={doc.charCount.toLocaleString('en-US')} />
          </div>
          <div className="ds-row">
            <button type="button" className="ds-button" onClick={onReset} disabled={busy}>
              Start over
            </button>
          </div>
          <p className="ds-help">Clears this document and the conversation.</p>
        </div>
      ) : (
        <SourcePicker busy={busy} onLoad={onLoad} onError={onError} />
      )}

      <p className="ds-hint" role="status">
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="ds-strip__item">
      <p className="ds-strip__label">{label}</p>
      <p className="ds-strip__value">{value}</p>
    </div>
  )
}
