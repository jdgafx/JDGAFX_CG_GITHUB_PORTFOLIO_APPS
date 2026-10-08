import { useCallback, useEffect, useRef, useState } from 'react'
import { DocumentSection } from './components/DocumentSection'
import { QuestionSection } from './components/QuestionSection'
import { RetrievalPanel } from './components/RetrievalPanel'
import { RunSection } from './components/RunReport'
import { SiteFooter } from './components/SiteFooter'
import { askQuestion, AskError } from './lib/api'
import { chunkText, stripPageMarkers } from './lib/chunk'
import { extractText } from './lib/pdf'
import { SAMPLE_PAGES, SAMPLE_QUESTION, SAMPLE_TEXT, SAMPLE_TITLE } from './lib/sample'
import type { DocumentState, LatestRun, TraceStep, Turn } from './types'

const NO_MATCH_ANSWER =
  'No passage shares a word with this question, so the model was not called. Try words that appear in the text.'

function newId(): string {
  return Math.random().toString(36).slice(2, 11)
}

export default function App() {
  const [doc, setDoc] = useState<DocumentState | null>(null)
  const [docVersion, setDocVersion] = useState(0)
  const [reading, setReading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [liveTrace, setLiveTrace] = useState<TraceStep[]>([])
  const [latest, setLatest] = useState<LatestRun | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  // Passages the browser sent for the latest question, and the passages its answer cites.
  const [sent, setSent] = useState<number[]>([])
  const [citedLatest, setCitedLatest] = useState<number[]>([])
  // A source under the pointer or focus. It replaces the cited passages in the list until it lets go.
  const [hovered, setHovered] = useState<number[] | null>(null)
  const [reveal, setReveal] = useState<{ index: number } | null>(null)
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Abandons a run in flight: a late result is ignored and the request is aborted. */
  const cancelRun = useCallback(() => {
    requestIdRef.current++
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
    setPending(null)
  }, [])

  /** Clears the answers and the passage marks. The document itself is left alone. */
  const clearConversation = useCallback(() => {
    setTurns([])
    setLatest(null)
    setLiveTrace([])
    setSent([])
    setCitedLatest([])
    setHovered(null)
    setReveal(null)
    setAskError(null)
  }, [])

  /** Makes a document the current one and starts its conversation again. */
  const loadDocument = useCallback(
    (next: DocumentState) => {
      setDoc(next)
      setDocVersion(v => v + 1)
      clearConversation()
      setQuestion('')
    },
    [clearConversation],
  )

  const handleFileSelect = useCallback(
    async (file: File) => {
      cancelRun()
      setUploadError(null)
      setReading(true)
      try {
        const { text, pages } = await extractText(file)
        const { chunks, chunkPages } = chunkText(text)
        loadDocument({ title: file.name, chunks, chunkPages, pages, charCount: stripPageMarkers(text).length })
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Failed to extract text from this file.')
        console.error('Extract error:', err)
      } finally {
        setReading(false)
      }
    },
    [cancelRun, loadDocument],
  )

  /** Loads the built-in sample with its question filled in, so Ask is one click away. */
  const handleSample = useCallback(() => {
    cancelRun()
    setUploadError(null)
    const { chunks, chunkPages } = chunkText(SAMPLE_TEXT)
    loadDocument({
      title: SAMPLE_TITLE,
      chunks,
      chunkPages,
      pages: SAMPLE_PAGES,
      charCount: stripPageMarkers(SAMPLE_TEXT).length,
    })
    setQuestion(SAMPLE_QUESTION)
  }, [cancelRun, loadDocument])

  const runQuestion = useCallback(async () => {
    const text = question.trim()
    if (!doc || !text || running) return

    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const isCurrent = () => requestId === requestIdRef.current
    // Steps as they arrive, so a stopped run still shows what it did.
    const steps: TraceStep[] = []

    setQuestion('')
    setAskError(null)
    setHovered(null)
    setSent([])
    setCitedLatest([])
    setRunning(true)
    setPending(null)
    setLiveTrace([])

    try {
      const outcome = await askQuestion(text, doc.chunks, doc.title, controller.signal, {
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
        onRetrieved: indices => {
          if (!isCurrent()) return
          setSent(indices)
          // The list opens on the first passage the model will read.
          const first = indices[0]
          if (first !== undefined) setReveal({ index: first })
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
            }
          : { id: newId(), question: text, kind: 'no-matches', answer: NO_MATCH_ANSWER, sourceChunks: [], selfRated: null, model: null }
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
  }, [doc, question, running])

  // Stop only aborts. The request id is left alone, so the stopped state is kept.
  const stopRun = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /** Marks a source's passages while the pointer or focus is on it, and opens the list on its first passage. */
  const handleHighlight = useCallback((sources: number[] | null) => {
    setHovered(sources)
    const first = sources?.[0]
    if (first !== undefined) setReveal({ index: first })
  }, [])

  const handleReset = useCallback(() => {
    if (turns.length > 0 && !window.confirm('Start over with a new document? This conversation will be cleared.')) {
      return
    }
    cancelRun()
    setDoc(null)
    clearConversation()
    setQuestion('')
    setUploadError(null)
  }, [turns.length, cancelRun, clearConversation])

  const badge: { label: string; tone: string; mark: 'ok' | 'running' | 'skipped' } = reading
    ? { label: 'Reading document', tone: 'ds-badge--accent', mark: 'running' }
    : running
      ? { label: 'Asking', tone: 'ds-badge--accent', mark: 'running' }
      : doc
        ? { label: 'Document ready', tone: 'ds-badge--success', mark: 'ok' }
        : { label: 'No document yet', tone: '', mark: 'skipped' }

  const settledStatus = !latest
    ? doc
      ? 'Ready for a question.'
      : null
    : latest.state === 'answered'
      ? 'Answer ready.'
      : latest.state === 'no-matches'
        ? 'No passage matched. The model was not called.'
        : latest.state === 'stopped'
          ? 'Stopped. No answer came back.'
          : 'The question did not get an answer.'

  // The list marks a hovered source's passages while one is under the pointer or focus.
  const highlight = hovered ?? citedLatest

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div>
            <h1 className="ds-title">DocMind</h1>
            <p className="ds-subtitle">Ask questions about a PDF or TXT. Each answer lists the passages it used.</p>
          </div>
          <span className={`ds-badge ${badge.tone}`}>
            <span className={`ds-dot ds-dot--${badge.mark}`} aria-hidden="true" />
            {badge.label}
          </span>
          <p className="ds-showcase">
            <strong>What this showcases:</strong> retrieval-augmented answering. The browser retrieves the passages, and
            the model cites only the passages it was given.
          </p>
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <DocumentSection
              doc={doc}
              busy={reading || running}
              error={uploadError}
              onFileSelect={handleFileSelect}
              onSample={handleSample}
              onError={setUploadError}
              onReset={handleReset}
            />
            <QuestionSection
              documentReady={doc !== null}
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
            <RetrievalPanel
              doc={doc}
              docVersion={docVersion}
              turns={turns}
              sent={sent}
              citedLatest={citedLatest}
              highlight={highlight}
              latestState={latest?.state ?? null}
              reveal={reveal}
              onHighlight={handleHighlight}
            />
            <RunSection running={running} pending={pending} liveTrace={liveTrace} latest={latest} />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
