interface RunActionsProps {
  canRun: boolean
  running: boolean
  hasRun: boolean
  blockedBy: string | null
  onRun: () => void
  onStop: () => void
  onClear: () => void
}

export function RunActions({ canRun, running, hasRun, blockedBy, onRun, onStop, onClear }: RunActionsProps) {
  return (
    <section className="ds-section" aria-labelledby="compare-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="compare-title">Compare</h2>
        <p className="ds-section__sub">Runs the three panels, then the judge if at least two answer.</p>
      </div>
      <div className="ds-stack">
        <div className="arena-actions">
          <button
            type="button"
            className="ds-button ds-button--primary"
            onClick={onRun}
            disabled={!canRun}
            aria-describedby="compare-help"
          >
            Compare models
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={onStop} aria-describedby="stop-help">
              Stop
            </button>
          )}
          <button
            type="button"
            className="ds-button"
            onClick={onClear}
            disabled={!hasRun || running}
            aria-describedby="clear-help"
          >
            Clear results
          </button>
        </div>
        <p className="ds-help" id="compare-help">
          {blockedBy ?? 'Sends the prompt to all three panels at once. Ctrl+Enter also runs the comparison.'}
        </p>
        {running && (
          <p className="ds-help" id="stop-help">
            Stop ends the wait in this browser. A request already sent may still finish and be billed.
          </p>
        )}
        <p className="ds-help" id="clear-help">
          Clear results removes this run's answers, evidence and trace. Your prompt and models stay.
        </p>
      </div>
    </section>
  )
}
