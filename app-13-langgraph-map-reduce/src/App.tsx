import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ChunkMap } from './components/ChunkMap'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { HowTo } from './components/HowTo'
import { InputPanel } from './components/InputPanel'
import { ReplayLabel } from './components/ReplayLabel'
import { ReadoutStrip } from './components/ReadoutStrip'
import { ResultCard } from './components/ResultCard'
import { TracePanel } from './components/TracePanel'
import { runAnalysis } from './lib/api'
import { HOWTO_STEPS, HOWTO_WHAT, TRY_ARTICLE } from './lib/howto'
import { summarize } from './lib/chunkMap'
import { applyFetch, fetchedNow, liveIndicator, NO_FETCH, type WikiEvent } from './lib/liveData'
import { loadArticle } from './lib/wikipedia-api'
import { MAX_CHARS, MIN_CHARS } from './lib/limits'
import { statusLine } from './lib/status'
import { useReplay } from './lib/useReplay'
import { useResultFocus } from './replay'
import { applyFrame, endView, failView, initialView, stopView, type RunView } from './lib/view'
import type { Frame } from './types/frames'

type Action =
  | { type: 'start'; now: number }
  | { type: 'clock-stop'; now: number }
  | { type: 'frame'; frame: Frame }
  | { type: 'fail'; message: string }
  | { type: 'stop' }
  | { type: 'end' }
  | { type: 'reset' }

function reduce(view: RunView, action: Action): RunView {
  switch (action.type) {
    case 'start':
      return { ...initialView(), phase: 'running', startedAt: action.now }
    case 'clock-stop':
      return view.startedAt !== null && view.endedAt === null ? { ...view, endedAt: action.now } : view
    case 'frame':
      return applyFrame(view, action.frame)
    case 'fail':
      return failView(view, action.message)
    case 'stop':
      return stopView(view)
    case 'end':
      return endView(view)
    case 'reset':
      return initialView()
  }
}

function isValid(text: string): boolean {
  return text.length >= MIN_CHARS && text.length <= MAX_CHARS && text.trim().length > 0
}

export default function App() {
  const [text, setText] = useState('')
  const [view, dispatch] = useReducer(reduce, undefined, initialView)
  /** The text of the run on screen. The box can be edited after a run, so the coverage map reads this copy. */
  const [analyzed, setAnalyzed] = useState('')
  const [fetched, setFetched] = useState(NO_FETCH)
  /** The title of the article the page itself fetched (on load or with Try it), to name it in the chunk map. */
  const [titled, setTitled] = useState<{ text: string; title: string } | null>(null)
  /** True while the run on screen is the replayed one, until Run it live or a run of the visitor's own replaces it. */
  const [replaying, setReplaying] = useState(false)
  const [loadingExample, setLoadingExample] = useState(false)
  const [tryError, setTryError] = useState<string | null>(null)
  /** The example article that fills the box on load: free live data, no model call. */
  const [preload, setPreload] = useState<{ status: 'loading' | 'ready' | 'failed'; error: string | null }>({ status: 'loading', error: null })
  const [collapseKey, setCollapseKey] = useState(0)
  const [railScrolled, setRailScrolled] = useState(false)
  const busy = useRef(false)
  /** Set when a replay could not be answered from its recording: the failure that follows is not the visitor's, so the screen resets instead. */
  const diverged = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const running = view.phase === 'running'
  const valid = isValid(text)

  /** The example article arrived: it fills the box unless the visitor typed or loaded something first. */
  function exampleLoaded(article: { title: string; text: string }): void {
    setTitled({ text: article.text, title: article.title })
    setText((current) => (current === '' ? article.text : current))
    setFetched((prev) => (prev.loaded === null ? applyFetch(prev, { kind: 'loaded', text: article.text, at: fetchedNow() }) : prev))
    setPreload({ status: 'ready', error: null })
  }
  function exampleFailed(err: unknown): void {
    setPreload({ status: 'failed', error: err instanceof Error ? err.message : 'The example article could not be loaded. Try again.' })
  }

  // On load: the example article from Wikipedia, free live data with no model call. The chunk map splits it at once.
  useEffect(() => {
    const controller = new AbortController()
    loadArticle(TRY_ARTICLE, controller.signal).then(
      (article) => !controller.signal.aborted && exampleLoaded(article),
      (err: unknown) => !controller.signal.aborted && exampleFailed(err),
    )
    return () => controller.abort()
  }, [])

  // The map shows the text a run would split: the box before a run, the analyzed copy once one has started.
  const mapped = view.phase === 'idle' ? text : analyzed
  const chunks = useMemo(() => summarize(mapped), [mapped])
  const source =
    titled?.text === mapped
      ? `the Wikipedia article “${titled.title}”`
      : fetched.loaded?.text === mapped
        ? 'a Wikipedia article you loaded'
        : 'your text'

  // Leaving the page stops the stream, so no request keeps running in the background.
  useEffect(() => () => controller.current?.abort(), [])

  // On a phone the result sits below the controls: the hook scrolls it into view and focuses its heading when a run ends.
  useResultFocus(view.phase === 'error' ? 'failed' : view.phase, { onRunStart: (narrow) => narrow && setCollapseKey((n) => n + 1), replay: replaying })

  async function analyze(source: string, replayRun = false): Promise<void> {
    if (busy.current || !isValid(source)) return
    busy.current = true
    setReplaying(replayRun)
    const current = new AbortController()
    controller.current = current
    setAnalyzed(source)
    dispatch({ type: 'start', now: Date.now() })
    try {
      await runAnalysis(source, (frame) => dispatch({ type: 'frame', frame }), current.signal)
      if (current.signal.aborted) dispatch({ type: 'stop' })
      else dispatch({ type: 'end' })
    } catch (err) {
      // An abort from the Stop button is not a connection failure, so it never shows the connection message.
      if (current.signal.aborted) {
        dispatch({ type: 'stop' })
      } else if (diverged.current) {
        diverged.current = false
        dispatch({ type: 'reset' })
      } else {
        dispatch({ type: 'fail', message: err instanceof Error ? err.message : 'Something went wrong. Try again.' })
      }
    } finally {
      busy.current = false
      dispatch({ type: 'clock-stop', now: Date.now() })
    }
  }

  /** Try it: fetches the example article live from Wikipedia, fills the box and analyzes it. */
  async function tryIt(): Promise<void> {
    if (busy.current || loadingExample) return
    setTryError(null)
    setLoadingExample(true)
    try {
      const article = await loadArticle(TRY_ARTICLE)
      setText(article.text)
      setTitled({ text: article.text, title: article.title })
      setFetched((prev) => applyFetch(prev, { kind: 'loaded', text: article.text, at: fetchedNow() }))
      setLoadingExample(false)
      await analyze(article.text)
    } catch (err) {
      setLoadingExample(false)
      setFetched((prev) => applyFetch(prev, { kind: 'failed' }))
      setTryError(err instanceof Error ? err.message : 'The example article could not be loaded. Try again.')
    }
  }

  // On load, plays back the stored real run of the example article through the code above, if it is fresh and is of this text.
  const replay = useReplay({
    text,
    idle: view.phase === 'idle',
    start: (source) => {
      setReplaying(true)
      return analyze(source, true)
    },
    clear: () => {
      setReplaying(false)
      diverged.current = true
      dispatch({ type: 'reset' })
      setAnalyzed('')
    },
  })

  /** Run it live: ends the replay, then makes the real requests for the same text. */
  async function runLive(): Promise<void> {
    replay.stop()
    setReplaying(false)
    controller.current?.abort()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await analyze(text)
  }

  return (
    <div className="ds-app" data-run={view.phase === 'error' ? 'failed' : view.phase}>
      <Header phase={view.phase} live={liveIndicator(text, fetched)} />

      <main className="ds-main">
        <HowTo
          what={HOWTO_WHAT}
          steps={HOWTO_STEPS}
          onTry={() => void tryIt()}
          disabled={running || loadingExample}
          hasResult={view.phase !== 'idle'}
          error={tryError}
        />
        <div className="ds-bench">
          <div className="ds-controls" data-scrolled={railScrolled ? 'true' : undefined} onScroll={(event) => setRailScrolled(event.currentTarget.scrollTop > 4)}>
            <InputPanel
              text={text}
              running={running}
              valid={valid}
              onChange={setText}
              onFetch={(event: WikiEvent) => setFetched((prev) => applyFetch(prev, event))}
              onRun={() => void analyze(text)}
              onStop={() => controller.current?.abort()}
              collapseKey={collapseKey}
            />
            <p className="ds-help" role="status">
              {statusLine(view, text.length, valid)}
            </p>
            {view.error ? (
              <div className="ds-notice ds-notice--error" role="alert">
                {view.error}
              </div>
            ) : null}
          </div>

          <div className="ds-run">
            {replaying && replay.info ? <ReplayLabel info={replay.info} onRunLive={() => void runLive()} /> : null}
            <ResultCard view={view} analyzed={analyzed} onRetry={() => void analyze(text)} />
            <ReadoutStrip view={view} replayed={replaying} />
            <ChunkMap
              summary={chunks}
              source={source}
              loading={preload.status === 'loading' && text === ''}
              loadError={preload.status === 'failed' && text === '' ? preload.error : null}
              onReload={() => {
                setPreload({ status: 'loading', error: null })
                loadArticle(TRY_ARTICLE).then(exampleLoaded, exampleFailed)
              }}
              branches={view.branches}
              reduce={view.stages.reduce}
              idle={view.phase === 'idle'}
            />
            <GraphView view={view} />
            <TracePanel view={view} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
