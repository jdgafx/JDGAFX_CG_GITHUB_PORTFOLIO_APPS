import { Download, FileCode, FileText } from 'lucide-react'

export type ExportKind = 'pdf' | 'docx' | 'md'

/** running: a run is in progress. empty: no output yet. partial: some stages have output. complete: every stage has output. */
export type ExportState = 'running' | 'empty' | 'partial' | 'complete'

interface ExportBarProps {
  state: ExportState
  busy: ExportKind | null
  onExport: (kind: ExportKind) => void
}

const BUTTONS: Array<{ kind: ExportKind; label: string; title: string; icon: typeof Download }> = [
  { kind: 'pdf', label: 'PDF', title: 'Download the report as a formatted PDF', icon: Download },
  { kind: 'docx', label: 'DOCX', title: 'Download the report as an editable Word document', icon: FileText },
  { kind: 'md', label: 'Markdown', title: 'Download the report as a Markdown file', icon: FileCode },
]

const HELP: Record<ExportState, string> = {
  running: 'Available when the run ends. It exports all four stages in order, then the sources.',
  empty: 'Available once a run has output. It exports all four stages in order, then the sources.',
  partial: 'Exports all four stages in order, then the sources. A stage that produced no output says so in the file.',
  complete: 'Exports research, analysis, critique and synthesis in order, with the sources the research cites.',
}

/** The export section: one button per format, with one line on what gets exported. */
export function ExportBar({ state, busy, onExport }: ExportBarProps) {
  const locked = busy !== null || state === 'running' || state === 'empty'

  return (
    <section className="ds-section" aria-labelledby="export-heading">
      <div className="ds-section__head">
        <h2 id="export-heading" className="ds-section__title">
          Export report
        </h2>
        <p className="ds-section__sub">Save the report as a file.</p>
      </div>
      <div className="ds-row" role="group" aria-labelledby="export-heading" aria-describedby="export-help">
        {BUTTONS.map(({ kind, label, title, icon: Icon }) => (
          <button key={kind} type="button" className="ds-button" onClick={() => onExport(kind)} disabled={locked} title={title}>
            <Icon size={14} aria-hidden="true" />
            {busy === kind ? 'Preparing...' : label}
          </button>
        ))}
      </div>
      <p id="export-help" className="ds-help">
        {HELP[state]}
      </p>
    </section>
  )
}
