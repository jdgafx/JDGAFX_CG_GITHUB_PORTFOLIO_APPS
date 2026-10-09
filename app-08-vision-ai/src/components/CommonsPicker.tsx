import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { COMMONS_PRESETS, CommonsError, fetchCommonsFile, gridThumbUrl } from '../lib/commons'
import type { CommonsImage } from '../lib/commons'
import { useCommonsSearch } from '../lib/useCommonsSearch'

interface CommonsPickerProps {
  disabled: boolean
  /** How many image slots are still empty. The list stays open while more than one is. */
  slotsLeft: number
  /** Names the slot a pick goes into, when there is more than one. */
  label: string
  onPick: (file: File, image: CommonsImage) => void
}

const PLACEHOLDER_CARDS = Array.from({ length: 6 }, (_, index) => index)
const PICK_FAILED = 'The image could not be loaded. Try again or pick another.'

// "Pick a public image": search Wikimedia Commons, choose a result, and the thumbnail is downloaded
// in the browser and handed to the same pipeline as an upload.
export default function CommonsPicker({ disabled, slotsLeft, label, onPick }: CommonsPickerProps) {
  const { state, search } = useCommonsSearch()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(slotsLeft > 0)
  const [picking, setPicking] = useState<CommonsImage | null>(null)
  const [pickError, setPickError] = useState('')
  const pickAbort = useRef<AbortController | null>(null)

  useEffect(() => () => pickAbort.current?.abort(), [])


  const runSearch = (query: string) => {
    setText(query)
    setPickError('')
    void search(query)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    runSearch(text)
  }

  const pick = async (image: CommonsImage) => {
    pickAbort.current?.abort()
    const controller = new AbortController()
    pickAbort.current = controller
    setPicking(image)
    setPickError('')
    try {
      const file = await fetchCommonsFile(image, controller.signal)
      if (controller.signal.aborted) return
      setPicking(null)
      setOpen(slotsLeft > 1)
      onPick(file, image)
    } catch (err) {
      if (controller.signal.aborted) return
      setPicking(null)
      setPickError(err instanceof CommonsError ? err.message : PICK_FAILED)
    }
  }

  const busy = disabled || picking !== null
  // Starting a run closes the list, so the result is what the page shows.

  return (
        <details className="commons" open={open && !disabled} onToggle={event => !disabled && setOpen(event.currentTarget.open)}>
      <summary className="commons__summary">
        <span className="commons__title">Pick a public image</span>
        <span className="commons__sub">
          {label ? `Search Wikimedia Commons for ${label}.` : 'Search Wikimedia Commons instead of uploading.'}
        </span>
      </summary>

      <div className="commons__body">
        <div className="commons__presets" role="group" aria-label="One-click searches">
          {COMMONS_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className="commons__preset"
              disabled={busy}
              onClick={() => runSearch(preset.query)}
            >
              <span className="commons__preset-label">{preset.label}</span>
              <span className="commons__preset-sub">{preset.suits}</span>
            </button>
          ))}
        </div>

        <form className="commons__search" role="search" onSubmit={submit}>
          <label className="ds-label" htmlFor="commons-query">
            Or search for anything
          </label>
          <div className="commons__field">
            <input
              id="commons-query"
              className="ds-input"
              type="search"
              value={text}
              maxLength={100}
              placeholder="lighthouse at night"
              autoComplete="off"
              onChange={event => setText(event.target.value)}
            />
            <button type="submit" className="ds-button" disabled={busy || !text.trim()}>
              Search
            </button>
          </div>
        </form>

        <div aria-live="polite">
          {state.status === 'idle' && (
            <p className="ds-help">Pick a search above or type your own. Results come live from Wikimedia Commons.</p>
          )}
          {state.status === 'loading' && (
            <>
              <p className="ds-help" role="status">
                Searching Wikimedia Commons for “{state.query}”.
              </p>
              <ul className="commons__grid" aria-hidden="true">
                {PLACEHOLDER_CARDS.map(index => (
                  <li key={index} className="commons__card commons__card--placeholder" />
                ))}
              </ul>
            </>
          )}
          {state.status === 'error' && (
            <div className="ds-notice ds-notice--error commons__problem" role="alert">
              <span>{state.message}</span>
              <button type="button" className="ds-button" onClick={() => runSearch(state.query)}>
                Retry search
              </button>
            </div>
          )}
          {state.status === 'ready' && state.images.length === 0 && (
            <div className="ds-state ds-state--empty">
              <span className="ds-state__mark" aria-hidden="true" />
              <p className="ds-state__title">No usable images</p>
              <p className="ds-state__body">No JPEG, PNG, WebP or GIF images matched “{state.query}”. Try other words.</p>
            </div>
          )}
          {state.status === 'ready' && state.images.length > 0 && (
            <>
              <p className="ds-help">
                {state.images.length} images for “{state.query}”. Select one to load it.
              </p>
              <ul className="commons__grid">
                {state.images.map(image => (
                  <li key={image.pageUrl}>
                    <button
                      type="button"
                      className="commons__card"
                      disabled={busy}
                      aria-busy={picking === image}
                      aria-label={`Use ${image.title}, ${image.licence}`}
                      onClick={() => void pick(image)}
                    >
                      <img src={gridThumbUrl(image.thumbUrl)} alt="" loading="lazy" />
                      <span className="commons__card-title">{image.title}</span>
                      <span className="commons__card-licence">{picking === image ? 'Loading…' : image.licence}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {pickError && (
          <p className="ds-notice ds-notice--error" role="alert">
            {pickError}
          </p>
        )}
        <p className="ds-help">Each image keeps its own licence. The title, author and licence show beside the picture.</p>
      </div>
    </details>
  )
}
