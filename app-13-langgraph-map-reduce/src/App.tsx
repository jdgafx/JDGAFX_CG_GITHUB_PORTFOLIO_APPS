import { useEffect, useReducer, useRef, useState } from 'react'
import { GraphView } from './components/GraphView'
import { InputPanel } from './components/InputPanel'
import { MetricsRow } from './components/MetricsRow'
import { CoverageSection, SummarySection } from './components/ResultPanel'
import { TracePanel } from './components/TracePanel'
import { runAnalysis } from './lib/api'
import { MAX_CHARS, MIN_CHARS } from './lib/limits'
import { metricsFor } from './lib/metrics'
import { PHASE_WORD, phaseDot, phaseTone, statusLine } from './lib/status'
import { applyFrame, endView, failView, initialView, stopView, type RunView } from './lib/view'
import type { Frame } from './types/frames'

type Action =
  | { type: 'start' }
  | { type: 'frame'; frame: Frame }
  | { type: 'fail'; message: string }
  | { type: 'stop' }
  | { type: 'end' }

function reduce(view: RunView, action: Action): RunView {
  switch (action.type) {
    case 'start':
      return { ...initialView(), phase: 'running' }
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
  const busy = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const running = view.phase === 'running'
  const valid = isValid(text)

  // Leaving the page stops the stream, so no request keeps running in the background.
  useEffect(() => () => controller.current?.abort(), [])

  async function analyze(source: string): Promise<void> {
    if (busy.current || !isValid(source)) return
    busy.current = true
    const current = new AbortController()
    controller.current = current
    dispatch({ type: 'start' })
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
    }
  }

  const metrics = view.result?.metrics ?? (view.rows.length > 0 ? metricsFor(view.rows, 0) : null)

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div>
            <h1 className="ds-title">GraphSwarm</h1>
            <p className="ds-subtitle">Load a Wikipedia article or paste a long document and get a cited summary, with the tokens and cost of every model call.</p>
          </div>
          <span className={`ds-badge ${phaseTone(view.phase)}`}>
            <span className={phaseDot(view.phase)} aria-hidden="true" />
            {PHASE_WORD[view.phase]}
          </span>
          <p className="ds-showcase">
            <strong>What this showcases:</strong> a LangGraph map-reduce: many parallel extractions, one synthesis that
            cites its chunks, and a coverage check that re-runs only what was missed.
          </p>
        </div>
      </header>

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
            />
            {view.error ? (
              <div className="ds-notice ds-notice--error" role="alert">
                {view.error}
              </div>
            ) : null}
          </div>

          <div className="ds-run">
            <p className="run-status" role="status">
              {statusLine(view, text.length, valid)}
            </p>
            <GraphView view={view} />
            <MetricsRow metrics={metrics} phase={view.phase} rows={view.rows} />
            <SummarySection result={view.result} phase={view.phase} />
            <CoverageSection result={view.result} phase={view.phase} />
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
