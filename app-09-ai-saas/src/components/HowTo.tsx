interface HowToProps {
  open: boolean
  onToggle: (open: boolean) => void
  onTry: () => void
  /** Disabled while a run is going. */
  busy: boolean
}

/** The directions: what the app does in one line, three steps that name the real controls, and a button that runs a real example. */
export default function HowTo({ open, onToggle, onTry, busy }: HowToProps) {
  return (
    <section className="howto" aria-labelledby="howto-title">
      <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
        <summary className="howto__summary">
          <h2 id="howto-title" className="howto__title">
            How to use
          </h2>
        </summary>
        <div className="howto__body">
          <p className="howto__line">Compare npm packages by real downloads; unusual days are matched to releases and explained.</p>
          <ol className="howto__steps">
            <li>
              Type a name under <strong>Add a package</strong> and press <strong>Add</strong>, or open <strong>Ready-made comparisons</strong>.
            </li>
            <li>
              Press <strong>Explain spikes</strong>. It takes about 10 seconds.
            </li>
            <li>Click a marker on the chart for that day and its releases, then read the check above the explanation.</li>
          </ol>
          <button type="button" className="ds-button ds-button--primary howto__try" onClick={onTry} disabled={busy}>
            Try it
          </button>
        </div>
      </details>
    </section>
  )
}
