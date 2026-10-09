import { useEffect, useReducer, useRef, useState } from 'react'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { InputPanel } from './components/InputPanel'
import { ReadoutStrip } from './components/ReadoutStrip'
import { ResultCard } from './components/ResultCard'
import { TracePanel } from './components/TracePanel'
import { runAnalysis } from './lib/api'
import { MAX_CHARS, MIN_CHARS } from './lib/limits'
import { NARROW_BELOW_PX, shouldScrollToResult } from './lib/scrollToResult'
import { statusLine } from './lib/status'
import { applyFrame, endView, failView, initialView, stopView, type RunView } from './lib/view'
import type { Frame } from './types/frames'

type Action =
  | { type: 'start'; now: number }
  | { type: 'clock-stop'; now: number }
  | { type: 'frame'; frame: Frame }
  | { type: 'fail'; message: string }
  | { type: 'stop' }
  | { type: 'end' }

function reduce(view: RunView, action: Action): RunView {
  switch (action.type) {
    case 'start':
      return { ...initialView(), phase: 'running', startedAt: action.now }
    case 'clock-stop':
      return view.startedAt !== null && view.endedAt === null ? { ...view, endedAt: action.now } : view
    case 'frame':
      return applyFrame(view, action.frame)
    case 'fail':
      return failView(view, action.message)
    case 'stop':
      return stopView(view)
    case 'end':
      return endView(view)
  }
}

function isValid(text: string): boolean {
  return text.length >= MIN_CHARS && text.length <= MAX_CHARS && text.trim().length > 0
}

export default function App() {
  const [text, setText] = useState('')
  const [view, dispatch] = useReducer(reduce, undefined, initialView)
  /** The text of the run on screen. The box can be edited after a run, so the coverage map reads this copy. */
  const [analyzed, setAnalyzed] = useState('')
  const [collapseKey, setCollapseKey] = useState(0)
  const startScroll = useRef(0)
  const busy = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const running = view.phase === 'running'
  const valid = isValid(text)

  // Leaving the page stops the stream, so no request keeps running in the background.
  useEffect(() => () => controller.current?.abort(), [])

  // When a run ends, bring the result into view on a narrow screen (unless the visitor scrolled during the run)
  // and move focus to its heading when focus has fallen to the page body.
  const ended = view.phase === 'done' || view.phase === 'error' || view.phase === 'stopped'
  useEffect(() => {
    const target = document.querySelector<HTMLElement>('[data-result-focus]')
    if (!ended || !target) return
    const scrolledBy = window.scrollY - startScroll.current
    if (shouldScrollToResult({ width: window.innerWidth, ended, scrolledBy })) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.closest('.ds-run__result')?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
    }
    if (document.activeElement === document.body || document.activeElement === null) target.focus({ preventScroll: true })
  }, [ended])

  async function analyze(source: string): Promise<void> {
    if (busy.current || !isValid(source)) return
    busy.current = true
    startScroll.current = window.scrollY
    if (window.innerWidth < NARROW_BELOW_PX) setCollapseKey((n) => n + 1)
    // Folding the list moves the page; measure the visitor's scrolling from where it settles.
    requestAnimationFrame(() => requestAnimationFrame(() => (startScroll.current = window.scrollY)))
    const current = new AbortController()
    controller.current = current
    setAnalyzed(source)
    dispatch({ type: 'start', now: Date.now() })
    try {
      await runAnalysis(source, (frame) => dispatch({ type: 'frame', frame }), current.signal)
      if (current.signal.aborted) dispatch({ type: 'stop' })
      else dispatch({ type: 'end' })
    } catch (err) {
      // An abort from the Stop button is not a connection failure, so it never shows the connection message.
      if (current.signal.aborted) {
        dispatch({ type: 'stop' })
      } else {
        dispatch({ type: 'fail', message: err instanceof Error ? err.message : 'Something went wrong. Please try again.' })
      }
    } finally {
      busy.current = false
      dispatch({ type: 'clock-stop', now: Date.now() })
    }
  }

  return (
    <div className="ds-app" data-run={view.phase === 'error' ? 'failed' : view.phase}>
      <Header phase={view.phase} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <InputPanel
              text={text}
              running={running}
              valid={valid}
              onChange={setText}
              onRun={() => void analyze(text)}
              onStop={() => controller.current?.abort()}
              collapseKey={collapseKey}
            />
            <p className="ds-help" role="status">
              {statusLine(view, text.length, valid)}
            </p>
            {view.error ? (
              <div className="ds-notice ds-notice--error" role="alert">
                {view.error}
              </div>
            ) : null}
          </div>

          <div className="ds-run">
            <ResultCard view={view} analyzed={analyzed} onRetry={() => void analyze(text)} />
            <ReadoutStrip view={view} />
            <GraphView view={view} />
            <TracePanel view={view} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
