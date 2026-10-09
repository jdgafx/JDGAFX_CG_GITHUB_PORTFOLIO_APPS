import { useEffect, useRef } from 'react'
import type { AnalysisMode } from '../lib/api'

interface ActionDockProps {
  mode: AnalysisMode
  running: boolean
  canRun: boolean
  /** Why the main button is off, in one sentence. Empty when it is on. */
  reason: string
  statusText: string
  onRun: () => void
  onCancel: () => void
}

const RUN_LABEL: Record<AnalysisMode, string> = {
  describe: 'Analyze image',
  analyze: 'Analyze image',
  qa: 'Analyze image',
  extract: 'Analyze image',
  region: 'Ask about region',
  compare: 'Compare images',
}

export default function ActionDock({ mode, running, canRun, reason, statusText, onRun, onCancel }: ActionDockProps) {
  const runRef = useRef<HTMLButtonElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const wasRunning = useRef(false)

  // A disabled button drops focus, so focus moves to Stop while a run is in progress (without scrolling the page)
  // and back to the main button once it ends, unless the focus already went to the result.
  useEffect(() => {
    if (running) stopRef.current?.focus({ preventScroll: true })
    else if (wasRunning.current && document.activeElement === document.body) runRef.current?.focus({ preventScroll: true })
    wasRunning.current = running
  }, [running])

  return (
    <>
      <div className="ds-actions">
        <button
          ref={runRef}
          type="button"
          className="ds-button ds-button--primary"
          aria-busy={running}
          onClick={onRun}
          disabled={running || !canRun}
        >
          {running ? 'Working…' : RUN_LABEL[mode]}
        </button>
        {running && (
          <button ref={stopRef} type="button" className="ds-button" onClick={onCancel}>
            Stop
          </button>
        )}
      </div>
      <p className="ds-help">
        {running
          ? 'Stop ends the request in this page. The provider may still finish and bill the call.'
          : reason || 'Sends the picture once. The reply streams in.'}
      </p>
      <p className="vl-status" role="status">
        {statusText}
      </p>
    </>
  )
}
