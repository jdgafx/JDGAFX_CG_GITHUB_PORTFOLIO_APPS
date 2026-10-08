import { useEffect, useRef, useState } from 'react'
import { abortInsights, getInsights, isAbortError, RunError, type RunOutcome, type TraceStep } from './api'
import type { SummaryStats } from './mockData'

export type RunStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

const GENERIC_FAILURE_MESSAGE = 'The analysis could not be completed. Try again.'
const INCOMPLETE_MESSAGE = 'The run ended before the analysis finished. Try again.'

/** The state of one Generate insights run, shared by the controls column and the run column. */
export interface InsightRun {
  status: RunStatus
  steps: TraceStep[]
  answer: string
  outcome: RunOutcome | null
  totalMs: number | null
  errorMessage: string
  generate: () => Promise<void>
  stop: () => void
}

export function useInsightRun(stats: SummaryStats): InsightRun {
  const [status, setStatus] = useState<RunStatus>('idle')
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [answer, setAnswer] = useState('')
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const completedRef = useRef(false)

  // Leaving the dashboard (Exit demo, sign out) must not leave a stream running against the function.
  useEffect(() => abortInsights, [])

  const generate = async () => {
    completedRef.current = false
    setStatus('running')
    setSteps([])
    setAnswer('')
    setOutcome(null)
    setTotalMs(null)
    setErrorMessage('')

    try {
      await getInsights(stats, {
        // The trace is the progress display, so the stage label needs no handling here.
        onStage: () => undefined,
        onStep: (step) => setSteps((prev) => [...prev, step]),
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
        setErrorMessage(INCOMPLETE_MESSAGE)
      }
    } catch (err) {
      if (isAbortError(err)) {
        setStatus('stopped')
        return
      }
      setStatus('failed')
      setErrorMessage(err instanceof RunError ? err.message : GENERIC_FAILURE_MESSAGE)
      setTotalMs(err instanceof RunError ? err.totalMs : null)
    }
  }

  return { status, steps, answer, outcome, totalMs, errorMessage, generate, stop: abortInsights }
}
