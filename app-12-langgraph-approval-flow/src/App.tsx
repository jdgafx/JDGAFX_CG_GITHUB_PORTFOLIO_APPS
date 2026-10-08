import { useCallback, useEffect, useRef, useState } from 'react'
import type { StreamEvent } from '../netlify/shared/events'
import { ApprovalCard } from './components/ApprovalCard'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { Readout } from './components/Readout'
import { ReplyCard, outcomeOf } from './components/ReplyCard'
import { ThreadsCard, type ThreadsState } from './components/ThreadsCard'
import { TicketForm } from './components/TicketForm'
import { TraceCard } from './components/TraceCard'
import { SAMPLE_TICKETS, type SampleTicket } from './constants'
import { failureText, fetchThread, fetchThreads, isAbortError, resumeThread, startTicket } from './lib/api'
import { ticketProblem } from './lib/limits'
import { applyEvent, emptyRun, NODES, runFromView, type Phase, type RunView } from './lib/run-state'
import type { HumanDecision, NodeName } from './types'

/** The one status line under the header. It uses the same verb as the Start button. */
function statusLine(phase: Phase, run: RunView, current: NodeName | null): string {
  switch (phase) {
    case 'idle':
      return 'Ready. Start the refund run to watch the graph work.'
    case 'running':
      return current ? `Running the ${current} step.` : 'Starting the refund run.'
    case 'paused':
      return 'Paused for a person. Approve the refund, edit the amount, or reject it.'
    case 'done':
      return run.result ? `Finished. ${outcomeOf(run.result)}.` : 'Finished.'
    case 'failed':
      return 'The run stopped. The message on the page says why, and the trace marks the step.'
  }
}

type Stream = (onEvent: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>

export default function App() {
  const [ticket, setTicket] = useState(SAMPLE_TICKETS[0].text)
  const [run, setRun] = useState<RunView>(() => emptyRun())
  const [phase, setPhase] = useState<Phase>('idle')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadsState>({
    loading: true,
    storage: null,
    notice: null,
    items: [],
    error: null,
  })
  const streamRef = useRef<AbortController | null>(null)

  const loadThreads = useCallback(async (signal?: AbortSignal) => {
    try {
      const body = await fetchThreads(signal)
      setThreads({ loading: false, storage: body.storage, notice: body.notice, items: body.threads, error: null })
    } catch (err) {
      if (isAbortError(err)) return
      setThreads((prev) => ({ ...prev, loading: false, error: failureText(err) }))
    }
  }, [])

  // The list loads on every page visit, so a thread waiting for approval survives a reload.
  useEffect(() => {
    const controller = new AbortController()
    void loadThreads(controller.signal)
    return () => controller.abort()
  }, [loadThreads])

  // Leaving the page stops a run that is still streaming.
  useEffect(() => () => streamRef.current?.abort(), [])

  /** Runs one stream (a new ticket or a resume) and folds its events into the page. */
  const stream = async (open: Stream) => {
    streamRef.current?.abort()
    const controller = new AbortController()
    streamRef.current = controller
    setRequestError(null)
    setPhase('running')

    const outcome: { phase: Phase | null } = { phase: null }
    const onEvent = (event: StreamEvent) => {
      setRun((prev) => applyEvent(prev, event))
      if (event.type === 'interrupt') {
        outcome.phase = 'paused'
        setPhase('paused')
      } else if (event.type === 'result') {
        outcome.phase = 'done'
        setPhase('done')
      } else if (event.type === 'error') {
        outcome.phase = 'failed'
        setPhase('failed')
      }
    }

    try {
      await open(onEvent, controller.signal)
      if (outcome.phase === null) {
        setRequestError('The run ended without an answer. Try again.')
        setPhase('failed')
      }
    } catch (err) {
      if (!isAbortError(err)) {
        setRequestError(failureText(err))
        setPhase('failed')
      }
    } finally {
      if (streamRef.current === controller) streamRef.current = null
      void loadThreads()
    }
  }

  const handleRun = () => {
    if (ticketProblem(ticket)) return
    setRun(emptyRun())
    void stream((onEvent, signal) => startTicket(ticket, onEvent, signal))
  }

  const handleDecide = (decision: HumanDecision) => {
    const threadId = run.threadId
    if (!threadId) {
      setRequestError('This thread has no id, so it cannot be resumed. Open it again from the list.')
      return
    }
    void stream((onEvent, signal) => resumeThread(threadId, decision, onEvent, signal))
  }

  const handleOpen = async (threadId: string) => {
    setRequestError(null)
    try {
      const view = await fetchThread(threadId)
      setRun(runFromView(view))
      setPhase(view.status === 'awaiting_approval' ? 'paused' : view.status === 'completed' ? 'done' : 'failed')
    } catch (err) {
      if (!isAbortError(err)) setRequestError(failureText(err))
    }
  }

  const handleSample = (id: SampleTicket['id']) => {
    const sample = SAMPLE_TICKETS.find((entry) => entry.id === id)
    if (sample) setTicket(sample.text)
  }

  const handleRefresh = () => {
    setThreads((prev) => ({ ...prev, loading: true }))
    void loadThreads()
  }

  const busy = phase === 'running'
  const current = phase === 'running' ? (NODES.find((node) => run.nodes[node] === 'running') ?? null) : null

  return (
    <div className="ds-app">
      <Header phase={phase} />

      <main className="ds-main">
        <p className="ds-hint gg-live" role="status" aria-live="polite">
          {statusLine(phase, run, current)}
        </p>
        {requestError ? (
          <p className="ds-notice ds-notice--error" role="alert">
            {requestError}
          </p>
        ) : null}

        <div className="ds-bench">
          <div className="ds-controls">
            <TicketForm
              ticket={ticket}
              busy={busy}
              onChange={setTicket}
              onSample={handleSample}
              onRun={handleRun}
            />
            <ThreadsCard state={threads} busy={busy} onRefresh={handleRefresh} onOpen={(id) => void handleOpen(id)} />
          </div>

          <div className="ds-run">
            {run.error ? (
              <p className="ds-notice ds-notice--error" role="alert">
                {run.error}
              </p>
            ) : null}
            <GraphView run={run} />
            <Readout run={run} />
            {phase === 'paused' && run.proposal ? (
              <ApprovalCard proposal={run.proposal} busy={busy} onDecide={handleDecide} />
            ) : null}
            {run.result ? <ReplyCard result={run.result} /> : null}
            <TraceCard run={run} current={current} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
