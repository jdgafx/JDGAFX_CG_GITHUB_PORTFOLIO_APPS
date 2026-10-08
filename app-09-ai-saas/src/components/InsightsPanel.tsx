import { useEffect, useRef, useState } from 'react'
import type { SummaryStats } from '../lib/mockData'
import {
  getInsights,
  abortInsights,
  isAbortError,
  RunError,
  type RunOutcome,
  type TraceStep,
} from '../lib/api'
import RunTrace from './RunTrace'
import RunMetrics from './RunMetrics'

interface InsightsPanelProps {
  stats: SummaryStats
}

type RunStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

const COMPLETE_LABEL = 'Analysis complete'

export default function InsightsPanel({ stats }: InsightsPanelProps) {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [stage, setStage] = useState('')
  const [answer, setAnswer] = useState('')
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const completedRef = useRef(false)

  // Leaving the dashboard (Exit Demo, sign out, navigation) must not leave a
  // stream running against the function.
  useEffect(() => abortInsights, [])

  const handleGenerate = async () => {
    completedRef.current = false
    setStatus('running')
    setStage('Sending the summary figures to the server')
    setAnswer('')
    setSteps([])
    setOutcome(null)
    setTotalMs(null)
    setErrorMessage('')

    try {
      await getInsights(stats, {
        onStage: () => setStage('Streaming the analysis'),
        onStep: (step) => {
          setSteps((prev) => [...prev, step])
          if (step.name === 'Call model' && step.status === 'ok') setStage('Waiting for the first words')
        },
        onText: (chunk) => setAnswer((prev) => prev + chunk),
        onComplete: (run) => {
          completedRef.current = true
          setOutcome(run)
          setAnswer(run.result)
          setTotalMs(run.totalMs)
          setStatus('done')
        },
      })
      if (!completedRef.current) {
        setStatus('failed')
        setErrorMessage('The run ended before the analysis finished. Try again.')
      }
    } catch (err) {
      if (isAbortError(err)) {
        setStatus('stopped')
        return
      }
      setStatus('failed')
      setErrorMessage(err instanceof Error ? err.message : 'The analysis could not be completed. Try again.')
      setTotalMs(err instanceof RunError ? err.totalMs : null)
    }
  }

  const handleStop = () => abortInsights()

  const running = status === 'running'
  const anyFailedStep = steps.some((step) => step.status === 'failed')
  const statusLine: Record<RunStatus, string> = {
    idle: '',
    running: stage,
    done: anyFailedStep ? `${COMPLETE_LABEL}, with a failed check. See the trace.` : COMPLETE_LABEL,
    failed: 'Run failed',
    stopped: 'Stopped',
  }

  return (
    <>
      <section className="ds-card" aria-labelledby="analysis-title">
        <div className="ds-card__head">
          <h2 id="analysis-title" className="ds-card__title">AI analysis</h2>
          <span className="ds-hint">Sends only the summary figures above. The server calls the model.</span>
        </div>

        <div className="ds-row">
          <button type="button" className="ds-button ds-button--primary" onClick={handleGenerate} disabled={running}>
            {running ? 'Generating…' : answer ? 'Regenerate' : 'Generate insights'}
          </button>
          {running && (
            <button type="button" className="ds-button" onClick={handleStop}>
              Stop
            </button>
          )}
          {running && (
            <span className="ds-badge ds-badge--accent">
              <span className="hub-live-dot" aria-hidden="true" />
              Running
            </span>
          )}
        </div>

        <p role="status" className="ds-hint">{statusLine[status]}</p>

        {status === 'failed' && (
          <div role="alert" className="ds-notice ds-notice--error">
            {errorMessage}
          </div>
        )}

        {status === 'idle' && (
          <div className="ds-empty">
            Generate insights to send the figures above to the model. The answer streams in here, and the run
            trace shows each step.
          </div>
        )}

        {(answer !== '' || running) && (
          <div className="hub-answer" aria-live="polite" aria-busy={running}>
            {answer || 'Waiting for the first words…'}
          </div>
        )}

        {status === 'stopped' && (
          <p role="status" className="ds-hint">
            Stopped. The text above is what arrived before you stopped.
          </p>
        )}
      </section>

      {steps.length > 0 && <RunTrace steps={steps} />}

      {(status === 'done' || status === 'failed') && (
        <RunMetrics totalMs={totalMs} usage={outcome?.usage ?? null} model={outcome?.model ?? null} />
      )}
    </>
  )
}
