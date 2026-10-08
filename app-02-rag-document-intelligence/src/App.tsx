import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatInterface } from './components/ChatInterface'
import { DocumentViewer } from './components/DocumentViewer'
import { ErrorBanner } from './components/ErrorBanner'
import { RunBadge, RunReport } from './components/RunReport'
import { UploadZone } from './components/UploadZone'
import { askQuestion, AskError } from './lib/api'
import { chunkText, stripPageMarkers } from './lib/chunk'
import { extractText } from './lib/pdf'
import type { DocumentState, LatestRun, TraceStep, Turn } from './types'

const NO_MATCH_ANSWER =
  'No passage shares a word with this question, so the model was not called. Try words that appear in the text.'

function newId(): string {
  return Math.random().toString(36).slice(2, 11)
}

export default function App() {
  const [doc, setDoc] = useState<DocumentState | null>(null)
  const [reading, setReading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [liveTrace, setLiveTrace] = useState<TraceStep[]>([])
  const [latest, setLatest] = useState<LatestRun | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<number[]>([])
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

  const handleFileSelect = useCallback(
    async (file: File) => {
      cancelRun()
      setUploadError(null)
      setAskError(null)
      setReading(true)
      try {
        const { text, pages } = await extractText(file)
        const { chunks, chunkPages } = chunkText(text)
        setDoc({ title: file.name, chunks, chunkPages, pages, charCount: stripPageMarkers(text).length })
        setTurns([])
        setLatest(null)
        setLiveTrace([])
        setHighlighted([])
        setQuestion('')
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Failed to extract text from this file.')
        console.error('Extract error:', err)
      } finally {
        setReading(false)
      }
    },
    [cancelRun],
  )

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
    setHighlighted([])
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
      })
      if (!isCurrent()) return
      setLatest({ report: outcome.run, state: outcome.status })
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

  const handleReset = useCallback(() => {
    if (turns.length > 0 && !window.confirm('Start over with a new document? This conversation will be cleared.')) {
      return
    }
    cancelRun()
    setDoc(null)
    setTurns([])
    setLatest(null)
    setLiveTrace([])
    setHighlighted([])
    setQuestion('')
    setAskError(null)
    setUploadError(null)
  }, [turns.length, cancelRun])

  const badge = reading
    ? { label: 'Reading document', tone: 'ds-badge--accent' }
    : running
      ? { label: 'Working', tone: 'ds-badge--accent' }
      : doc
        ? { label: 'Document ready', tone: 'ds-badge--success' }
        : { label: 'No document', tone: '' }

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

  const pagesText = doc ? (doc.pages === 1 ? '1 page' : `${doc.pages} pages`) : ''

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div>
            <h1 className="ds-title">DocMind</h1>
            <p className="ds-subtitle">Ask questions about a PDF or TXT. Each answer lists the passages it used.</p>
          </div>
          <span className={`ds-badge ${badge.tone}`}>{badge.label}</span>
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-grid-2 docmind-pair">
          <section className="ds-card" aria-labelledby="card-document">
            <div className="ds-card__head">
              <h2 id="card-document" className="ds-card__title">
                Document
              </h2>
              {doc && <span className="ds-hint docmind-wrap">{doc.title}</span>}
            </div>
            {doc ? (
              <div className="ds-stack">
                <p className="ds-hint">
                  {doc.chunks.length.toLocaleString('en-US')} passages, {pagesText},{' '}
                  {doc.charCount.toLocaleString('en-US')} characters.
                </p>
                <p className="ds-hint">Read in this browser. Only passages that match a question are sent to the model.</p>
                <div className="ds-row">
                  <button type="button" className="ds-button" onClick={handleReset} disabled={running || reading}>
                    Start over
                  </button>
                  <span className="ds-hint">Clears this document and the conversation.</span>
                </div>
              </div>
            ) : (
              <UploadZone busy={reading || running} onFileSelect={handleFileSelect} onError={setUploadError} />
            )}
            <ErrorBanner message={uploadError} />
          </section>

          <section className="ds-card" aria-labelledby="card-ask">
            <div className="ds-card__head">
              <h2 id="card-ask" className="ds-card__title">
                Ask
              </h2>
              <span className="ds-hint">The model is told to use only these passages.</span>
            </div>
            <ChatInterface
              documentReady={doc !== null}
              turns={turns}
              chunkPages={doc?.chunkPages ?? []}
              question={question}
              running={running}
              pendingStep={pending}
              settledStatus={settledStatus}
              askError={askError}
              onQuestionChange={setQuestion}
              onAsk={runQuestion}
              onStop={stopRun}
              onHighlight={setHighlighted}
            />
          </section>
        </div>

        <section className="ds-card" aria-labelledby="card-run">
          <div className="ds-card__head">
            <h2 id="card-run" className="ds-card__title">
              Latest run
            </h2>
            <RunBadge running={running} state={latest?.state ?? null} />
          </div>
          <p className="ds-hint">Each step for the latest question, with its timing, tokens and cost.</p>
          <RunReport running={running} pending={pending} liveTrace={liveTrace} latest={latest} />
        </section>

        {doc && (
          <section className="ds-card" aria-labelledby="card-passages">
            <div className="ds-card__head">
              <h2 id="card-passages" className="ds-card__title">
                Passages
              </h2>
            </div>
            <DocumentViewer document={doc} highlightedChunks={highlighted} />
          </section>
        )}
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
