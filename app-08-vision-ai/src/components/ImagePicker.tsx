import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { CommonsImage } from '../lib/commons'
import { ACCEPTED_LABEL, ACCEPTED_TYPES, MAX_FILE_SIZE } from '../lib/image'
import type { Slot } from '../lib/useAnalysis'
import { useFileDrop } from '../lib/useFileDrop'
import CommonsPicker from './CommonsPicker'

export interface Loaded {
  name: string
  url: string
}

interface SlotProps {
  label: string
  loaded: Loaded | null
  disabled: boolean
  onChoose: () => void
  onFile: (file: File) => void
  onRemove: () => void
}

// One image: a dropzone while it is empty, then its name with the two things you can do to it.
function ImageSlot({ label, loaded, disabled, onChoose, onFile, onRemove }: SlotProps) {
  const { dragging, dropProps } = useFileDrop(onFile, disabled)
  if (!loaded) {
    return (
      <div className={dragging ? 'ds-drop ds-drop--over' : 'ds-drop'} {...dropProps}>
        <b>{label ? `Image ${label}` : 'Choose an image'}</b>
        <span className="ds-help">Drop a file here, or paste a screenshot with Ctrl+V.</span>
        <button type="button" className="ds-button" onClick={onChoose} disabled={disabled}>
          Choose file
        </button>
      </div>
    )
  }
  return (
    <div className={dragging ? 'vl-picked is-dragging' : 'vl-picked'} {...dropProps}>
      <img src={loaded.url} alt="" className="vl-picked__thumb" />
      <div className="vl-picked__text">
        {label && <span className="ds-chip">{label}</span>}
        <p className="vl-picked__name">{loaded.name}</p>
      </div>
      <div className="ds-row">
        <button type="button" className="ds-button" onClick={onChoose} disabled={disabled}>
          Replace
        </button>
        <button type="button" className="ds-button" onClick={onRemove} disabled={disabled}>
          Remove
        </button>
      </div>
    </div>
  )
}

interface ImagePickerProps {
  comparing: boolean
  a: Loaded | null
  b: Loaded | null
  disabled: boolean
  uploadError: string
  onFile: (file: File, credit: CommonsImage | null, slot: Slot) => void
  onRemove: (slot: Slot) => void
}

export default function ImagePicker({ comparing, a, b, disabled, uploadError, onFile, onRemove }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const slotRef = useRef<Slot>('a')
  // Where a Commons pick goes while comparing. It moves to B after A is filled.
  const [pickInto, setPickInto] = useState<Slot>('a')
  const target: Slot = comparing ? (a && !b ? 'b' : pickInto) : 'a'

  const choose = (slot: Slot) => {
    slotRef.current = slot
    inputRef.current?.click()
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onFile(file, null, slotRef.current)
    // The empty-state button in the answer column opens this input too, and always means image A.
    slotRef.current = 'a'
    // Clearing the value lets the same file be chosen again.
    event.target.value = ''
  }

  return (
    <section className="ds-section" aria-labelledby="image-title">
      <h2 id="image-title" className="ds-label vl-label">
        {comparing ? 'Two images' : 'Image'}
      </h2>

      <div className="vl-slots">
        <ImageSlot
          label={comparing ? 'A' : ''}
          loaded={a}
          disabled={disabled}
          onChoose={() => choose('a')}
          onFile={file => onFile(file, null, 'a')}
          onRemove={() => onRemove('a')}
        />
        {comparing && (
          <ImageSlot
            label="B"
            loaded={b}
            disabled={disabled}
            onChoose={() => choose('b')}
            onFile={file => onFile(file, null, 'b')}
            onRemove={() => onRemove('b')}
          />
        )}
      </div>
      <p className="ds-help">
        {ACCEPTED_LABEL} up to {MAX_FILE_SIZE / (1024 * 1024)} MB.
        {comparing && ' Each image is shrunk to 2 MB if needed, so both fit one request.'}
      </p>

      {comparing && (
        <div className="vl-target" role="group" aria-label="Where a public image goes">
          <span className="ds-help">Public image goes into</span>
          <div className="ds-seg">
            {(['a', 'b'] as const).map(slot => (
              <button key={slot} type="button" aria-pressed={target === slot} onClick={() => setPickInto(slot)}>
                Image {slot.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      <CommonsPicker
        key={comparing ? 'pair' : 'single'}
        disabled={disabled}
        slotsLeft={(a ? 0 : 1) + (comparing && !b ? 1 : 0)}
        label={comparing ? `Image ${target.toUpperCase()}` : ''}
        onPick={(file, image) => {
          onFile(file, image, target)
          // The result list was long; bring the rail back to the top so the loaded image shows.
          document.querySelector('.ds-controls')?.scrollTo({ top: 0 })
        }}
      />

      {uploadError && (
        <p className="ds-notice ds-notice--error" role="alert">
          {uploadError}
        </p>
      )}

      <input
        ref={inputRef}
        id="vl-file"
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        aria-label="Choose an image to analyze"
        hidden
        onChange={handleChange}
      />
    </section>
  )
}
