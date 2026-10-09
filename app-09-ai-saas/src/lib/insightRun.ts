import { useEffect, useState } from 'react'
import type { Summary } from '../../netlify/shared/contract'
import { abortInsights, getInsights, isAbortError, RunError, type RunOutcome, type TraceStep } from './api'

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

type RunState = Omit<InsightRun, 'generate' | 'stop'>

const IDLE: RunState = { status: 'idle', steps: [], answer: '', outcome: null, totalMs: null, errorMessage: '' }

/**
 * Runs the analysis for one summary. The state is tagged with the summary it was started for, so when the
 * selection or window changes the old answer reads as idle instead of describing data that is gone, and a
 * stream still in flight is cancelled.
 */
export function useInsightRun(summary: Summary | null): InsightRun {
  const key = summary ? JSON.stringify(summary) : ''
  const [tagged, setTagged] = useState<{ key: string; state: RunState }>({ key: '', state: IDLE })
  const state = tagged.key === key ? tagged.state : IDLE

  // Leaving the dashboard, or changing what it shows, must not leave a stream running against the function.
  useEffect(() => abortInsights, [key])

  const generate = async () => {
    if (!summary) return
    let completed = false
    // An update from a run started for an earlier summary finds a different key and is dropped.
    const update = (patch: (prev: RunState) => Partial<RunState>) =>
      setTagged((prev) => (prev.key === key ? { key, state: { ...prev.state, ...patch(prev.state) } } : prev))

    setTagged({ key, state: { ...IDLE, status: 'running' } })
    try {
      await getInsights(summary, {
        onStep: (step) => update((prev) => ({ steps: [...prev.steps, step] })),
        onText: (chunk) => update((prev) => ({ answer: prev.answer + chunk })),
        onComplete: (run) => {
          completed = true
          update(() => ({ outcome: run, answer: run.result, totalMs: run.totalMs, status: 'done' }))
        },
      })
      if (!completed) update(() => ({ status: 'failed', errorMessage: INCOMPLETE_MESSAGE }))
    } catch (err) {
      if (isAbortError(err)) return update(() => ({ status: 'stopped' }))
      update(() => ({
        status: 'failed',
        errorMessage: err instanceof RunError ? err.message : GENERIC_FAILURE_MESSAGE,
        totalMs: err instanceof RunError ? err.totalMs : null,
      }))
    }
  }

  return { ...state, generate, stop: abortInsights }
}
