import type { InsightRun } from '../lib/insightRun'

interface InsightControlsProps {
  run: InsightRun
}

/** The controls column: the action that starts a run, and Stop while a run streams. */
export default function InsightControls({ run }: InsightControlsProps) {
  const running = run.status === 'running'
  const label = running ? 'Generating…' : run.answer ? 'Regenerate' : 'Generate insights'

  return (
    <section className="ds-section hub-controls" aria-labelledby="analysis-title">
      <div className="ds-section__head">
        <h2 id="analysis-title" className="ds-section__title">
          AI analysis
        </h2>
        <p className="ds-section__sub">The model writes four or five insights about the summary figures.</p>
      </div>

      <div className="ds-row">
        <button
          type="button"
          className="ds-button ds-button--primary"
          onClick={() => void run.generate()}
          disabled={running}
        >
          {label}
        </button>
        {running && (
          <button type="button" className="ds-button" onClick={() => run.stop()}>
            Stop
          </button>
        )}
        {running && (
          <span className="ds-badge ds-badge--accent">
            <span className="ds-dot ds-dot--running" aria-hidden="true" />
            Running
          </span>
        )}
      </div>

      <p className="ds-help">Sends only the five summary figures and their trends to the server, which calls the model.</p>
      {running && <p className="ds-help">Stop ends the stream. The text that arrived so far stays on screen.</p>}
    </section>
  )
}
