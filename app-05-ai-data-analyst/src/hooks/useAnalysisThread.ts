import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { planAndRun, type StepOutcome } from '../lib/analysis'
import { AnalysisRunError, CancelledError, clientRun } from '../lib/api'
import type { ParsedData, RunView, Thread, ThreadStep, Vocabulary } from '../types'

const MAX_THREADS = 10
const UNEXPECTED = 'The analysis could not be completed. Please try again.'

export type AskMode = 'new' | 'follow-up'

interface Pending {
  question: string
  mode: AskMode
  startedAt: number
}

export interface AnalysisThreadState {
  threads: Thread[]
  /** The thread on screen, or null before the first answer and after the data changed. */
  thread: Thread | null
  /** The step whose chart and answer are on screen. */
  step: ThreadStep | null
  /** The run to show: the step's own, or the failed or stopped one that came after it. Null while running. */
  run: RunView | null
  pending: Pending | null
  error: string | null
  /** Set when a new question named nothing in the data: the reason, with no chart and no number. Cleared by the next action. */
  unanswered: { question: string; message: string } | null
  /** True when the loaded rows are the ones the on-screen thread was computed from. */
  canFollowUp: boolean
  /** `replayed` marks a step whose reply came from a recording, so it is never shown as a live answer. */
  ask: (question: string, mode: AskMode, replayed?: boolean) => Promise<boolean>
  stop: () => void
  openStep: (id: string) => void
  openThread: (id: string) => void
  /** Puts the thread away without losing it, for when the rows change under it. */
  close: () => void
  /** Puts away every thread that holds a replayed step: Run it live replaces the recording with a real run. */
  dropReplayed: () => void
  /** Clears a failed or unanswered run: its message and box, so the page falls back to the open step's own run. */
  dismissError: () => void
}

interface Source {
  data: ParsedData | null
  dataset: string
  vocab: Vocabulary
}

/**
 * The analysis thread: every question and follow-up asked about the loaded rows, each with its plan
 * change, answer and run, and which one is on screen. Threads live for the session only.
 */
export function useAnalysisThread({ data, dataset, vocab }: Source): AnalysisThreadState {
  const [threads, setThreads] = useState<Thread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [stepId, setStepId] = useState<string | null>(null)
  const [ended, setEnded] = useState<RunView | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<{ question: string; message: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Never leave a request in flight after the view goes away.
  useEffect(() => () => abortRef.current?.abort(), [])

  const thread = useMemo(() => threads.find((item) => item.id === threadId) ?? null, [threads, threadId])
  const step = useMemo(() => thread?.steps.find((item) => item.id === stepId) ?? null, [thread, stepId])
  const canFollowUp = Boolean(thread && step && data && thread.dataset === dataset)

  const ask = useCallback(
    async (question: string, mode: AskMode, replayed = false): Promise<boolean> => {
      const asked = question.trim()
      if (!data || !asked || abortRef.current) return false
      const base = mode === 'follow-up' && thread && step && thread.dataset === dataset ? step : null
      const controller = new AbortController()
      abortRef.current = controller
      const startedAt = Date.now()
      setPending({ question: asked, mode: base ? 'follow-up' : 'new', startedAt })
      setError(null)
      setEnded(null)
      setUnanswered(null)

      let outcome: StepOutcome | null = null
      try {
        outcome = await planAndRun(
          { question: asked, data, dataset, vocab, ...(base ? { previous: base.result } : {}), ...(replayed ? { replayed } : {}) },
          controller.signal,
        )
      } catch (err) {
        if (err instanceof CancelledError) {
          setEnded({ ...clientRun('Stopped by you before a reply.', startedAt, 'skipped'), outcome: 'stopped' })
        } else if (err instanceof AnalysisRunError) {
          setEnded({ ...err.run, outcome: 'failed' })
          setError(err.message)
        } else {
          setEnded({ ...clientRun(UNEXPECTED, startedAt), outcome: 'failed' })
          setError(UNEXPECTED)
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setPending(null)
      }
      if (!outcome) return false
      if (outcome.kind === 'invalid') {
        setEnded(outcome.run)
        setError(outcome.error)
        return false
      }
      if (outcome.kind === 'unanswered') {
        setEnded(outcome.run)
        setUnanswered({ question: asked, message: outcome.message })
        return false
      }

      const made: ThreadStep = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        question: asked,
        kind: base ? 'follow-up' : 'ask',
        changes: outcome.kind === 'done' ? outcome.changes : [],
        ...(outcome.kind === 'not-applied' ? { notApplied: outcome.reason } : {}),
        ...(base ? { basedOn: base.id } : {}),
        ...(replayed ? { replayed: true } : {}),
        result: outcome.result,
        run: outcome.run,
        timestamp: new Date(),
      }
      if (base && thread) {
        setThreads((all) => all.map((item) => (item.id === thread.id ? { ...item, steps: [...item.steps, made] } : item)))
      } else {
        const fresh: Thread = { id: made.id, dataset, steps: [made] }
        setThreads((all) => [fresh, ...all].slice(0, MAX_THREADS))
        setThreadId(fresh.id)
      }
      setStepId(made.id)
      return true
    },
    [data, dataset, vocab, thread, step],
  )

  return {
    threads,
    thread,
    step,
    run: pending ? null : (ended ?? step?.run ?? null),
    pending,
    error,
    unanswered,
    canFollowUp,
    ask,
    stop: () => abortRef.current?.abort(),
    openStep: (id) => {
      setStepId(id)
      setEnded(null)
      setError(null)
      setUnanswered(null)
    },
    openThread: (id) => {
      const next = threads.find((item) => item.id === id)
      if (!next) return
      setThreadId(id)
      setStepId(next.steps[next.steps.length - 1]?.id ?? null)
      setEnded(null)
      setError(null)
      setUnanswered(null)
    },
    close: () => {
      setThreadId(null)
      setStepId(null)
      setEnded(null)
      setError(null)
      setUnanswered(null)
    },
    dropReplayed: () => {
      setThreads((all) => all.filter((item) => !item.steps.some((made) => made.replayed)))
      setThreadId(null)
      setStepId(null)
      setEnded(null)
      setError(null)
      setUnanswered(null)
    },
    dismissError: () => {
      setError(null)
      setEnded(null)
      setUnanswered(null)
    },
  }
}
