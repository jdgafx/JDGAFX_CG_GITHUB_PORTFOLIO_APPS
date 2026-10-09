import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { CommonsImage } from '../lib/commons'
import { ACCEPTED_LABEL, ACCEPTED_TYPES, MAX_FILE_SIZE } from '../lib/image'
import { useFileDrop } from '../lib/useFileDrop'
import CommonsPicker from './CommonsPicker'

interface ImagePickerProps {
  imageUrl: string
  fileName: string
  disabled: boolean
  uploadError: string
  onFile: (file: File, credit?: CommonsImage) => void
  onRemove: () => void
}

export default function ImagePicker({
  imageUrl,
  fileName,
  disabled,
  uploadError,
  onFile,
  onRemove,
}: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { dragging, dropProps } = useFileDrop(onFile, disabled)

  const openPicker = () => inputRef.current?.click()

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onFile(file)
    // Clearing the value lets the same file be chosen again.
    event.target.value = ''
  }

  return (
    <section className="ds-section" aria-labelledby="image-title" {...dropProps}>
      <div className="ds-section__head">
        <h2 id="image-title" className="ds-section__title">
          Image
        </h2>
        <p className="ds-section__sub">The one picture this analysis reads.</p>
      </div>

      {imageUrl ? (
        <div className={dragging ? 'picked is-dragging' : 'picked'}>
          <p className="picked__name">{fileName}</p>
          <div className="ds-row">
            <button type="button" className="ds-button" onClick={openPicker} disabled={disabled}>
              Choose another image
            </button>
            <button type="button" className="ds-button" onClick={onRemove} disabled={disabled}>
              Remove image
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={dragging ? 'dropzone is-dragging' : 'dropzone'} onClick={openPicker}>
          <span className="dropzone__title">Choose an image</span>
          <span className="dropzone__prompt">Drop a file here, or paste a screenshot with Ctrl+V.</span>
        </button>
      )}
      <p className="ds-help">
        {ACCEPTED_LABEL} up to {MAX_FILE_SIZE / (1024 * 1024)} MB, sent once to the server.
      </p>

      <CommonsPicker disabled={disabled} hasImage={imageUrl !== ''} onPick={onFile} />

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
