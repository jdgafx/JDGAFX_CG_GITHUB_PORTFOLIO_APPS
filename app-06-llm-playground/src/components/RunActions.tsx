import type { Mode } from '../lib/run'

interface RunActionsProps {
  mode: Mode
  canRun: boolean
  running: boolean
  hasRun: boolean
  blockedBy: string | null
  onStop: () => void
  onClear: () => void
}

// The dock: Compare and Stop stay in view. Clear is quiet and sits after them; nothing here is destructive.
export function RunActions({ mode, canRun, running, hasRun, blockedBy, onStop, onClear }: RunActionsProps) {
  return (
    <div className="ds-actions" role="group" aria-label="Run controls">
      <button type="submit" form="prompt-form" className="ds-button ds-button--primary" disabled={!canRun} aria-describedby="compare-help">
        {mode === 'blind' ? 'Compare blind' : 'Compare models'}
      </button>
      {running && (
        <button type="button" className="ds-button" onClick={onStop} aria-describedby="stop-help">
          Stop
        </button>
      )}
      <button type="button" className="ds-button ds-button--quiet" onClick={onClear} disabled={!hasRun || running} aria-describedby="clear-help">
        Clear results
      </button>
      <p className="ds-help arena-dock-help" id="compare-help">
        {blockedBy ?? 'Sends the prompt to all three panels at once. Ctrl+Enter also runs it.'}
      </p>
      <span className="ds-sr-only" id="stop-help">
        Stop ends the wait in this browser. A request already sent may still finish and be billed.
      </span>
      <span className="ds-sr-only" id="clear-help">
        Clear results removes this run's answers, evidence and trace. Your prompt and models stay. Votes already cast stay on the leaderboard.
      </span>
    </div>
  )
}
