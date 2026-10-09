import { useCallback, useEffect, useRef, useState } from 'react'
import { ExportBar, type ExportKind, type ExportState } from './components/ExportBar'
import { GraphView } from './components/GraphView'
import { liveDataView } from './lib/liveData'
import { Header, type BadgeTone } from './components/Header'
import { QueryBar } from './components/QueryBar'
import { ReadoutStrip, type ReadoutState } from './components/ReadoutStrip'
import { ReportCard } from './components/ReportCard'
import { RunTrace } from './components/RunTrace'
import { StageOutputs } from './components/StageOutputs'
import {
  AGENT_META,
  AGENT_ORDER,
  MAX_QUERY_CHARS,
  MODEL_ORDER,
  createAgents,
  foundNoSources,
  hasUsefulOutput,
  wasTruncated,
} from './lib/agents'
import { isAbortError, runErrorMessage, startResearch } from './lib/api'
import { buildSteps } from './lib/graphLayout'
import { derivePhase, failInFlight, settleAgents, type RunPhase } from './lib/pipeline'
import { buildTraceRows } from './lib/traceRows'
import { useAudit } from './lib/useAudit'
import { useResultFocus, type RunPhase as FocusPhase } from './lib/useResultFocus'
import { sumUsage } from './lib/usage'
import type { AgentRole, AgentState, RunSummary, Source, StreamEvent } from './types'

const BADGE: Record<RunPhase, { label: string; tone: BadgeTone }> = {
  ready: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  complete: { label: 'Complete', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  stopped: { label: 'Stopped', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
}

/** The run phases the shared result-focus hook and the page's `data-run` attribute understand. */
const FOCUS_PHASE: Record<RunPhase, FocusPhase> = {
  ready: 'idle',
  running: 'running',
  complete: 'done',
  partial: 'done',
  stopped: 'stopped',
  failed: 'failed',
}

export default function App() {
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>(createAgents)
  const [query, setQuery] = useState('')
  const [ranQuery, setRanQuery] = useState('')
  const [runId, setRunId] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [wasStopped, setWasStopped] = useState(false)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [activeTab, setActiveTab] = useState<AgentRole>('retriever')
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [noticesHidden, setNoticesHidden] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [exporting, setExporting] = useState<ExportKind | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stoppedRef = useRef(false)
  const sourcesRef = useRef<Source[]>([])
  const audit = useAudit()

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case 'session_complete':
          setSummary(event)
          if (event.result.trim()) {
            void audit.start(event.result, sourcesRef.current)
            setAnnouncement('Report written. Checking every cited sentence against its source.')
          }
          return
        case 'retrieve_start':
          setActiveTab('retriever')
          setAgents(prev => ({ ...prev, retriever: { ...prev.retriever, status: 'working', detail: 'Looking up Wikipedia and Hacker News.' } }))
          setAnnouncement('Retrieve is fetching public sources.')
          return
        case 'retrieve_complete': {
          const { ms, sources, detail } = event
          sourcesRef.current = sources
          setFetchedAt(new Date())
          setAgents(prev => ({ ...prev, retriever: { ...prev.retriever, status: 'complete', ms, sources, detail } }))
          setAnnouncement(sources.length > 0 ? `Retrieve found ${sources.length} sources.` : 'Retrieve found no sources.')
          return
        }
        case 'agent_start': {
          const { agent, maxTokens } = event
          if (agent !== 'synthesizer') setActiveTab(agent)
          setAgents(prev => ({ ...prev, [agent]: { ...prev[agent], status: 'working', maxTokens, detail: 'Model call in progress.' } }))
          setAnnouncement(`${AGENT_META[agent].name} is working.`)
          return
        }
        case 'agent_chunk': {
          const { agent, content } = event
          setAgents(prev => ({ ...prev, [agent]: { ...prev[agent], output: prev[agent].output + content } }))
          return
        }
        case 'agent_complete': {
          const { agent, ms, detail, finish, reasoningTokens, servedModel, usage, retried } = event
          setAgents(prev => ({
            ...prev,
            [agent]: { ...prev[agent], status: 'complete', ms, detail, finish, reasoningTokens, servedModel, usage, retried },
          }))
          setAnnouncement(`${AGENT_META[agent].name} finished in ${ms.toLocaleString('en-US')} ms.`)
          return
        }
        case 'agent_skipped': {
          const { agent, detail } = event
          setAgents(prev => ({ ...prev, [agent]: { ...prev[agent], status: 'skipped', detail } }))
          setAnnouncement(`${AGENT_META[agent].name} was not run.`)
          return
        }
        case 'agent_error': {
          const { agent, ms, error } = event
          setPipelineError(error)
          if (agent === 'system') {
            setAgents(prev => failInFlight(prev, error))
            return
          }
          setAgents(prev => ({ ...prev, [agent]: { ...prev[agent], status: 'error', error, detail: error, ms } }))
          setAnnouncement(`${AGENT_META[agent].name} failed. ${error}`)
          return
        }
      }
    },
    [audit],
  )

  const startRun = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || text.length > MAX_QUERY_CHARS || isRunning) return

      audit.reset()
      sourcesRef.current = []
      setFetchedAt(null)
      setAgents(createAgents())
      setRanQuery(text)
      setRunId(id => id + 1)
      setSummary(null)
      setElapsedMs(0)
      setIsRunning(true)
      setWasStopped(false)
      setPipelineError(null)
      setNoticesHidden(false)
      setActiveTab('retriever')
      setAnnouncement('Research started. Sources are fetched first, then four stages run in order, then the report is audited.')
      stoppedRef.current = false

      const startedAt = Date.now()
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250)

      const controller = new AbortController()
      abortRef.current = controller

      let failure: string | null = null
      try {
        await startResearch(text, handleEvent, controller.signal)
      } catch (err) {
        if (!isAbortError(err)) {
          failure = runErrorMessage(err)
          setPipelineError(failure)
        }
      } finally {
        setIsRunning(false)
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setWasStopped(stoppedRef.current)
        setAgents(prev => settleAgents(prev, stoppedRef.current))
        setAnnouncement(stoppedRef.current ? 'Research stopped.' : failure ? `Research failed. ${failure}` : 'Research finished.')
      }
    },
    [isRunning, handleEvent, audit],
  )

  const handleStart = useCallback(() => void startRun(query), [startRun, query])

  const handleExample = useCallback(
    (text: string) => {
      setQuery(text)
      void startRun(text)
    },
    [startRun],
  )

  const handleStop = useCallback(() => {
    if (abortRef.current && isRunning) {
      stoppedRef.current = true
      abortRef.current.abort()
    } else {
      audit.stop()
      setAnnouncement('Audit stopped.')
    }
  }, [isRunning, audit])

  const handleExport = useCallback(
    (kind: ExportKind) => {
      setExporting(kind)
      // Loaded on demand so jspdf and docx stay out of the initial bundle.
      import('./lib/export')
        .then(async mod => {
          if (kind === 'pdf') mod.downloadPdf(ranQuery, agents)
          else if (kind === 'docx') await mod.downloadDocx(ranQuery, agents)
          else mod.downloadMarkdown(ranQuery, agents)
        })
        .catch(() => setPipelineError('Export failed. Try again.'))
        .finally(() => setExporting(null))
    },
    [ranQuery, agents],
  )

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (timerRef.current) clearInterval(timerRef.current)
    },
    [],
  )

  const startedRoles = MODEL_ORDER.filter(role => agents[role].status !== 'idle' && agents[role].status !== 'skipped')
  const hasStarted = AGENT_ORDER.some(role => agents[role].status !== 'idle')
  const hasAnyOutput = MODEL_ORDER.some(role => agents[role].output.trim().length > 0)
  const runningRole = AGENT_ORDER.find(role => agents[role].status === 'working')
  const phase = derivePhase(agents, isRunning, wasStopped)
  const auditing = audit.view.phase === 'running'
  const badge =
    phase === 'running' && runningRole
      ? { label: `Running: ${AGENT_META[runningRole].name}`, tone: 'accent' as BadgeTone }
      : auditing && !isRunning
        ? { label: 'Auditing', tone: 'accent' as BadgeTone }
        : BADGE[phase]

  useResultFocus(FOCUS_PHASE[phase])

  const readoutState: ReadoutState = isRunning ? 'running' : hasStarted ? 'done' : 'idle'
  const stageMsTotal = AGENT_ORDER.reduce((sum, role) => sum + (agents[role].ms ?? 0), 0)
  const totalMs = summary?.totalMs ?? (isRunning ? elapsedMs : stageMsTotal > 0 ? stageMsTotal : undefined)
  const totalIsStageSum = !summary && !isRunning && stageMsTotal > 0
  const usage = summary ? summary.usage : sumUsage(startedRoles.map(role => agents[role].usage))
  const model = summary ? summary.model : startedRoles.map(role => agents[role].servedModel).find(Boolean)

  const steps = buildSteps(agents, { phase: audit.view.phase, ms: audit.view.result?.ms })
  const traceRows = buildTraceRows(steps, agents, audit.view)

  const names = (roles: AgentRole[]) => roles.map(role => AGENT_META[role].name).join(', ')
  const notices: string[] = []
  if (!isRunning && wasStopped) notices.push('You stopped the run. Finished stages are kept below and can be exported.')
  const cut = AGENT_ORDER.filter(role => wasTruncated(agents[role]))
  if (!isRunning && cut.length > 0) notices.push(`Cut off before finishing: ${names(cut)}. Those sections may end mid-thought.`)
  const incomplete = MODEL_ORDER.filter(role => agents[role].status === 'complete' && !hasUsefulOutput(agents[role]))
  if (!isRunning && incomplete.length > 0) notices.push(`No usable output from: ${names(incomplete)}. The report is incomplete.`)
  const notRun = AGENT_ORDER.filter(role => agents[role].status === 'skipped')
  if (!isRunning && notRun.length > 0) notices.push(`Not run: ${names(notRun)}. The run ended before reaching them.`)
  if (!isRunning && foundNoSources(agents.retriever)) {
    notices.push('No sources were retrieved, so the Researcher worked from model memory. Its facts carry no citations and are unverified.')
  }
  if (AGENT_ORDER.some(role => agents[role].reasoningTokens > 0)) {
    notices.push('The model spent part of its budget on internal reasoning, which shortens the visible answers.')
  }
  const showNotices = notices.length > 0 && !noticesHidden
  const exportState: ExportState = isRunning ? 'running' : !hasAnyOutput ? 'empty' : phase === 'complete' ? 'complete' : 'partial'

  return (
    <div className="ds-app" data-run={FOCUS_PHASE[phase]}>
      <Header badgeLabel={badge.label} badgeTone={badge.tone} live={liveDataView(agents.retriever, fetchedAt)} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <QueryBar
              query={query}
              running={isRunning}
              auditing={auditing}
              announcement={announcement}
              pipelineError={pipelineError}
              onQueryChange={setQuery}
              onDismissError={() => setPipelineError(null)}
              onStart={handleStart}
              onStop={handleStop}
              onExample={handleExample}
            />
            <ExportBar variant="rail" state={exportState} busy={exporting} onExport={handleExport} />
          </div>

          <div className="ds-run">
            <ReportCard
              key={runId}
              phase={phase}
              synthesizer={agents.synthesizer}
              sources={agents.retriever.sources ?? []}
              error={pipelineError}
              hasSteps={AGENT_ORDER.some(role => agents[role].status === 'complete')}
              audit={audit.view}
              onRetryRun={() => void startRun(ranQuery || query)}
              onRetryAudit={audit.retry}
              after={<ExportBar variant="run" state={exportState} busy={exporting} onExport={handleExport} />}
            />
            <ReadoutStrip state={readoutState} totalMs={totalMs} totalIsStageSum={totalIsStageSum} usage={usage} model={model} summary={summary} audit={audit.view} />
            <GraphView steps={steps} />
            <RunTrace rows={traceRows} />
            <StageOutputs agents={agents} active={activeTab} onSelect={setActiveTab} />
            {showNotices && (
              <div className="ds-notice app-notes ds-run__trace">
                {notices.map(message => (
                  <p key={message}>{message}</p>
                ))}
                <div>
                  <button type="button" className="ds-button" onClick={() => setNoticesHidden(true)}>
                    Hide notes
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
