import { useCallback, useEffect, useRef, useState } from 'react'
import type { StreamEvent } from '../netlify/shared/events'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { IssueList, keyOf, type IssuesState } from './components/IssueList'
import { Readout } from './components/Readout'
import { RepoPicker } from './components/RepoPicker'
import { ResultCard } from './components/ResultCard'
import { ThreadsCard, type ThreadsState } from './components/ThreadsCard'
import { TraceCard } from './components/TraceCard'
import { outcomeOf } from './components/TriageCard'
import { failureText, fetchThread, fetchThreads, type ThreadResponse as ThreadViewResponse, isAbortError, resumeThread, retryThread, startIssue } from './lib/api'
import { getIssue, GitHubError, listOpenIssues, parseIssueRef, parseRepoInput, slugOf } from './lib/github'
import { runAttr } from './lib/phase'
import { useResultFocus } from './lib/useResultFocus'
import { outcomeAfterFailure } from './lib/resume-failure'
import { applyEvent, emptyRun, runFromView, settleRunning, type Phase, type RunView } from './lib/run-state'
import { NO_STREAM, runningLine, type StreamFlow } from './lib/stream-view'
import { PRESET_REPOS } from './constants'
import { NODES, type HumanDecision, type IssueInput, type NodeName } from './types'

/** The one status line in the rail. */
function statusLine(phase: Phase, run: RunView, current: NodeName | null, flow: StreamFlow, selected: IssueInput | null): string {
  switch (phase) {
    case 'idle':
      return selected ? `Ready to triage #${selected.number}.` : 'Choose an issue, then press Triage to watch the graph work.'
    case 'running':
      return runningLine(current, flow)
    case 'paused':
      return 'Paused for a maintainer. Approve the triage, edit the labels and priority, or reject it.'
    case 'done':
      return run.result ? `Finished. ${outcomeOf(run.result)}.` : 'Finished.'
    case 'failed':
      return 'The run stopped. The result panel says why, and the trace marks the step.'
    case 'stopped':
      return 'You stopped waiting. The server may still finish the thread.'
  }
}

type Stream = (onEvent: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>

/** While another run holds a thread, the page looks again this often, and gives up after this many looks. */
const WATCH_EVERY_MS = 2_000
const WATCH_ATTEMPTS = 10

const NO_ISSUES: IssuesState = { loading: false, repo: null, items: [], error: null }

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
  const stopRef = useRef<HTMLButtonElement | null>(null)
  /** The stream the visitor stopped, so its end reads as stopped and not as a failure. */
  const stoppedRef = useRef<AbortController | null>(null)
  const [selected, setSelected] = useState<IssueInput | null>(null)
  const [listOpen, setListOpen] = useState(true)
  const [startedAt, setStartedAt] = useState<number | null>(null)
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

  /** Loads a repo's newest open issues, or one issue by link or owner/name#number, straight from GitHub. */
  const loadIssues = useCallback(async (text: string) => {
    const ref = parseIssueRef(text)
    const repo = ref ? { owner: ref.owner, repo: ref.repo } : parseRepoInput(text)
    if (!repo) {
      setIssues((prev) => ({ ...prev, error: 'That is not a repo or an issue. Use owner/name, owner/name#123, or a github.com link.' }))
      return
    }
    issuesRef.current?.abort()
    const controller = new AbortController()
    issuesRef.current = controller
    setIssues({ loading: true, repo: slugOf(repo), items: [], error: null })
    try {
      const items = ref ? [await getIssue(ref, controller.signal)] : await listOpenIssues(repo, controller.signal)
      setIssues({ loading: false, repo: slugOf(repo), items, error: null })
      setSelected(ref ? items[0] : null)
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
    setStartedAt(Date.now())
    setPhase('running')
    // Stop takes focus through a ref, without scrolling the page.
    requestAnimationFrame(() => stopRef.current?.focus({ preventScroll: true }))

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
      if (controller.signal.aborted) {
        if (stoppedRef.current === controller) stopRun()
      } else if (outcome.phase === null) {
        setRequestError('The run ended without an answer. Try again.')
        setRun((prev) => settleRunning(prev, 'failed'))
        setPhase('failed')
      }
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        if (stoppedRef.current === controller) stopRun()
      } else {
        const after = outcomeAfterFailure({ from, eventsArrived, resuming, error: err })
        if (after.reopen && threadOf.current) {
          // Another maintainer got there first. Show the thread as it really is, with their result.
          await handleOpen(threadOf.current, `${failureText(err)} This is the thread as it is now.`)
        } else {
          setRequestError(after.message ?? failureText(err))
          if (after.phase === 'failed') setRun((prev) => settleRunning(prev, 'failed'))
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

  /** The page stopped waiting: the step in flight reads stopped and stops pulsing. */
  const stopRun = () => {
    setRun((prev) => settleRunning(prev, 'stopped'))
    setPhase('stopped')
  }

  const handleTriage = () => {
    if (!selected) return
    const issue = selected
    const { repo, number, title, htmlUrl } = issue
    setRun(emptyRun({ repo, number, title, htmlUrl }))
    void stream((onEvent, signal) => startIssue(issue, onEvent, signal))
  }

  /** The visitor stops waiting. The server keeps its own claim on the thread and may still finish it. */
  const handleStop = () => {
    stoppedRef.current = streamRef.current
    streamRef.current?.abort()
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
  useResultFocus(runAttr(phase), { onRunStart: (narrow) => narrow && setListOpen(false) })

  const busy = phase === 'running'
  const current = phase === 'running' ? (NODES.find((node) => run.nodes[node] === 'running') ?? null) : null

  const triageLabel = selected ? `Triage #${selected.number}` : 'Triage'

  return (
    <div className="ds-app" data-run={runAttr(phase)}>
      <Header phase={phase} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <RepoPicker loaded={issues.repo} loading={issues.loading} busy={busy} onLoad={(text) => void loadIssues(text)} />
            <IssueList
              state={issues}
              busy={busy}
              selectedKey={selected ? keyOf(selected) : null}
              onSelect={setSelected}
              open={listOpen}
              onOpenChange={setListOpen}
            />
            <div className="ds-actions">
              <button type="button" className="ds-button ds-button--primary" disabled={busy || !selected} onClick={handleTriage}>
                {triageLabel}
              </button>
              {busy ? (
                <button type="button" className="ds-button" ref={stopRef} onClick={handleStop}>
                  Stop
                </button>
              ) : null}
            </div>
            <p className="ds-help" role="status" aria-live="polite">
              {statusLine(phase, run, current, flow, selected)}
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
            <ThreadsCard state={threads} busy={busy} onRefresh={handleRefresh} onOpen={(id) => void handleOpen(id)} />
          </div>

          <div className="ds-run" ref={runRef}>
            <ResultCard
              run={run}
              phase={phase}
              flow={flow}
              busy={busy}
              searching={current === 'duplicates'}
              onDecide={handleDecide}
              onRetry={handleRetry}
              onAgain={() => {
                setRun(emptyRun())
                setPhase('idle')
                setListOpen(true)
              }}
              onRefreshThreads={handleRefresh}
            />
            <Readout run={run} phase={phase} startedAt={startedAt} />
            <GraphView run={run} />
            <TraceCard run={run} current={current} phase={phase} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
