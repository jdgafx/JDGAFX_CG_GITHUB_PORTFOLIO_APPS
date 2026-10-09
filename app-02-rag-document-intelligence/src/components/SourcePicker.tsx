import { useEffect, useState, type KeyboardEvent } from 'react'
import { prepareReader } from '../lib/pdf'
import type { SourceRequest } from '../lib/loadSource'
import { ArxivPicker } from './ArxivPicker'
import { UploadZone } from './UploadZone'
import { WikipediaPicker } from './WikipediaPicker'

type Mode = 'wikipedia' | 'arxiv' | 'upload'

const TABS: Array<{ mode: Mode; label: string; long: string }> = [
  { mode: 'wikipedia', label: 'Wikipedia', long: 'a Wikipedia article' },
  { mode: 'arxiv', label: 'arXiv', long: 'an arXiv paper' },
  { mode: 'upload', label: 'Upload', long: 'your own file' },
]

interface SourcePickerProps {
  /** True while a document is loading or a run is in progress. Disables every control. */
  busy: boolean
  onLoad: (request: SourceRequest) => void
  /** Problems found before loading are raised to the app so every error shares one surface. */
  onError: (message: string) => void
}

/** Three ways to bring a document in. The tabs switch between them, and each shows its own help. */
export function SourcePicker({ busy, onLoad, onError }: SourcePickerProps) {
  const [mode, setMode] = useState<Mode>('wikipedia')

  // Both PDF sources need the reader's worker script, so it starts downloading as soon as one is chosen.
  useEffect(() => {
    if (mode !== 'wikipedia') prepareReader().catch(() => undefined)
  }, [mode])

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const at = TABS.findIndex(tab => tab.mode === mode)
    const next = TABS[(at + step + TABS.length) % TABS.length]
    if (!next) return
    setMode(next.mode)
    document.getElementById(`docmind-tab-${next.mode}`)?.focus()
  }

  return (
    <div className="ds-stack">
      <div className="docmind-tabs" role="tablist" aria-label="Where the document comes from">
        {TABS.map(tab => (
          <button
            key={tab.mode}
            id={`docmind-tab-${tab.mode}`}
            type="button"
            role="tab"
            className="docmind-tab"
            aria-selected={mode === tab.mode}
            aria-controls="docmind-source-panel"
            tabIndex={mode === tab.mode ? 0 : -1}
            onClick={() => setMode(tab.mode)}
            onKeyDown={handleKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="ds-help">Choose where the document comes from. Ask about {TABS.find(tab => tab.mode === mode)?.long}.</p>

      <div id="docmind-source-panel" role="tabpanel" aria-labelledby={`docmind-tab-${mode}`} className="docmind-source-panel">
        {mode === 'wikipedia' && <WikipediaPicker busy={busy} onLoad={title => onLoad({ kind: 'wikipedia', title })} />}
        {mode === 'arxiv' && <ArxivPicker busy={busy} onLoad={id => onLoad({ kind: 'arxiv', id })} onError={onError} />}
        {mode === 'upload' && (
          <UploadZone busy={busy} onFileSelect={file => onLoad({ kind: 'file', file })} onError={onError} />
        )}
      </div>
    </div>
  )
}
