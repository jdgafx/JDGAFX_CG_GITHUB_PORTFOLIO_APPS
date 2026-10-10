import { useState } from 'react'

const STORAGE_KEY = 'codelens-howto-open'

function remembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function remember(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
  } catch {
    /* storage is a convenience, never required */
  }
}

interface HowToProps {
  /** True while Try it is fetching the file or a review runs. */
  busy: boolean
  /** Why the example could not be loaded, or null. */
  error: string | null
  /** Changes when a run starts on a narrow screen: the block folds away so the result is not pushed down. */
  collapseKey: number
  onTry: () => void
}

/** What the app does, three steps that name the controls as they appear, and one button that runs a real example. */
export function HowTo({ busy, error, collapseKey, onTry }: HowToProps) {
  const [open, setOpen] = useState(remembered)
  const [seenKey, setSeenKey] = useState(collapseKey)
  if (seenKey !== collapseKey) {
    setSeenKey(collapseKey)
    setOpen(false)
  }
  const toggle = () => {
    remember(!open)
    setOpen(!open)
  }
  return (
    <section className="howto" aria-labelledby="howto-title">
      <div className="howto__head">
        <h2 id="howto-title" className="ds-section__title">
          How to use
        </h2>
        <button type="button" className="ds-button howto__toggle" aria-expanded={open} aria-controls="howto-body" onClick={toggle}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      <div id="howto-body" hidden={!open} className="howto__body">
        <p className="howto__lead">Reviews a source file or pull request, then checks every comment against the code.</p>
        <ol className="howto__steps">
          <li>Choose a public GitHub file and select Load file, or paste code into the editor.</li>
          <li>Select Review code. It takes about 10 to 20 seconds.</li>
          <li>Read each comment: kept, moved or dropped, with the reason. Select Show in editor to see the line.</li>
        </ol>
        <div className="howto__try">
          <button type="button" className="ds-button ds-button--primary" onClick={onTry} disabled={busy} aria-busy={busy}>
            Try it
          </button>
          <span className="ds-help">Loads createStore.ts from the Redux repository on GitHub and reviews it live, about 10 seconds.</span>
        </div>
        {error && (
          <p className="ds-help howto__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
