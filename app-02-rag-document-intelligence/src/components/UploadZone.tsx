import { useState, type ChangeEvent, type DragEvent } from 'react'
import { MAX_FILE_SIZE } from '../lib/constants'

const LIMIT_MB = Math.round(MAX_FILE_SIZE / (1024 * 1024))

interface UploadZoneProps {
  /** True while a file is being read or a run is in progress. Disables the file and sample controls. */
  busy: boolean
  onFileSelect: (file: File) => Promise<void>
  /** Validation problems are raised to the app so every error shares one surface. */
  onError: (message: string) => void
  /** Loads the built-in sample guide, with a question ready to ask. */
  onSample: () => void
}

function isSupported(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.type === 'text/plain' ||
    file.name.endsWith('.pdf') ||
    file.name.endsWith('.txt')
  )
}

export function UploadZone({ busy, onFileSelect, onError, onSample }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)

  const accept = async (file: File) => {
    if (!isSupported(file)) {
      onError(`Unsupported file type: "${file.name.split('.').pop()?.toUpperCase() || 'unknown'}". Please upload a PDF or TXT file.`)
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
      onError(`File too large (${sizeMb} MB). Maximum allowed size is ${LIMIT_MB} MB.`)
      return
    }
    if (file.size === 0) {
      onError('This file appears to be empty.')
      return
    }
    await onFileSelect(file)
  }

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await accept(file)
    // Cleared after the read, so choosing the same file again still fires a change.
    e.target.value = ''
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!busy) setDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && !busy) void accept(file)
  }

  return (
    <div className="ds-stack docmind-upload">
      <div
        className="ds-empty docmind-drop"
        data-dragging={dragging}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="ds-label">Drop a PDF or TXT file here</p>
        <p className="ds-help">Or choose one below. The limit is {LIMIT_MB} MB.</p>
      </div>
      <input
        id="docmind-file"
        className="docmind-file"
        type="file"
        accept=".pdf,.txt,application/pdf,text/plain"
        disabled={busy}
        onChange={handleChange}
        aria-describedby="docmind-file-help"
      />
      <label htmlFor="docmind-file" className="ds-button ds-button--primary">
        {busy ? 'Reading the file' : 'Choose a PDF or TXT file'}
      </label>
      <p id="docmind-file-help" className="ds-help">
        Read in your browser and never uploaded whole. Only passages that match a question go to the model.
      </p>
      <button type="button" className="ds-button" onClick={onSample} disabled={busy}>
        Try the sample guide
      </button>
      <p className="ds-help">A built-in care guide with page numbers, so you can see an answer without a file.</p>
      <p className="ds-hint" role="status">
        {busy ? 'Reading your document. Long PDFs can take a few seconds.' : ''}
      </p>
    </div>
  )
}
