import { useEffect, useReducer, useRef, useState } from 'react'
import { GraphView } from './components/GraphView'
import { InputPanel } from './components/InputPanel'
import { MetricsRow } from './components/MetricsRow'
import { CoverageCard, SummaryCard } from './components/ResultPanel'
import { TracePanel } from './components/TracePanel'
import { runAnalysis } from './lib/api'
import { MAX_CHARS, MIN_CHARS } from './lib/limits'
import { metricsFor } from './lib/metrics'
import { SAMPLE_TEXT } from './lib/sample'
import { applyFrame, endView, failView, initialView, type RunView } from './lib/view'
import type { Frame } from './types/frames'

type Action =
  | { type: 'start' }
  | { type: 'frame'; frame: Frame }
  | { type: 'fail'; message: string }
  | { type: 'end' }

function reduce(view: RunView, action: Action): RunView {
  switch (action.type) {
    case 'start':
      return { ...initialView(), phase: 'running', live: 'Starting the run' }
    case 'frame':
      return applyFrame(view, action.frame)
    case 'fail':
      return failView(view, action.message)
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
      dispatch({ type: 'end' })
    } catch (err) {
      dispatch({ type: 'fail', message: err instanceof Error ? err.message : 'Something went wrong. Please try again.' })
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
            <p className="ds-subtitle">LangGraph map-reduce document analyst</p>
          </div>
          <span className="ds-badge">Parallel extract, one bounded retry</span>
        </div>
      </header>

      <main className="ds-main">
        <InputPanel
          text={text}
          running={running}
          valid={isValid(text)}
          onChange={setText}
          onSample={() => {
            setText(SAMPLE_TEXT)
            void analyze(SAMPLE_TEXT)
          }}
          onRun={() => void analyze(text)}
        />

        {view.error ? (
          <div className="ds-notice ds-notice--error" role="alert">
            {view.error}
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {view.live}
        </p>

        <GraphView view={view} />

        <div className="ds-grid-2">
          <SummaryCard result={view.result} />
          <CoverageCard result={view.result} />
        </div>

        <MetricsRow metrics={metrics} complete={view.result !== null} />
        <TracePanel rows={view.rows} />
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
