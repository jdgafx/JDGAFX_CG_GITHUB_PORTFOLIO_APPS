import type { RunStatus } from '../lib/useAnalysis'
import Markdown from './Markdown'

interface ResultPanelProps {
  result: string
  status: RunStatus
  truncated: boolean
  notice: string
}

// The reply column beside the picture. It streams in while a run is open and keeps any
// partial reply, with the reason it stopped, once the run ends.
export default function ResultPanel({ result, status, truncated, notice }: ResultPanelProps) {
  const running = status === 'running'
  const failed = status === 'failed'

  return (
    <div className="answer-column">
      <div className="result-body" aria-live="polite" aria-busy={running}>
        {result ? (
          <Markdown content={result} streaming={running} />
        ) : running ? (
          <p className="ds-help">Waiting for the first words.</p>
        ) : notice ? null : (
          <div className="ds-empty">Choose an image, then analyze it. The answer streams in here.</div>
        )}
      </div>

      {truncated && (
        <p className="ds-notice" role="status">
          Output was cut off before the model finished. Crop the image to the part you need, or analyze again.
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
    </div>
  )
}
