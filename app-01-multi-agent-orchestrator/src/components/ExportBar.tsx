import { Download, FileCode, FileText } from 'lucide-react'

export type ExportKind = 'pdf' | 'docx' | 'md'

interface ExportBarProps {
  complete: boolean
  busy: ExportKind | null
  disabled: boolean
  onExport: (kind: ExportKind) => void
}

const BUTTONS: Array<{ kind: ExportKind; label: string; title: string; icon: typeof Download }> = [
  { kind: 'pdf', label: 'PDF', title: 'Download the report as a formatted PDF', icon: Download },
  { kind: 'docx', label: 'DOCX', title: 'Download the report as an editable Word document', icon: FileText },
  { kind: 'md', label: 'Markdown', title: 'Download the report as a Markdown file', icon: FileCode },
]

export function ExportBar({ complete, busy, disabled, onExport }: ExportBarProps) {
  const locked = disabled || busy !== null

  return (
    <section className="ds-card" aria-labelledby="export-heading">
      <div className="ds-card__head">
        <h2 id="export-heading" className="ds-card__title">
          Export report
        </h2>
        <span className="ds-hint">
          {complete ? 'All four stages are in the report.' : 'Partial run. The export holds the stages that finished.'}
        </span>
      </div>
      <div className="ds-row">
        {BUTTONS.map(({ kind, label, title, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            className="ds-button"
            onClick={() => onExport(kind)}
            disabled={locked}
            title={title}
          >
            <Icon size={14} aria-hidden="true" />
            {busy === kind ? 'Preparing...' : label}
          </button>
        ))}
      </div>
    </section>
  )
}
