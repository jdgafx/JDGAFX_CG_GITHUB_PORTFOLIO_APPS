interface RetryCardProps {
  busy: boolean
  onRetry: () => void
}

/** Shown on a failed thread. The checkpoint keeps what finished, so a retry continues from the failed step. */
export function RetryCard({ busy, onRetry }: RetryCardProps) {
  return (
    <section className="ds-panel gg-retry" aria-labelledby="retry-heading">
      <div>
        <h2 id="retry-heading" className="ds-section__title">
          Retry from the checkpoint
        </h2>
        <p id="retry-help" className="ds-help">
          Steps that finished, including the classification and your answer, are saved. Retry runs only the step that
          failed.
        </p>
      </div>
      <button type="button" className="ds-button ds-button--primary" disabled={busy} onClick={onRetry} aria-describedby="retry-help">
        Retry the failed step
      </button>
    </section>
  )
}
