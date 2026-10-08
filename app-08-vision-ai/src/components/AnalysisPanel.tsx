import { useEffect, useRef } from 'react'

interface AnalysisPanelProps {
  running: boolean
  canRun: boolean
  statusText: string
  onRun: () => void
  onCancel: () => void
}

export default function AnalysisPanel({ running, canRun, statusText, onRun, onCancel }: AnalysisPanelProps) {
  const runRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wasRunning = useRef(false)

  // A disabled button drops focus, so focus moves to Cancel while a run is in
  // progress and back to Analyze image once it ends.
  useEffect(() => {
    if (running) cancelRef.current?.focus()
    else if (wasRunning.current && document.activeElement === document.body) runRef.current?.focus()
    wasRunning.current = running
  }, [running])

  return (
    <section className="ds-section" aria-labelledby="analysis-title">
      <div className="ds-section__head">
        <h2 id="analysis-title" className="ds-section__title">
          Analysis
        </h2>
        <p className="ds-section__sub">One call to the vision model, using the picture and mode above.</p>
      </div>

      <div className="ds-row">
        <button
          ref={runRef}
          type="button"
          className="ds-button ds-button--primary"
          aria-busy={running}
          onClick={onRun}
          disabled={running || !canRun}
        >
          {running ? 'Analyzing…' : 'Analyze image'}
        </button>
        {running && (
          <button ref={cancelRef} type="button" className="ds-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {running && <p className="ds-help">Stops the request in this page. The provider may still finish and bill the call.</p>}
      {!running && canRun && <p className="ds-help">Sends the picture and mode once. The reply streams in.</p>}
      {!running && !canRun && <p className="ds-help">Choose an image first.</p>}

      <p className="run-status" role="status">
        {statusText}
      </p>
    </section>
  )
}
