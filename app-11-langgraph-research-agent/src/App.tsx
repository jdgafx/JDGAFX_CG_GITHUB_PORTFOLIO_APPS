import { useEffect, useReducer, useRef, useState } from 'react'
import type { Frame } from '../netlify/shared/events'
import { AnswerCard } from './components/AnswerCard'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { QuestionForm } from './components/QuestionForm'
import { ReadoutStrip } from './components/ReadoutStrip'
import { RunTrace } from './components/RunTrace'
import { INTERRUPTED_MESSAGE, streamResearch } from './lib/research'
import { applyFrame, emptyRun, failRun, researchStatus, startRun, stopRun, type RunView } from './lib/runState'

const RETRY_HINT = 'Press Start research to try again.'

type Action =
  | { type: 'start' }
  | { type: 'frame'; frame: Frame }
  | { type: 'fail'; message: string }
  | { type: 'cancel' }
  | { type: 'reset' }

function reducer(view: RunView, action: Action): RunView {
  switch (action.type) {
    case 'start':
      return startRun()
    case 'frame':
      return applyFrame(view, action.frame)
    case 'fail':
      return failRun(view, action.message)
    case 'cancel':
      return stopRun(view)
    case 'reset':
      return emptyRun()
  }
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [view, dispatch] = useReducer(reducer, undefined, emptyRun)
  const abortRef = useRef<AbortController | null>(null)
  const startScrollRef = useRef(0)
  const previousPhase = useRef(view.phase)
  const running = view.phase === 'running'

  // When a run ends, bring the result into view on a narrow screen (unless the visitor scrolled during the run)
  // and move focus to its heading, so a screen reader reads the outcome and the next Tab reaches its actions.
  useEffect(() => {
    const was = previousPhase.current
    previousPhase.current = view.phase
    if (was !== 'running' || view.phase === 'running') return
    const target = document.querySelector<HTMLElement>('[data-result-focus]')
    if (!target) return
    const narrow = !window.matchMedia('(min-width: 1000px)').matches
    const scrolled = Math.abs(window.scrollY - startScrollRef.current) > 40
    if (narrow && !scrolled) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.closest('.ds-run__result')?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
    }
    const active = document.activeElement
    if (!active || active === document.body) target.focus({ preventScroll: true })
  }, [view.phase])

  // Leaving the page ends the run, so no request keeps billing after the visitor is gone.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const submit = async () => {
    const text = question.trim()
    if (text === '' || running) return
    startScrollRef.current = window.scrollY
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    let terminal = false
    dispatch({ type: 'start' })
    try {
      await streamResearch(text, controller.signal, (frame) => {
        if (frame.type === 'result' || frame.type === 'error') terminal = true
        dispatch({ type: 'frame', frame })
      })
      if (!controller.signal.aborted && !terminal) {
        dispatch({ type: 'fail', message: INTERRUPTED_MESSAGE })
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        dispatch({ type: 'fail', message: err instanceof Error ? err.message : INTERRUPTED_MESSAGE })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'cancel' })
  }

  const loadSample = (sample: string) => {
    setQuestion(sample)
    dispatch({ type: 'reset' })
  }

  return (
    <div className="ds-app" data-run={view.phase}>
      <Header view={view} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <QuestionForm
              question={question}
              running={running}
              onChange={setQuestion}
              onSubmit={() => void submit()}
              onCancel={cancel}
              onSample={loadSample}
            />
            <p className="ds-help" role="status" aria-live="polite">
              {researchStatus(view)}
            </p>
            {view.error && (
              <div className="ds-notice ds-notice--error" role="alert">
                <p>{view.error}</p>
                <p>{RETRY_HINT}</p>
              </div>
            )}
          </div>

          <div className="ds-run">
            <AnswerCard
              result={view.result}
              phase={view.phase}
              error={view.error}
              hasSteps={view.trace.length > 0}
              onRetry={() => void submit()}
            />
            <ReadoutStrip view={view} />
            <GraphView view={view} />
            <RunTrace view={view} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
