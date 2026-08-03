import { Download, FileCode, FileText } from 'lucide-react'

export type ExportKind = 'pdf' | 'docx' | 'md'

interface ExportBarProps {
  complete: boolean
  busy: ExportKind | null
  onExport: (kind: ExportKind) => void
}

const BUTTONS: Array<{
  kind: ExportKind
  label: string
  title: string
  color: string
  icon: typeof Download
}> = [
  {
    kind: 'pdf',
    label: 'PDF',
    title: 'Download the full report as a formatted PDF',
    color: '#ff3366',
    icon: Download,
  },
  {
    kind: 'docx',
    label: 'DOCX',
    title: 'Download the full report as an editable Word document',
    color: '#4488ff',
    icon: FileText,
  },
  {
    kind: 'md',
    label: 'Markdown',
    title: 'Download the full report as a Markdown file',
    color: '#00ff88',
    icon: FileCode,
  },
]

export function ExportBar({ complete, busy, onExport }: ExportBarProps) {
  const accent = complete ? '#00ff88' : '#ffa500'

  return (
    <div
      className="export-bar-enter"
      style={{
        padding: '12px 20px',
        borderTop: `1px solid ${accent}40`,
        background: `linear-gradient(180deg, ${accent}0f 0%, rgba(0,212,255,0.03) 100%)`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>
          {complete ? 'Report Ready' : 'Partial Report'}
        </span>
        <span style={{ fontSize: 12.5, color: '#94a3b8' }}>
          {complete ? '— export your research:' : '— export what the agents produced:'}
        </span>
      </div>

      {BUTTONS.map(({ kind, label, title, color, icon: Icon }) => {
        const isBusy = busy === kind
        return (
          <button
            key={kind}
            onClick={() => onExport(kind)}
            disabled={busy !== null}
            // The visible label ("PDF"/"DOCX"/"Markdown") is the accessible name;
            // the longer explanation belongs in the tooltip, not in aria-label.
            title={title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 600,
              cursor: busy !== null ? 'wait' : 'pointer',
              background: `${color}1a`,
              color,
              border: `1px solid ${color}4d`,
              fontFamily: 'inherit',
              opacity: busy !== null && !isBusy ? 0.5 : 1,
              transition: 'all 0.15s',
            }}
          >
            <Icon size={13} aria-hidden="true" />
            {isBusy ? 'Preparing...' : label}
          </button>
        )
      })}
    </div>
  )
}
