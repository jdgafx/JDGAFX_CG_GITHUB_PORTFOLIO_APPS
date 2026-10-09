import { useEffect, useRef, type ReactNode } from 'react'
import type { Phase } from '../lib/runState'

interface RunControlsProps {
  task: string
  phase: Phase
  canRunAgain: boolean
  onPlan: () => void
  onStop: () => void
  onRunAgain: () => void
  onReset: () => void
}

/** A 14 px stroke icon. The button text names the control. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const PlayIcon = () => <Icon><polygon points="6 3 20 12 6 21 6 3" /></Icon>
const SquareIcon = () => <Icon><rect width="18" height="18" x="3" y="3" rx="2" /></Icon>
const ReplayIcon = () => <Icon><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></Icon>

/** The action dock: Plan and run, and Stop while a run is live. Replay and Reset sit below it. */
export default function RunControls({ task, phase, canRunAgain, onPlan, onStop, onRunAgain, onReset }: RunControlsProps) {
  const planning = phase === 'planning'
  const running = phase === 'running'
  const busy = planning || running
  // Stop takes focus when it appears, without scrolling the page.
  const stopRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (busy) stopRef.current?.focus({ preventScroll: true })
  }, [busy])

  return (
    <>
      <div className="ds-actions" aria-busy={busy}>
        <button type="button" className="ds-button ds-button--primary" disabled={busy || !task.trim()} onClick={onPlan} title="Makes one model call to plan the steps, then runs them in a browser.">
          <PlayIcon />
          {planning ? 'Planning' : running ? 'Running' : 'Plan and run'}
        </button>
        {busy && (
          <button type="button" className="ds-button" ref={stopRef} onClick={onStop} title="Ends the run. A step already running may finish first.">
            <SquareIcon />
            Stop run
          </button>
        )}
      </div>
      <div className="bb-secondary">
        <button type="button" className="ds-button" disabled={busy || !canRunAgain} onClick={onRunAgain} title="Replays the same steps in a new browser session, with no model call.">
          <ReplayIcon />
          Run plan again
        </button>
        <button type="button" className="ds-button" disabled={busy || phase === 'idle'} onClick={onReset} title="Clears the run and its pictures. Your task stays.">
          Reset
        </button>
      </div>
    </>
  )
}
