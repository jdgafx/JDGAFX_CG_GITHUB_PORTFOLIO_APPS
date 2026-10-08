import type { DocumentState } from '../types'
import { ErrorBanner } from './ErrorBanner'
import { UploadZone } from './UploadZone'

interface DocumentSectionProps {
  doc: DocumentState | null
  /** True while a file is read or a run is in progress. Disables the action buttons. */
  busy: boolean
  error: string | null
  onFileSelect: (file: File) => Promise<void>
  onSample: () => void
  onError: (message: string) => void
  onReset: () => void
}

/** The file controls: the chooser and sample before a document, its figures and Start over after. */
export function DocumentSection({ doc, busy, error, onFileSelect, onSample, onError, onReset }: DocumentSectionProps) {
  return (
    <section className="ds-section" aria-labelledby="section-document">
      <div className="ds-section__head">
        <h2 id="section-document" className="ds-section__title">
          Document
        </h2>
        <p className="ds-section__sub">The file you ask about. Only passages that match a question leave this browser.</p>
      </div>

      {doc ? (
        <div className="ds-stack">
          <p className="ds-label docmind-wrap">{doc.title}</p>
          <div className="ds-strip docmind-doc-strip" role="group" aria-label="Document figures">
            <Figure label="Passages" value={doc.chunks.length.toLocaleString('en-US')} />
            <Figure label="Pages" value={doc.pages.toLocaleString('en-US')} />
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
        <UploadZone busy={busy} onFileSelect={onFileSelect} onError={onError} onSample={onSample} />
      )}

      <ErrorBanner message={error} />
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
