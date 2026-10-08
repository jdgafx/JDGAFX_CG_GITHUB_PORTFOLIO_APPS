import type { RunStatus } from '../lib/useAnalysis'
import Markdown from './Markdown'

interface ResultPanelProps {
  result: string
  status: RunStatus
  truncated: boolean
  notice: string
}

export default function ResultPanel({ result, status, truncated, notice }: ResultPanelProps) {
  const running = status === 'running'
  const failed = status === 'failed'

  return (
    <section className="ds-card" aria-labelledby="result-title">
      <div className="ds-card__head">
        <h2 id="result-title" className="ds-card__title">
          Result
        </h2>
      </div>

      <div className="result-body" aria-live="polite" aria-busy={running}>
        {result ? (
          <Markdown content={result} streaming={running} />
        ) : running ? (
          <p className="ds-hint">Waiting for the first words.</p>
        ) : notice ? null : (
          <div className="ds-empty">Run an analysis to see the answer here.</div>
        )}
      </div>

      {truncated && (
        <p className="ds-notice" role="status">
          Output was cut off before the model finished. Crop the image to the part you need, or run again.
        </p>
      )}
      {notice &&
        (failed ? (
          <p className="ds-notice ds-notice--error" role="alert">
            {notice}
          </p>
        ) : (
          <p className="ds-notice" role="status">
            {notice}
          </p>
        ))}
    </section>
  )
}
