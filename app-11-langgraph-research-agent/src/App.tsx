import { useEffect, useReducer, useRef, useState } from 'react'
import type { CheckpointOffer, Frame, NodeName } from '../netlify/shared/events'
import { AnswerCard } from './components/AnswerCard'
import { ForkCompare } from './components/ForkCompare'
import { offerKey, RewindPanel, type Edit } from './components/RewindPanel'
import { GraphView } from './components/GraphView'
import { Header } from './components/Header'
import { HowTo } from './components/HowTo'
import { PageLeads } from './components/PageLeads'
import { QuestionForm } from './components/QuestionForm'
import { ReplayLabel } from './components/ReplayLabel'
import { ReadoutStrip } from './components/ReadoutStrip'
import { RunTrace } from './components/RunTrace'
import { HOWTO_HINT, HOWTO_STEPS, HOWTO_WHAT, TRY_IT, TRY_IT_PAGES } from './lib/howto'
import { usePageLeads } from './lib/pageLeads'
import { useForkReveal } from './lib/useForkReveal'
import { useReplay } from './lib/useReplay'
import { useResultFocus } from './replay'
import { INTERRUPTED_MESSAGE, streamResearch, streamResume } from './lib/research'
import { applyFrame, emptyRun, failRun, researchStatus, startRun, stopRun, type RunView } from './lib/runState'

const RETRY_HINT = 'Press Start research to try again.'
const FORK_RETRY_HINT = 'Press Re-run to try again, or go back to the original run.'

type Action =
  | { type: 'start' }
  | { type: 'frame'; frame: Frame }
  | { type: 'fail'; message: string }
  | { type: 'cancel' }
  | { type: 'reset' }

function reducer(view: RunView, action: Action): RunView {
  switch (action.type) {
    case 'start':
      return startRun()
    case 'frame':
      return applyFrame(view, action.frame)
    case 'fail':
      return failRun(view, action.message)
    case 'cancel':
      return stopRun(view)
    case 'reset':
      return emptyRun()
  }
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [base, dispatchBase] = useReducer(reducer, undefined, emptyRun)
  const [fork, dispatchFork] = useReducer(reducer, undefined, emptyRun)
  const [picked, setPicked] = useState<string | null>(null)
  /** True while the run on screen is the replayed one, until Run it live or a run of the visitor's own replaces it. */
  const [replaying, setReplaying] = useState(false)
  const pages = usePageLeads(TRY_IT_PAGES)
  const abortRef = useRef<AbortController | null>(null)
  // Once a rewind has started, the page shows that run; the original stays in `base` for the side-by-side.
  const forking = fork.phase !== 'idle'
  const view = forking ? fork : base
  const dispatch = forking ? dispatchFork : dispatchBase
  const running = view.phase === 'running'
  // A replay's saved points are from an old run and its token has expired, so a rewind needs a live run.
  const offers = replaying ? [] : base.checkpoints

  useResultFocus(view.phase, { replay: replaying })
  useForkReveal(fork.phase)

  // Leaving the page ends the run, so no request keeps billing after the visitor is gone.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  /** `replayRun` marks the load-time replay; `force` is for Run it live, which starts while the replay's own state is still on screen. */
  const submit = async (value: string = question, replayRun = false, force = false) => {
    const text = value.trim()
    if (text === '' || (running && !force)) return
    if (!replayRun) replay.stop()
    setReplaying(replayRun)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatchFork({ type: 'reset' })
    setPicked(null)
    dispatchBase({ type: 'start' })
    await track(controller, dispatchBase, (onFrame) => streamResearch(text, controller.signal, onFrame))
  }

  /** Runs one stream into one reducer, ending it with a plain message when it breaks off without a result. */
  const track = async (
    controller: AbortController,
    target: (action: Action) => void,
    open: (onFrame: (frame: Frame) => void) => Promise<void>,
  ) => {
    let terminal = false
    try {
      await open((frame) => {
        if (frame.type === 'result' || frame.type === 'error') terminal = true
        target({ type: 'frame', frame })
      })
      if (!controller.signal.aborted && !terminal) target({ type: 'fail', message: INTERRUPTED_MESSAGE })
    } catch (err) {
      if (!controller.signal.aborted) target({ type: 'fail', message: err instanceof Error ? err.message : INTERRUPTED_MESSAGE })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const rewind = async (offer: CheckpointOffer, edit: Edit) => {
    if (running) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatchFork({ type: 'start' })
    await track(controller, dispatchFork, (onFrame) => streamResume(offer.token, edit, controller.signal, onFrame))
  }

  const pick = (key: string) => {
    setPicked(key)
    // The editor opens below the answer; bring it to the visitor's keyboard focus.
    window.setTimeout(() => document.getElementById('rewind-title')?.scrollIntoView({ block: 'nearest' }), 0)
  }
  const pickNode = (node: NodeName) => {
    const match = [...offers].reverse().find((offer) => offer.kind === node)
    if (match) pick(offerKey(match))
  }
  const pickable = new Set<NodeName>(offers.map((offer) => offer.kind))

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'cancel' })
  }

  const backToOriginal = () => {
    dispatchFork({ type: 'reset' })
  }

  const tryIt = () => {
    setQuestion(TRY_IT.question)
    void submit(TRY_IT.question)
  }

  // On load, plays back the stored real run of the example question through the code above, if it is fresh and is of this question.
  const replay = useReplay({
    question: TRY_IT.question,
    idle: base.phase === 'idle' && fork.phase === 'idle',
    start: (text) => {
      setQuestion(text)
      return submit(text, true)
    },
    clear: () => {
      // The recording could not answer: end the run quietly, so no connection message follows a failure that was not the visitor's.
      abortRef.current?.abort()
      setReplaying(false)
      dispatchBase({ type: 'reset' })
    },
  })

  /** Run it live: ends the replay, then makes the real request for the same question. */
  const runLive = async () => {
    replay.stop()
    setReplaying(false)
    abortRef.current?.abort()
    await submit(TRY_IT.question, false, true)
  }

  const loadSample = (sample: string) => {
    replay.stop()
    setReplaying(false)
    setQuestion(sample)
    dispatchFork({ type: 'reset' })
    dispatchBase({ type: 'reset' })
  }

  return (
    <div className="ds-app" data-run={view.phase} data-replay={replaying ? 'on' : undefined}>
      <Header view={view} earlierLiveAt={forking ? base.liveAt : null} pages={pages} replaying={replaying} />

      <main className="ds-main">
        <HowTo what={HOWTO_WHAT} steps={HOWTO_STEPS} onTry={tryIt} disabled={running} hasResult={view.phase !== 'idle'} hint={HOWTO_HINT} />
        <div className="ds-bench">
          <div className="ds-controls">
            <QuestionForm
              question={question}
              running={running}
              onChange={setQuestion}
              onSubmit={() => void submit()}
              onCancel={cancel}
              onSample={loadSample}
            />
            <p className="ds-help" role="status" aria-live="polite">
              {researchStatus(view)}
            </p>
            {view.error && (
              <div className="ds-notice ds-notice--error" role="alert">
                <p>{view.error}</p>
                <p>{forking ? FORK_RETRY_HINT : RETRY_HINT}</p>
              </div>
            )}
          </div>

          <div className="ds-run">
            {replaying && replay.info ? <ReplayLabel info={replay.info} onRunLive={() => void runLive()} /> : null}
            {forking && base.result ? (
              <ForkCompare original={base.result} fork={fork} onBack={backToOriginal} />
            ) : (
              <AnswerCard
                result={view.result}
                phase={view.phase}
                error={view.error}
                hasSteps={view.trace.length > 0}
                onRetry={() => void submit()}
              />
            )}
            <ReadoutStrip view={view} />
            <PageLeads state={pages} />
            <GraphView view={view} pickable={running ? new Set() : pickable} onPick={pickNode} />
            <RunTrace view={view} offers={running ? [] : offers} onRewind={(offer) => pick(offerKey(offer))} />
            <div className="ds-run__rewind">
              <RewindPanel offers={offers} selected={picked} busy={running} onSelect={pick} onRun={(offer, edit) => void rewind(offer, edit)} />
            </div>
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
