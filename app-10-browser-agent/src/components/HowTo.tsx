import { useState } from 'react'
import type { Phase } from '../lib/runState'

interface HowToProps {
  phase: Phase
  /** Changes with every run, so a visitor's own open or close choice applies to one run only. */
  runId: number
  /** Fills the task field with the example and starts the run, which is the same path as Plan and run. */
  onTry: () => void
}

/** The phases in which a result is on screen. */
const SHOWING_RESULT: ReadonlySet<Phase> = new Set<Phase>(['complete', 'failed', 'stopped'])

/**
 * The directions: what the app does, three numbered steps that name the controls as they appear, and a button that runs
 * a real example. Open on the first visit, and folded away while a result is shown, so the result keeps its place.
 */
export default function HowTo({ phase, runId, onTry }: HowToProps) {
  const [choice, setChoice] = useState<{ runId: number; open: boolean } | null>(null)
  const busy = phase === 'planning' || phase === 'running'
  const open = choice && choice.runId === runId ? choice.open : !SHOWING_RESULT.has(phase)

  return (
    <section className="howto" aria-labelledby="howto-title">
      <details open={open} onToggle={(event) => setChoice({ runId, open: event.currentTarget.open })}>
        <summary>
          <h2 className="howto__title" id="howto-title">How to use</h2>
        </summary>
        <div className="howto__body">
          <p className="howto__line">Give the browser a task and watch a real web page load, one step at a time.</p>
          <ol className="howto__steps">
            <li>Type a task in <strong>Describe a web task</strong>, or pick one under <strong>Example tasks</strong>.</li>
            <li>Press <strong>Plan and run</strong>. A real browser opens each page, which takes about 10 seconds.</li>
            <li>Step through the replay: select a step in the strip, drag the scrub bar, or use the left and right arrow keys.</li>
          </ol>
          <button type="button" className="ds-button ds-button--primary howto__try" disabled={busy} onClick={onTry}>
            Try it: Hacker News top stories
          </button>
        </div>
      </details>
    </section>
  )
}
