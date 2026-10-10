import { useEffect, useRef, useState } from 'react'
import { CONTENT_TYPES, MAX_TOPIC_CHARS, STAGE_IDS, STAGE_LABELS, type ContentType, type StageId, type StageOutputs } from '../netlify/shared/contract'
import type { ChangeNote } from '../netlify/shared/changes'
import { UNEXPECTED_MESSAGE, runPipeline, type CallRecord, type PipelineOutcome } from './lib/api'
import type { ChangeStage } from './lib/compare'
import { buildTrace, stageViews, summarize, type Phase, type RunEnd, type TraceLine } from './lib/run'
import { useResultFocus } from './lib/useResultFocus'
import Brief, { EXAMPLES } from './components/Brief'
import Header from './components/Header'
import { HowTo } from './components/HowTo'
import { HOWTO_STEPS, HOWTO_WHAT } from './lib/howto'
import { liveIndicator } from './lib/liveData'
import { namesFor } from './lib/names'
import { parseSourcePack } from '../netlify/shared/sourcepack'
import Piece from './components/Piece'
import Pipeline from './components/Pipeline'
import Readout from './components/Readout'
import RunTrace from './components/RunTrace'

const COPY_NOTE_MS = 2000
// Loaded so a reviewer can press Generate at once. Wikipedia covers it, and Hacker News when it has matching stories.
const FIRST = EXAMPLES[0]

function statusText(topic: string, running: boolean, runningStage: StageId | null, outcome: PipelineOutcome | null): string {
  if (running) {
    if (!runningStage) return 'Starting the run.'
    return `Running ${STAGE_LABELS[runningStage]}, step ${STAGE_IDS.indexOf(runningStage) + 1} of ${STAGE_IDS.length}.`
  }
  if (topic.trim().length > MAX_TOPIC_CHARS) return `Shorten the topic to ${MAX_TOPIC_CHARS} characters to continue.`
  if (!outcome) return topic.trim() ? 'Press Generate to look up sources and write the piece.' : 'Enter a topic to start.'
  if (outcome.kind === 'complete') return 'All steps finished. The piece and its changes are above.'
  if (outcome.kind === 'stopped') return `Stopped at ${STAGE_LABELS[outcome.stage]}. Resume continues there.`
  return `${STAGE_LABELS[outcome.stage]} did not finish. Try again reruns it.`
}

function badgeFor(running: boolean, runningStage: StageId | null, outcome: PipelineOutcome | null) {
  if (running) return { text: runningStage ? `Running ${STAGE_LABELS[runningStage]}` : 'Starting', tone: 'ds-badge--accent', dot: 'ds-dot--running' }
  if (!outcome) return { text: 'Ready', tone: '', dot: '' }
  if (outcome.kind === 'complete') return { text: 'Complete', tone: 'ds-badge--success', dot: 'ds-dot--ok' }
  if (outcome.kind === 'stopped') return { text: 'Stopped', tone: 'ds-badge--warning', dot: 'ds-dot--stopped' }
  return { text: 'Failed', tone: 'ds-badge--danger', dot: 'ds-dot--failed' }
}

export default function App() {
  const [topic, setTopic] = useState(FIRST?.topic ?? '')
  const [contentType, setContentType] = useState<ContentType>(FIRST?.type ?? CONTENT_TYPES[0])
  const [running, setRunning] = useState(false)
  const [runningStage, setRunningStage] = useState<StageId | null>(null)
  const [outcome, setOutcome] = useState<PipelineOutcome | null>(null)
  const [outputs, setOutputs] = useState<StageOutputs>({})
  const [notes, setNotes] = useState<Partial<Record<ChangeStage, ChangeNote[]>>>({})
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [startedAt, setStartedAt] = useState(0)
  const [sourcesAt, setSourcesAt] = useState<number | null>(null)
  const [copyNote, setCopyNote] = useState('')
  const runKeyRef = useRef('')
  const outputsRef = useRef<StageOutputs>({})
  const notesRef = useRef<Partial<Record<ChangeStage, ChangeNote[]>>>({})
  const abortRef = useRef<AbortController | null>(null)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const phase: Phase = running ? 'running' : outcome ? (outcome.kind === 'complete' ? 'done' : outcome.kind) : 'idle'
  useResultFocus(phase)

  // Abort an in-flight run and clear the copy note timer when the view goes away.
  useEffect(() => () => {
    abortRef.current?.abort()
    if (noteTimer.current) clearTimeout(noteTimer.current)
  }, [])

  async function start(resume: boolean, brief?: { topic: string; type: ContentType }) {
    const trimmed = (brief?.topic ?? topic).trim()
    const type = brief?.type ?? contentType
    if (!trimmed || running || trimmed.length > MAX_TOPIC_CHARS) return

    // Finished stages are reused only when a resume continues the same topic and format.
    const runKey = `${trimmed}\n${type}`
    if (!(resume && runKeyRef.current === runKey)) {
      runKeyRef.current = runKey
      outputsRef.current = {}
      notesRef.current = {}
      setOutputs({})
      setNotes({})
      setCalls([])
      setSourcesAt(null)
    }

    const controller = new AbortController()
    abortRef.current = controller
    setStartedAt(Date.now())
    setRunning(true)
    setOutcome(null)

    // runPipeline reports every expected failure as an outcome. This catch only covers a
    // bug, and it names the stage that was running when the bug surfaced.
    let stage: StageId = STAGE_IDS[0]
    let result: PipelineOutcome
    try {
      result = await runPipeline(
        { topic: trimmed, contentType: type, context: outputsRef.current, signal: controller.signal },
        {
          onStageStart: next => {
            stage = next
            setRunningStage(next)
          },
          onCall: record => setCalls(previous => [...previous, record]),
          onStageDone: (done, content, stageNotes) => {
            outputsRef.current = { ...outputsRef.current, [done]: content }
            if (done === 'sources') setSourcesAt(Date.now())
            setOutputs(outputsRef.current)
            if (done === 'edit' || done === 'polish') {
              notesRef.current = { ...notesRef.current, [done]: stageNotes }
              setNotes(notesRef.current)
            }
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

  // Try it: the first example brief, run end to end on live sources and the model.
  function tryIt() {
    if (!FIRST || running) return
    setTopic(FIRST.topic)
    setContentType(FIRST.type)
    void start(false, { topic: FIRST.topic, type: FIRST.type })
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
  const resume = !running && outcome && outcome.kind !== 'complete'
    ? { label: `${outcome.kind === 'failed' ? 'Try again' : 'Resume'} from ${STAGE_LABELS[outcome.stage]}` }
    : null

  return (
    <div className="ds-app" data-run={phase}>
      <Header
        phase={phase}
        badge={badgeFor(running, runningStage, outcome)}
        live={liveIndicator({
          sources: outputs.sources,
          at: sourcesAt,
          contentType,
          failedAtSources: !running && outcome?.kind === 'failed' && outcome.stage === 'sources',
        })}
      />

      <main className="ds-main">
        <HowTo what={HOWTO_WHAT} steps={HOWTO_STEPS} onTry={tryIt} disabled={running || !FIRST} hasResult={outcome !== null || Object.keys(outputs).length > 0} />
        <div className="ds-bench">
          <div className="ds-controls">
            <Brief
              topic={topic}
              contentType={contentType}
              running={running}
              statusText={statusText(topic, running, runningStage, outcome)}
              resume={resume}
              onTopic={setTopic}
              onContentType={setContentType}
              onSubmit={() => void start(false)}
              onStop={stop}
              onContinue={() => void start(true)}
            />
            {!running && outcome?.kind === 'failed' && (
              <div className="ds-notice ds-notice--error" role="alert">
                <p><strong>{STAGE_LABELS[outcome.stage]} did not finish.</strong> {outcome.message}</p>
                <p>Finished steps are kept.</p>
              </div>
            )}
          </div>

          <div className="ds-run">
            <Piece
              topic={topic}
              outputs={outputs}
              notes={notes}
              running={running}
              runningStage={runningStage}
              outcome={running ? null : outcome}
              hasCalls={calls.length > 0}
              copyNote={copyNote}
              onCopy={copy}
              onContinue={() => void start(true)}
            />
            <Readout phase={phase} totals={totals} runningStage={runningStage} startedAt={startedAt} />
            <div className="ds-run__stage">
              <Pipeline views={views} outputs={outputs} names={namesFor(topic, parseSourcePack(outputs.sources ?? ''))} onCopy={copy} />
            </div>
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
