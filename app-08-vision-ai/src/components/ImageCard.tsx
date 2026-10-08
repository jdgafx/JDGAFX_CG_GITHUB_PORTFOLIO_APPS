import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { ACCEPTED_LABEL, ACCEPTED_TYPES } from '../lib/image'

interface ImageCardProps {
  imageUrl: string
  fileName: string
  disabled: boolean
  uploadError: string
  onFile: (file: File) => void
  onRemove: () => void
  onZoom: () => void
}

export default function ImageCard({
  imageUrl,
  fileName,
  disabled,
  uploadError,
  onFile,
  onRemove,
  onZoom,
}: ImageCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const openPicker = () => inputRef.current?.click()

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    if (!disabled) setDragging(true)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file && !disabled) onFile(file)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onFile(file)
    // Clearing the value lets the same file be chosen again.
    event.target.value = ''
  }

  return (
    <section
      className="ds-card"
      aria-labelledby="image-title"
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="ds-card__head">
        <h2 id="image-title" className="ds-card__title">
          Image
        </h2>
        <span className="ds-hint image-card__name">{imageUrl ? fileName : `${ACCEPTED_LABEL}, up to 4 MB`}</span>
      </div>

      {imageUrl ? (
        <figure className="image-preview">
          <img src={imageUrl} alt={`Image to analyze: ${fileName}`} />
          <div className="ds-row">
            <button type="button" className="ds-button" onClick={onZoom}>
              View full size
            </button>
            <button type="button" className="ds-button" onClick={openPicker} disabled={disabled}>
              Choose another image
            </button>
            <button type="button" className="ds-button" onClick={onRemove} disabled={disabled}>
              Remove image
            </button>
          </div>
        </figure>
      ) : (
        <button
          type="button"
          className={dragging ? 'dropzone is-dragging' : 'dropzone'}
          onClick={openPicker}
        >
          <span className="dropzone__title">Choose an image</span>
          <span className="ds-hint">Drop one here, or paste a screenshot with Ctrl+V.</span>
        </button>
      )}

      {uploadError && (
        <p className="ds-notice ds-notice--error" role="alert">
          {uploadError}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        aria-label="Choose an image to analyze"
        hidden
        onChange={handleChange}
      />
    </section>
  )
}
