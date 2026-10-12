import { useState } from 'react'

interface HowToProps {
  /** True while a result is on screen: the block folds away so the result stays first. */
  hasResult: boolean
  /** True while a run is live or the data is not ready. */
  disabled: boolean
  onTry: () => void
  /** A plain sentence when Try it could not start. */
  error?: string | null
}

const LINE = 'See how npm package downloads changed and why some days stand out.'
const STEPS = [
  'Type a package name and press Add, or open Ready-made comparisons.',
  'Pick 30 days, 90 days or 365 days.',
  'Press Explain spikes; the explanation takes about 20 seconds.',
] as const

/** The "How to use" block under the masthead: one line, three steps that name the real controls, and Try it. */
export default function HowTo({ hasResult, disabled, onTry, error }: HowToProps) {
  // Open on the first visit; folded while a result shows. A choice made with the toggle wins.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? !hasResult
  return (
    <section className="howto ds-card" aria-labelledby="howto-title">
      <div className="howto__head">
        <h2 id="howto-title" className="howto__title">
          How to use
        </h2>
        <button type="button" className="ds-button ds-button--quiet howto__toggle" aria-expanded={open} aria-controls="howto-body" onClick={() => setChosen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div id="howto-body" className="howto__body">
          <p className="howto__what">{LINE}</p>
          <ol className="howto__steps">
            {STEPS.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="howto__try">
            <button type="button" className="ds-button ds-button--primary" disabled={disabled} onClick={onTry}>
              Try it
            </button>
          </div>
          {error ? (
            <p className="ds-notice ds-notice--error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
