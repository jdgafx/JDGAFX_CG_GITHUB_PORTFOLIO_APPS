import { useEffect, useReducer, useRef, useState } from 'react'
import type { Frame } from '../netlify/shared/events'
import { AnswerCard } from './components/AnswerCard'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { QuestionForm } from './components/QuestionForm'
import { RunTrace } from './components/RunTrace'
import { SAMPLE_QUESTION } from './lib/constants'
import { INTERRUPTED_MESSAGE, streamResearch } from './lib/research'
import { applyFrame, emptyRun, startRun, statusText, type RunView } from './lib/runState'

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
      return { ...view, phase: 'failed', active: null, error: action.message }
    case 'cancel':
      return { ...view, phase: 'idle', active: null, error: null }
    case 'reset':
      return emptyRun()
  }
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [view, dispatch] = useReducer(reducer, undefined, emptyRun)
  const abortRef = useRef<AbortController | null>(null)
  const running = view.phase === 'running'

  // Leaving the page ends the run, so no request keeps billing after the visitor is gone.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const submit = async () => {
    const text = question.trim()
    if (text === '' || running) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const settled = { terminal: false }
    dispatch({ type: 'start' })
    try {
      await streamResearch(text, controller.signal, (frame) => {
        if (frame.type === 'result' || frame.type === 'error') settled.terminal = true
        dispatch({ type: 'frame', frame })
      })
      if (!controller.signal.aborted && !settled.terminal) {
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

  const loadSample = () => {
    setQuestion(SAMPLE_QUESTION)
    dispatch({ type: 'reset' })
  }

  return (
    <div className="ds-app">
      <Header phase={view.phase} active={view.active} />

      <main className="ds-main">
        <div className="ds-grid-2 research-layout">
          <div className="ds-stack">
            <QuestionForm
              question={question}
              running={running}
              onChange={setQuestion}
              onSubmit={() => void submit()}
              onCancel={cancel}
              onSample={loadSample}
            />
            <p className="ds-hint" role="status" aria-live="polite">
              {statusText(view)}
            </p>
            {view.error && (
              <div className="ds-notice ds-notice--error" role="alert">
                {view.error}
              </div>
            )}
            <AnswerCard result={view.result} phase={view.phase} />
          </div>
          <GraphView view={view} />
        </div>

        <RunTrace view={view} />
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
