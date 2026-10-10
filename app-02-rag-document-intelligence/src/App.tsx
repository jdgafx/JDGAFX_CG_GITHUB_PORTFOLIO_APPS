import { useCallback, useEffect, useRef, useState } from 'react'
import { DocumentSection } from './components/DocumentSection'
import { EvidencePanel } from './components/EvidencePanel'
import { Header, type Badge } from './components/Header'
import { HowTo } from './components/HowTo'
import { QuestionSection } from './components/QuestionSection'
import { ReadoutStrip } from './components/ReadoutStrip'
import { ResultCard, type Phase, type Selection } from './components/ResultCard'
import { RunTrace } from './components/RunTrace'
import { SiteFooter } from './components/SiteFooter'
import { citeKey } from './components/AnswerBody'
import { useDocumentLoader } from './hooks/useDocumentLoader'
import { askQuestion, AskError } from './lib/api'
import type { Retrieval } from './lib/bm25'
import { HOWTO_STEPS, HOWTO_WHAT, TRY_ARTICLE, TRY_QUESTION } from './lib/howto'
import { liveData } from './lib/liveData'
import { useResultFocus } from './lib/useResultFocus'
import type { DocumentState, LatestRun, TraceStep, Turn } from './types'

const NO_MATCH_ANSWER =
  'No passage shares a word with this question, so the model was not called. Try words that appear in the text.'

function newId(): string {
  return Math.random().toString(36).slice(2, 11)
}

export default function App() {
  const [doc, setDoc] = useState<DocumentState | null>(null)
  const [docVersion, setDocVersion] = useState(0)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [liveTrace, setLiveTrace] = useState<TraceStep[]>([])
  const [latest, setLatest] = useState<LatestRun | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  // What the browser ranked for the latest question, and the passages its answer cites.
  const [retrieval, setRetrieval] = useState<Retrieval | null>(null)
  const [citedLatest, setCitedLatest] = useState<number[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const lastQuestion = useRef('')
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const afterLoad = useRef<((loaded: DocumentState) => void) | null>(null)
  const askRef = useRef<(text: string, target: DocumentState) => void>(() => undefined)

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Abandons a run in flight: a late result is ignored and the request is aborted. */
  const cancelRun = useCallback(() => {
    requestIdRef.current++
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
    setPending(null)
  }, [])

  /** Clears the answers and the evidence. The document itself is left alone. */
  const clearConversation = useCallback(() => {
    setTurns([])
    setLatest(null)
    setLiveTrace([])
    setRetrieval(null)
    setCitedLatest([])
    setSelection(null)
    setAskError(null)
  }, [])

  /** Makes a document the current one and starts its conversation again. */
  const loadDocument = useCallback(
    (next: DocumentState) => {
      setDoc(next)
      setDocVersion(v => v + 1)
      setLoadedAt(Date.now())
      clearConversation()
      setQuestion('')
      // Try it waits here for its article, then asks about it.
      const waiting = afterLoad.current
      afterLoad.current = null
      // A failed Try it must not fire on a later, different document.
      if (waiting && next.title === TRY_ARTICLE) waiting(next)
    },
    [clearConversation],
  )

  const loader = useDocumentLoader(loadDocument, cancelRun)
  const reading = loader.loading
  const clearLoadError = loader.clearError

  const ask = useCallback(
    async (text: string, target: DocumentState | null = doc) => {
      if (!target || !text || running) return

      lastQuestion.current = text
      const requestId = ++requestIdRef.current
      const controller = new AbortController()
      abortRef.current = controller
      const isCurrent = () => requestId === requestIdRef.current
      // Steps as they arrive, so a stopped run still shows what it did.
      const steps: TraceStep[] = []

      setQuestion('')
      setAskError(null)
      setSelection(null)
      setRetrieval(null)
      setCitedLatest([])
      setRunning(true)
      setPending(null)
      setLiveTrace([])

      try {
        const outcome = await askQuestion(text, target.chunks, target.title, controller.signal, {
          onStart: name => {
            if (isCurrent()) setPending(name)
          },
          onStep: step => {
            steps.push(step)
            if (isCurrent()) {
              setLiveTrace([...steps])
              setPending(null)
            }
          },
          onRetrieved: ranked => {
            if (isCurrent()) setRetrieval(ranked)
          },
        })
        if (!isCurrent()) return
        setLatest({ report: outcome.run, state: outcome.status })
        if (outcome.status === 'answered') setCitedLatest(outcome.sourceChunks)
        const turn: Turn =
          outcome.status === 'answered'
            ? {
                id: newId(),
                question: text,
                kind: 'answered',
                answer: outcome.answer,
                sourceChunks: outcome.sourceChunks,
                selfRated: outcome.selfRated,
                model: outcome.run.model,
                retrieval: outcome.retrieval,
              }
            : { id: newId(), question: text, kind: 'no-matches', answer: NO_MATCH_ANSWER, sourceChunks: [], selfRated: null, model: null, retrieval: outcome.retrieval }
        setTurns(prev => [...prev, turn])
      } catch (err) {
        if (!isCurrent()) return
        if (controller.signal.aborted) {
          setLatest({ report: { trace: steps, usage: null, model: null, totalMs: null }, state: 'stopped' })
        } else if (err instanceof AskError) {
          setAskError(err.message)
          setLatest({ report: err.run, state: 'failed' })
        } else {
          setAskError('Something went wrong while answering. Please try again.')
          setLatest({ report: { trace: steps, usage: null, model: null, totalMs: null }, state: 'failed' })
        }
      } finally {
        if (isCurrent()) {
          setRunning(false)
          setPending(null)
          abortRef.current = null
        }
      }
    },
    [doc, running],
  )

  useEffect(() => {
    askRef.current = (text, target) => void ask(text, target)
  }, [ask])

  const runQuestion = useCallback(() => void ask(question.trim()), [ask, question])
  const retry = useCallback(() => void ask(lastQuestion.current), [ask])

  /** Try it: fetches the example article live from Wikipedia, then asks the example question about it. */
  const tryIt = useCallback(() => {
    afterLoad.current = loaded => askRef.current(TRY_QUESTION, loaded)
    loader.load({ kind: 'wikipedia', title: TRY_ARTICLE })
  }, [loader])

  // Stop only aborts. The request id is left alone, so the stopped state is kept.
  const stopRun = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /** Closing the panel returns focus to the citation that opened it. */
  const closeSource = useCallback(() => {
    const open = selection
    setSelection(null)
    if (open) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-cite="${citeKey(open.turnId, open.index)}"]`)?.focus()
      })
    }
  }, [selection])

  const handleReset = useCallback(() => {
    if (turns.length > 0 && !window.confirm('Start over with a new document? This conversation will be cleared.')) {
      return
    }
    cancelRun()
    setDoc(null)
    setLoadedAt(null)
    clearConversation()
    setQuestion('')
    clearLoadError()
  }, [turns.length, cancelRun, clearConversation, clearLoadError])

  const phase: Phase = running
    ? 'running'
    : !latest
      ? 'idle'
      : latest.state === 'failed'
        ? 'failed'
        : latest.state === 'stopped'
          ? 'stopped'
          : 'done'
  useResultFocus(phase)

  const lastTurn = turns[turns.length - 1]
  const notFound = phase === 'done' && lastTurn !== undefined && lastTurn.sourceChunks.length === 0
  const badge: Badge = reading
    ? { label: 'Reading document', tone: 'ds-badge--accent', dot: 'ds-dot--running' }
    : running
      ? { label: 'Asking', tone: 'ds-badge--accent', dot: 'ds-dot--running' }
      : phase === 'failed'
        ? { label: 'Failed', tone: 'ds-badge--danger', dot: 'ds-dot--failed' }
        : phase === 'stopped'
          ? { label: 'Stopped', tone: 'ds-badge--warning', dot: 'ds-dot--stopped' }
          : notFound
            ? { label: 'Not in the document', tone: 'ds-badge--warning', dot: 'ds-dot--stopped' }
            : phase === 'done'
              ? { label: 'Answered', tone: 'ds-badge--success', dot: 'ds-dot--ok' }
              : doc
                ? { label: 'Document ready', tone: '', dot: 'ds-dot--ok' }
                : { label: 'No document yet', tone: '', dot: 'ds-dot--skipped' }

  const settledStatus = !latest
    ? doc
      ? 'Ready for a question.'
      : null
    : latest.state === 'answered'
      ? notFound
        ? 'The document does not answer this. The panel shows what was checked.'
        : 'Answer ready. Click a citation to read the sentence behind it.'
      : latest.state === 'no-matches'
        ? 'No passage matched. The model was not called.'
        : latest.state === 'stopped'
          ? 'Stopped. No answer came back.'
          : 'The question did not get an answer. The answer panel says why.'

  const sent = retrieval ? retrieval.ranked.map(r => r.index) : []

  return (
    <div className="ds-app" data-run={phase}>
      <Header badge={badge} live={liveData(doc, loadedAt, loader.failedKind)} />

      <main className="ds-main">
        <HowTo
          what={HOWTO_WHAT}
          steps={HOWTO_STEPS}
          onTry={tryIt}
          disabled={reading || running}
          hasResult={latest !== null}
          error={loader.error}
        />
        <div className="ds-bench">
          <div className="ds-controls">
            <DocumentSection
              doc={doc}
              busy={reading || running}
              activity={loader.activity}
              error={loader.error}
              canRetry={loader.canRetry}
              onLoad={loader.load}
              onRetry={loader.retry}
              onError={loader.fail}
              onReset={handleReset}
            />
            <QuestionSection
              doc={doc}
              question={question}
              running={running}
              pendingStep={pending}
              settledStatus={settledStatus}
              askError={askError}
              onQuestionChange={setQuestion}
              onAsk={runQuestion}
              onStop={stopRun}
            />
          </div>

          <div className="ds-run">
            <ResultCard
              doc={doc}
              phase={phase}
              turns={turns}
              error={askError}
              hasSteps={(running ? liveTrace : (latest?.report.trace ?? [])).length > 0}
              selection={selection}
              onSelect={setSelection}
              onClose={closeSource}
              onRetry={retry}
            />
            <ReadoutStrip
              running={running}
              pending={pending}
              liveTrace={liveTrace}
              latest={latest}
              sent={sent.length}
              total={doc?.chunks.length ?? 0}
            />
            <EvidencePanel
              doc={doc}
              docVersion={docVersion}
              retrieval={retrieval}
              sent={sent}
              cited={citedLatest}
              state={latest?.state ?? null}
            />
            <RunTrace running={running} pending={pending} liveTrace={liveTrace} latest={latest} />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
