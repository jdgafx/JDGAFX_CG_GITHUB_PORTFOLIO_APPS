import { useEffect, useRef } from 'react'
import type { InsightRun } from '../lib/insightRun'

interface InsightControlsProps {
  run: InsightRun
  /** False while there are no figures to analyse, or the data or release history is still loading. */
  ready: boolean
  onStart: () => void
}

/** The dock: the action that starts a run, and Stop while a run streams. */
export default function InsightControls({ run, ready, onStart }: InsightControlsProps) {
  const running = run.status === 'running'
  const stop = useRef<HTMLButtonElement | null>(null)
  // Stop takes focus when a run starts, without scrolling, so Enter or Space ends it and the page does not move.
  useEffect(() => {
    if (running) stop.current?.focus({ preventScroll: true })
  }, [running])
  const label = running ? 'Explaining…' : run.answer ? 'Explain again' : 'Explain spikes'
  return (
    <div className="ds-actions">
      <button type="button" className="ds-button ds-button--primary" onClick={onStart} disabled={running || !ready}>
        {label}
      </button>
      {running && (
        <button ref={stop} type="button" className="ds-button" onClick={() => run.stop()}>
          Stop
        </button>
      )}
    </div>
  )
}
