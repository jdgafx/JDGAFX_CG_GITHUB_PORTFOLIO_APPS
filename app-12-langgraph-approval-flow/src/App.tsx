import { useCallback, useEffect, useRef, useState } from 'react'
import type { StreamEvent } from '../netlify/shared/events'
import { ApprovalCard } from './components/ApprovalCard'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { IssueBanner } from './components/IssueBanner'
import { IssueList, keyOf, type IssuesState } from './components/IssueList'
import { Readout } from './components/Readout'
import { RepoPicker } from './components/RepoPicker'
import { RetryCard } from './components/RetryCard'
import { ThreadsCard, type ThreadsState } from './components/ThreadsCard'
import { TraceCard } from './components/TraceCard'
import { TriageCard, outcomeOf } from './components/TriageCard'
import { failureText, fetchThread, fetchThreads, type ThreadResponse as ThreadViewResponse, isAbortError, resumeThread, retryThread, startIssue } from './lib/api'
import { GitHubError, listOpenIssues, parseRepoInput, slugOf } from './lib/github'
import { outcomeAfterFailure } from './lib/resume-failure'
import { applyEvent, emptyRun, runFromView, type Phase, type RunView } from './lib/run-state'
import { approvalVisible, NO_STREAM, runningLine, type StreamFlow } from './lib/stream-view'
import { PRESET_REPOS } from './constants'
import { NODES, type HumanDecision, type IssueInput, type NodeName } from './types'

/** The one status line under the header. */
function statusLine(phase: Phase, run: RunView, current: NodeName | null, flow: StreamFlow): string {
  switch (phase) {
    case 'idle':
      return 'Ready. Pick an issue and start the triage to watch the graph work.'
    case 'running':
      return runningLine(current, flow)
    case 'paused':
      return 'Paused for a maintainer. Approve the triage, edit the labels and priority, or reject it.'
    case 'done':
      return run.result ? `Finished. ${outcomeOf(run.result)}.` : 'Finished.'
    case 'failed':
      return 'The run stopped. The message on the page says why, and the trace marks the step.'
  }
}

type Stream = (onEvent: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>

/** While another run holds a thread, the page looks again this often, and gives up after this many looks. */
const WATCH_EVERY_MS = 2_000
const WATCH_ATTEMPTS = 10

const NO_ISSUES: IssuesState = { loading: false, repo: null, items: [], error: null }

/** On a narrow screen the run sits below the lists, so a started run scrolls into view. */
function showRun(element: HTMLElement | null): void {
  if (!element || !window.matchMedia('(max-width: 999px)').matches) return
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
}

/** After a thread is opened from the list, bring its card into view at any width and move focus to it. */
function revealOpenedThread(fallback: HTMLElement | null): void {
  const heading = document.querySelector<HTMLElement>('#approval-heading, #triage-heading')
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const target = heading ?? fallback
  target?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  if (heading) {
    heading.tabIndex = -1
    heading.focus({ preventScroll: true })
  }
}

export default function App() {
  const [issues, setIssues] = useState<IssuesState>(NO_ISSUES)
  const [run, setRun] = useState<RunView>(() => emptyRun())
  const [phase, setPhase] = useState<Phase>('idle')
  const [flow, setFlow] = useState<StreamFlow>(NO_STREAM)
  const [requestError, setRequestError] = useState<string | null>(null)
  /** A neutral line about a thread that another maintainer is handling or has handled, with a way to look again. */
  const [notice, setNotice] = useState<{ text: string; threadId: string | null } | null>(null)
  const [threads, setThreads] = useState<ThreadsState>({
    loading: true,
    storage: null,
    notice: null,
    items: [],
    error: null,
  })
  const streamRef = useRef<AbortController | null>(null)
  const issuesRef = useRef<AbortController | null>(null)
  const runRef = useRef<HTMLDivElement | null>(null)
  const [opened, setOpened] = useState(0)
  // The thread id of the run on the page, readable inside stream() whatever render it was created in.
  const threadOf = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadThreads = useCallback(async (signal?: AbortSignal) => {
    try {
      const body = await fetchThreads(signal)
      setThreads({ loading: false, storage: body.storage, notice: body.notice, items: body.threads, error: null })
    } catch (err) {
      if (isAbortError(err)) return
      setThreads((prev) => ({ ...prev, loading: false, error: failureText(err) }))
    }
  }, [])

  /** Loads a repo's newest open issues from GitHub, straight from the browser. */
  const loadIssues = useCallback(async (text: string) => {
    const repo = parseRepoInput(text)
    if (!repo) {
      setIssues((prev) => ({ ...prev, error: 'That is not a repo. Use owner/name, for example react/react.' }))
      return
    }
    issuesRef.current?.abort()
    const controller = new AbortController()
    issuesRef.current = controller
    setIssues({ loading: true, repo: slugOf(repo), items: [], error: null })
    try {
      const items = await listOpenIssues(repo, controller.signal)
      setIssues({ loading: false, repo: slugOf(repo), items, error: null })
    } catch (err) {
      if (isAbortError(err)) return
      const error = err instanceof GitHubError ? err.message : 'The issues could not be loaded. Try again.'
      setIssues({ loading: false, repo: slugOf(repo), items: [], error })
    }
  }, [])

  // The saved threads load on every page visit, so a thread waiting for a maintainer survives a reload.
  // The first well-known repo loads too, so the page opens with live issues.
  useEffect(() => {
    const controller = new AbortController()
    void loadThreads(controller.signal)
    void loadIssues(PRESET_REPOS[0])
    return () => {
      controller.abort()
      issuesRef.current?.abort()
    }
  }, [loadThreads, loadIssues])

  // The opened thread's card is rendered by the time this runs, so it can be scrolled to and focused.
  useEffect(() => {
    if (opened > 0) revealOpenedThread(runRef.current)
  }, [opened])

  // Leaving the page stops a run that is still streaming, and a watch on a thread another run holds.
  useEffect(
    () => () => {
      streamRef.current?.abort()
      if (pollRef.current) clearInterval(pollRef.current)
    },
    [],
  )

  /** Runs one stream (a new issue or a resume) and folds its events into the page. */
  const stream = async (open: Stream, resuming = false) => {
    streamRef.current?.abort()
    const controller = new AbortController()
    streamRef.current = controller
    const from = phase
    let eventsArrived = false
    setRequestError(null)
    setNotice(null)
    stopWatching()
    setFlow({ resuming, eventsArrived: false })
    setPhase('running')

    const outcome: { phase: Phase | null } = { phase: null }
    const onEvent = (event: StreamEvent) => {
      eventsArrived = true
      setFlow((prev) => (prev.eventsArrived ? prev : { ...prev, eventsArrived: true }))
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
        const after = outcomeAfterFailure({ from, eventsArrived, resuming, error: err })
        if (after.reopen && threadOf.current) {
          // Another maintainer got there first. Show the thread as it really is, with their result.
          await handleOpen(threadOf.current, `${failureText(err)} This is the thread as it is now.`)
        } else {
          setRequestError(after.message ?? failureText(err))
          setPhase(after.phase)
        }
      }
    } finally {
      if (streamRef.current === controller) {
        streamRef.current = null
        setFlow(NO_STREAM)
      }
      void loadThreads()
    }
  }

  const handleTriage = (issue: IssueInput) => {
    const { repo, number, title, htmlUrl } = issue
    setRun(emptyRun({ repo, number, title, htmlUrl }))
    showRun(runRef.current)
    void stream((onEvent, signal) => startIssue(issue, onEvent, signal))
  }

  const handleDecide = (decision: HumanDecision) => {
    const threadId = run.threadId
    if (!threadId) {
      setRequestError('This thread has no id, so it cannot be resumed. Open it again from the list.')
      return
    }
    void stream((onEvent, signal) => resumeThread(threadId, decision, onEvent, signal), true)
  }

  const handleRetry = () => {
    const threadId = run.threadId
    if (!threadId) return
    setRun((prev) => ({ ...prev, error: null }))
    void stream((onEvent, signal) => retryThread(threadId, onEvent, signal))
  }

  const stopWatching = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }

  /** Shows a thread as the server reports it. A thread another run holds is watched until it is free. */
  const applyView = (view: ThreadViewResponse, note: string | null) => {
    stopWatching()
    setRun(runFromView(view))
    setOpened((count) => count + 1)
    if (view.status === 'running') {
      // Another run holds the thread, so there is no card to answer and nothing to retry yet.
      setPhase('idle')
      setNotice({ text: 'Another maintainer is handling this thread. The page checks every 2 seconds and shows the result when it is done.', threadId: view.threadId })
      let attempts = 0
      pollRef.current = setInterval(() => {
        attempts += 1
        void fetchThread(view.threadId)
          .then((latest) => {
            if (latest.status !== 'running') applyView(latest, 'Another maintainer handled this thread. This is the result.')
            else if (attempts >= WATCH_ATTEMPTS) {
              stopWatching()
              setNotice({ text: 'This thread is still being handled. Use Refresh to check again.', threadId: view.threadId })
            }
          })
          .catch(() => {
            if (attempts >= WATCH_ATTEMPTS) stopWatching()
          })
      }, WATCH_EVERY_MS)
    } else {
      setPhase(view.status === 'awaiting_approval' ? 'paused' : view.status === 'completed' ? 'done' : 'failed')
      setNotice(note ? { text: note, threadId: null } : null)
    }
  }

  const handleOpen = async (threadId: string, note: string | null = null) => {
    setRequestError(null)
    setNotice(null)
    try {
      applyView(await fetchThread(threadId), note)
    } catch (err) {
      if (!isAbortError(err)) setRequestError(failureText(err))
    }
  }

  const handleRefresh = () => {
    setThreads((prev) => ({ ...prev, loading: true }))
    void loadThreads()
  }

  threadOf.current = run.threadId

  const busy = phase === 'running'
  const current = phase === 'running' ? (NODES.find((node) => run.nodes[node] === 'running') ?? null) : null

  return (
    <div className="ds-app">
      <Header phase={phase} />

      <main className="ds-main">
        <p className="ds-hint gg-live" role="status" aria-live="polite">
          {statusLine(phase, run, current, flow)}
        </p>
        {notice ? (
          <div className="gg-notice-row">
            <p className="ds-notice" role="status">
              {notice.text}
            </p>
            {notice.threadId ? (
              <button type="button" className="ds-button" onClick={() => void handleOpen(notice.threadId as string)}>
                Refresh now
              </button>
            ) : null}
          </div>
        ) : null}
        {requestError ? (
          <p className="ds-notice ds-notice--error" role="alert">
            {requestError}
          </p>
        ) : null}

        <div className="ds-bench">
          <div className="ds-controls">
            <RepoPicker loaded={issues.repo} loading={issues.loading} busy={busy} onLoad={(text) => void loadIssues(text)} />
            <IssueList
              state={issues}
              busy={busy}
              activeKey={run.issue ? keyOf(run.issue) : null}
              onTriage={handleTriage}
            />
            <ThreadsCard state={threads} busy={busy} onRefresh={handleRefresh} onOpen={(id) => void handleOpen(id)} />
          </div>

          <div className="ds-run" ref={runRef}>
            {run.issue ? <IssueBanner issue={run.issue} /> : null}
            {run.error ? (
              <p className="ds-notice ds-notice--error" role="alert">
                {run.error}
              </p>
            ) : null}
            {phase === 'failed' && run.retryable ? <RetryCard busy={busy} onRetry={handleRetry} /> : null}
            <GraphView run={run} />
            <Readout run={run} />
            {approvalVisible(phase, flow, run.proposal !== null) && run.proposal ? (
              <ApprovalCard key={run.threadId ?? 'proposal'} proposal={run.proposal} busy={busy} onDecide={handleDecide} />
            ) : null}
            {run.result ? <TriageCard result={run.result} /> : null}
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
