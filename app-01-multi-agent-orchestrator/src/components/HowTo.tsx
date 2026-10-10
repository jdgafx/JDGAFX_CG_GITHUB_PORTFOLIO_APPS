import { useState } from 'react'

interface HowToProps {
  /** One line on what the app does. */
  what: string
  /** One short imperative line per step, naming each control as it reads on screen. */
  steps: readonly string[]
  /** Runs the real example end to end. */
  onTry: () => void
  /** True while a run is live or the example cannot start yet. */
  disabled: boolean
  /** True while a result is on screen: the block folds away so the result stays first. */
  hasResult: boolean
  /** One short clause beside the button on what Try it runs and how long it takes. */
  hint: string
}

/** The "How to use" block under the masthead: what the app does, the steps, and a Try it button for a real example. */
export function HowTo({ what, steps, onTry, disabled, hasResult, hint }: HowToProps) {
  // Open on the first visit; folded while a result shows. A choice made with the toggle wins.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const [seenResult, setSeenResult] = useState(hasResult)
  if (seenResult !== hasResult) {
    // A new result (or a new run) starts from the default again.
    setSeenResult(hasResult)
    setChosen(null)
  }
  const open = chosen ?? !hasResult
  return (
    <section className="howto ds-card" aria-labelledby="howto-title">
      <div className="howto__head">
        <h2 id="howto-title" className="howto__title">
          How to use
        </h2>
        <button
          type="button"
          className="ds-button ds-button--quiet howto__toggle"
          aria-expanded={open}
          aria-controls="howto-body"
          onClick={() => setChosen(!open)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div id="howto-body" className="howto__body">
          <p className="howto__what">{what}</p>
          <ol className="howto__steps">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="howto__try">
            <button type="button" className="ds-button ds-button--primary" disabled={disabled} onClick={onTry}>
              Try it
            </button>
            <span className="howto__hint">{hint}</span>
          </div>
        </div>
      )}
    </section>
  )
}
