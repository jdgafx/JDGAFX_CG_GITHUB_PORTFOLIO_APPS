import { useState, type ChangeEvent, type DragEvent } from 'react'
import { MAX_FILE_SIZE } from '../lib/constants'

const LIMIT_MB = Math.round(MAX_FILE_SIZE / (1024 * 1024))

interface UploadZoneProps {
  /** True while a document is loading or a run is in progress. Disables the file control. */
  busy: boolean
  onFileSelect: (file: File) => void
  /** Validation problems are raised to the app so every error shares one surface. */
  onError: (message: string) => void
}

function isSupported(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.type === 'text/plain' ||
    file.name.endsWith('.pdf') ||
    file.name.endsWith('.txt')
  )
}

export function UploadZone({ busy, onFileSelect, onError }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)

  const accept = (file: File) => {
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
    onFileSelect(file)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) accept(file)
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
    if (file && !busy) accept(file)
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
        {busy ? 'Loading a document' : 'Choose a PDF or TXT file'}
      </label>
      <p id="docmind-file-help" className="ds-help">
        Read in your browser and never uploaded whole. Only passages that match a question go to the model.
      </p>
    </div>
  )
}
