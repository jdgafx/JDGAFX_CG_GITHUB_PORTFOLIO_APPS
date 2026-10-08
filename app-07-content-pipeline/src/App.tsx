import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CONTENT_TYPES, STAGE_IDS, STAGE_LABELS, runPipeline,
  type CallRecord, type ContentType, type PipelineOutcome, type StageId, type StageOutputs,
} from './lib/api'
import { buildTrace, keepsFinishedStages, runKeyFor, summarize, type RunEnd } from './lib/run'
import Brief, { type Notice } from './components/Brief'
import Stages from './components/Stages'
import RunTrace from './components/RunTrace'
import RunSummary from './components/RunSummary'

const COPY_NOTE_MS = 2000
const UNEXPECTED_MESSAGE = 'Something went wrong. Please retry.'

function statusText(topic: string, running: boolean, runningStage: StageId | null, outcome: PipelineOutcome | null): string {
  if (running) {
    if (!runningStage) return 'Starting the run.'
    return `Running ${STAGE_LABELS[runningStage]}, stage ${STAGE_IDS.indexOf(runningStage) + 1} of ${STAGE_IDS.length}.`
  }
  if (!outcome) return topic.trim() ? 'Press Generate to run all five stages.' : 'Enter a topic to start.'
  if (outcome.kind === 'complete') return 'All five stages finished. Copy the final piece from the Stages card.'
  if (outcome.kind === 'stopped') return `Stopped at ${STAGE_LABELS[outcome.stage]}.`
  return `${STAGE_LABELS[outcome.stage]} did not finish.`
}

function badgeFor(running: boolean, runningStage: StageId | null, outcome: PipelineOutcome | null): { text: string; tone: string } {
  if (running) return { text: runningStage ? `Running ${STAGE_LABELS[runningStage]}` : 'Starting', tone: 'ds-badge--accent' }
  if (!outcome) return { text: 'Ready', tone: '' }
  if (outcome.kind === 'complete') return { text: 'Complete', tone: 'ds-badge--success' }
  if (outcome.kind === 'stopped') return { text: 'Stopped', tone: 'ds-badge--warning' }
  return { text: 'Failed', tone: 'ds-badge--danger' }
}

function noticeFor(outcome: PipelineOutcome | null): Notice {
  if (outcome?.kind === 'failed') return { kind: 'failed', label: STAGE_LABELS[outcome.stage], message: outcome.message }
  if (outcome?.kind === 'stopped') return { kind: 'stopped', label: STAGE_LABELS[outcome.stage] }
  return null
}

export default function App() {
  const [topic, setTopic] = useState('')
  const [contentType, setContentType] = useState<ContentType>(CONTENT_TYPES[0])
  const [running, setRunning] = useState(false)
  const [runningStage, setRunningStage] = useState<StageId | null>(null)
  const [outcome, setOutcome] = useState<PipelineOutcome | null>(null)
  const [outputs, setOutputs] = useState<StageOutputs>({})
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [copyNote, setCopyNote] = useState('')
  const runKeyRef = useRef('')
  const outputsRef = useRef<StageOutputs>({})
  const abortRef = useRef<AbortController | null>(null)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Abort an in-flight run and clear the copy note timer when the view goes away.
  useEffect(() => () => {
    abortRef.current?.abort()
    if (noteTimer.current) clearTimeout(noteTimer.current)
  }, [])

  const start = useCallback(async (resume: boolean) => {
    const trimmed = topic.trim()
    if (!trimmed || running) return

    // Finished stages are reused only when a resume continues the same topic and format.
    const runKey = runKeyFor(trimmed, contentType)
    if (!keepsFinishedStages(runKeyRef.current, runKey, resume)) {
      runKeyRef.current = runKey
      outputsRef.current = {}
      setOutputs({})
      setCalls([])
    }

    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setOutcome(null)

    // runPipeline reports every expected failure as an outcome. This catch only covers a
    // bug, and it names the stage that was running when the bug surfaced.
    let stage: StageId = STAGE_IDS[0]
    let result: PipelineOutcome
    try {
      result = await runPipeline(
        { topic: trimmed, contentType, context: outputsRef.current, signal: controller.signal },
        {
          onStageStart: next => {
            stage = next
            setRunningStage(next)
          },
          onCall: record => setCalls(previous => [...previous, record]),
          onStageDone: (done, content) => {
            outputsRef.current = { ...outputsRef.current, [done]: content }
            setOutputs(outputsRef.current)
          },
        },
      )
    } catch {
      result = controller.signal.aborted
        ? { kind: 'stopped', stage }
        : { kind: 'failed', stage, message: UNEXPECTED_MESSAGE }
    } finally {
      abortRef.current = null
      setRunningStage(null)
      setRunning(false)
    }
    setOutcome(result)
  }, [topic, contentType, running])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const note = useCallback((text: string) => {
    setCopyNote(text)
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setCopyNote(''), COPY_NOTE_MS)
  }, [])

  const copy = useCallback((label: string, text: string) => {
    if (!navigator.clipboard) {
      note(`${label} could not be copied in this browser.`)
      return
    }
    navigator.clipboard.writeText(text).then(
      () => note(`${label} copied.`),
      () => note(`${label} could not be copied.`),
    )
  }, [note])

  const end: RunEnd = !running && outcome && outcome.kind !== 'complete'
    ? { kind: outcome.kind, stage: outcome.stage }
    : null
  const lines = buildTrace(calls, outputs, end)
  const totals = calls.length > 0 ? summarize(calls) : null
  const badge = badgeFor(running, runningStage, outcome)

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div>
            <h1 className="ds-title">ContentForge</h1>
            <p className="ds-subtitle">Five AI stages turn a topic into a finished piece.</p>
          </div>
          <span className={`ds-badge ${badge.tone}`}>{badge.text}</span>
        </div>
      </header>

      <main className="ds-main">
        <Brief
          topic={topic}
          contentType={contentType}
          running={running}
          statusText={statusText(topic, running, runningStage, outcome)}
          notice={noticeFor(running ? null : outcome)}
          onTopic={setTopic}
          onContentType={setContentType}
          onSubmit={() => void start(false)}
          onStop={stop}
          onContinue={() => void start(true)}
        />

        <Stages
          outputs={outputs}
          runningStage={runningStage}
          failedStage={outcome?.kind === 'failed' ? outcome.stage : null}
          copyNote={copyNote}
          onCopy={copy}
        />

        <section className="ds-card" aria-labelledby="trace-title">
          <div className="ds-card__head">
            <h2 className="ds-card__title" id="trace-title">Run trace</h2>
            <p className="ds-hint">One line per call. Retries are labelled, and stages that did not run are marked skipped.</p>
          </div>
          <RunTrace lines={lines} />
        </section>

        <section className="ds-card" aria-labelledby="summary-title">
          <div className="ds-card__head">
            <h2 className="ds-card__title" id="summary-title">Run summary</h2>
            <p className="ds-hint">Totals for every call in this run.</p>
          </div>
          <RunSummary totals={totals} />
        </section>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
