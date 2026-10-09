import { useEffect, useRef, useState } from 'react'
import { CONTENT_TYPES, MAX_TOPIC_CHARS, STAGE_IDS, STAGE_LABELS, type ContentType, type StageId, type StageOutputs } from '../netlify/shared/contract'
import { UNEXPECTED_MESSAGE, runPipeline, type CallRecord, type PipelineOutcome } from './lib/api'
import { buildTrace, stageViews, summarize, type RunEnd, type TraceLine } from './lib/run'
import Brief, { type Notice } from './components/Brief'
import Pipeline from './components/Pipeline'
import Stages from './components/Stages'
import RunSummary from './components/RunSummary'
import RunTrace from './components/RunTrace'

const COPY_NOTE_MS = 2000
// Loaded so a reviewer can press Generate at once. Wikipedia and Hacker News both cover it.
const SAMPLE_TOPIC = 'The Rust programming language and memory safety'

function statusText(topic: string, running: boolean, runningStage: StageId | null, outcome: PipelineOutcome | null): string {
  if (running) {
    if (!runningStage) return 'Starting the run.'
    return `Running ${STAGE_LABELS[runningStage]}, step ${STAGE_IDS.indexOf(runningStage) + 1} of ${STAGE_IDS.length}.`
  }
  if (topic.trim().length > MAX_TOPIC_CHARS) return `Shorten the topic to ${MAX_TOPIC_CHARS} characters to continue.`
  if (!outcome) return topic.trim() ? 'Press Generate to look up sources and write the piece.' : 'Enter a topic to start.'
  if (outcome.kind === 'complete') return 'All steps finished. Copy the final piece from Stage outputs.'
  if (outcome.kind === 'stopped') return `Stopped at ${STAGE_LABELS[outcome.stage]}. Press Resume to continue there.`
  return `Press Retry to run ${STAGE_LABELS[outcome.stage]} again.`
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
  const [topic, setTopic] = useState(SAMPLE_TOPIC)
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

  async function start(resume: boolean) {
    const trimmed = topic.trim()
    if (!trimmed || running || trimmed.length > MAX_TOPIC_CHARS) return

    // Finished stages are reused only when a resume continues the same topic and format.
    const runKey = `${trimmed}\n${contentType}`
    if (!(resume && runKeyRef.current === runKey)) {
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
  }

  const stop = () => abortRef.current?.abort()

  function note(text: string) {
    setCopyNote(text)
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setCopyNote(''), COPY_NOTE_MS)
  }

  function copy(label: string, text: string) {
    if (!navigator.clipboard) {
      note(`${label} could not be copied in this browser.`)
      return
    }
    navigator.clipboard.writeText(text).then(
      () => note(`${label} copied.`),
      () => note(`${label} could not be copied.`),
    )
  }

  const end: RunEnd = !running && outcome && outcome.kind !== 'complete'
    ? { kind: outcome.kind, stage: outcome.stage }
    : null
  const views = stageViews(outputs, runningStage, end)
  const finished = buildTrace(calls, outputs, end)
  // The call in progress has no figures yet, so it appears as a live line rather than a finished one.
  const live: TraceLine[] = running && runningStage
    ? [{
        key: 'live',
        index: finished.length + 1,
        stage: runningStage,
        name: STAGE_LABELS[runningStage],
        status: 'running',
        ms: 0,
        detail: runningStage === 'sources' ? 'Looking up Wikipedia and Hacker News.' : 'Waiting for the model to reply.',
        share: 0,
      }]
    : []
  const totals = calls.length > 0 ? summarize(calls) : null
  const badge = badgeFor(running, runningStage, outcome)

  return (
    <div className="ds-app">
      <header className="ds-header">
        <div className="ds-header__inner">
          <div>
            <h1 className="ds-title">ContentForge</h1>
            <p className="ds-subtitle">A live source lookup and five AI stages turn a topic into a cited piece.</p>
          </div>
          <span className={`ds-badge ${badge.tone}`}>{badge.text}</span>
          <p className="ds-showcase">
            <strong>What this showcases:</strong> a resumable pipeline that first fetches live Wikipedia and Hacker News sources, then runs five bounded model calls that cite them, each with its own trace, tokens and cost.
          </p>
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
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
          </div>

          <div className="ds-run">
            <Pipeline views={views} />
            <Stages outputs={outputs} views={views} idle={!running && !outcome} copyNote={copyNote} onCopy={copy} />
            <RunSummary totals={totals} />
            <RunTrace lines={[...finished, ...live]} />
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
