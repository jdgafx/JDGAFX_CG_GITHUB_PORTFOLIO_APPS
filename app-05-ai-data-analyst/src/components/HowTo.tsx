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
  /** A plain sentence when the example could not start. */
  error?: string | null
  /** True while the live rows are being fetched. */
  loading?: boolean
  /** Fetches the live rows again after a failure. */
  onRetry?: () => void
}

/** The "How to use" block under the masthead: what the app does, the steps, and a Try it button for a real example. */
export function HowTo({ what, steps, onTry, disabled, hasResult, error, loading = false, onRetry }: HowToProps) {
  // Open on the first visit; folded while a result shows. A choice made with the toggle wins.
  const [chosen, setChosen] = useState<boolean | null>(null)
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
          title={open ? 'Hide the How to use steps' : 'Show the How to use steps'}
          onClick={() => setChosen(!open)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div id="howto-body" className="howto__body">
          <p className="howto__what">{what}</p>
          <ol className="howto__steps">
            {steps.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="howto__try">
            <button
              type="button"
              className="ds-button ds-button--primary"
              disabled={disabled}
              title="Run an example question on the live earthquake feed"
              onClick={onTry}
            >
              Try it
            </button>
            {loading ? (
              <span className="howto__hint" role="status">
                Loading the live feed.
              </span>
            ) : (
              <span className="howto__hint">Runs a real example on live data.</span>
            )}
          </div>
          {error ? (
            <div className="ds-notice ds-notice--error app-banner" role="alert">
              <span>{error}</span>
              {onRetry ? (
                <button
                  type="button"
                  className="ds-button app-banner__dismiss"
                  disabled={disabled}
                  title="Fetch the live feed again; then press Try it"
                  onClick={onRetry}
                >
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
