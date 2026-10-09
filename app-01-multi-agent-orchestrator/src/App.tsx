import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useEdgesState, useNodesState } from '@xyflow/react'
import { ExportBar, type ExportKind, type ExportState } from './components/ExportBar'
import { Header, type BadgeTone } from './components/Header'
import { OutputPanel } from './components/OutputPanel'
import { PipelineCanvas } from './components/PipelineCanvas'
import { QueryBar } from './components/QueryBar'
import { RunMetrics, type MetricsState } from './components/RunMetrics'
import { RunTrace, type TraceRow } from './components/RunTrace'
import {
  AGENT_META,
  AGENT_ORDER,
  MAX_QUERY_CHARS,
  MODEL_ORDER,
  createAgents,
  foundNoSources,
  hasUsefulOutput,
  statusView,
  wasTruncated,
} from './lib/agents'
import { isAbortError, runErrorMessage, startResearch } from './lib/api'
import {
  buildEdges,
  buildNodes,
  derivePhase,
  failInFlight,
  refreshNodes,
  settleAgents,
  traceDetail,
  traceMeta,
  type GraphLayout,
  type RunPhase,
} from './lib/pipeline'
import { sumUsage } from './lib/usage'
import type { AgentRole, AgentState, RunSummary, StreamEvent } from './types'

/** Below 640px the five steps snake two to a row instead of three. Matches the pipeline breakpoint in app.css. */
const NARROW_QUERY = '(max-width: 639px)'

const BADGE: Record<RunPhase, { label: string; tone: BadgeTone }> = {
  ready: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  complete: { label: 'Complete', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  stopped: { label: 'Stopped', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
}

function subscribeLayout(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readLayout(): GraphLayout {
  return window.matchMedia(NARROW_QUERY).matches ? 'cols2' : 'cols3'
}

export default function App() {
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>(createAgents)
  const [query, setQuery] = useState('')
  const [ranQuery, setRanQuery] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [wasStopped, setWasStopped] = useState(false)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [activeTab, setActiveTab] = useState<AgentRole>('retriever')
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [noticesHidden, setNoticesHidden] = useState(false)
  const [exporting, setExporting] = useState<ExportKind | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stoppedRef = useRef(false)

  const layout = useSyncExternalStore(subscribeLayout, readLayout)
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(agents, layout))
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(agents, layout))

  // The graph follows the agent state and the layout. A taken hand-off is drawn in the signal colour.
  useEffect(() => {
    setNodes(prev => refreshNodes(prev, agents, layout))
    setEdges(buildEdges(agents, layout))
  }, [agents, layout, setNodes, setEdges])

  const handleEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'session_complete':
        setSummary(event)
        if (event.result.trim()) setActiveTab('synthesizer')
        return
      case 'retrieve_start':
        setActiveTab('retriever')
        setAgents(prev => ({ ...prev, retriever: { ...prev.retriever, status: 'working', detail: 'Looking up Wikipedia and Hacker News.' } }))
        setAnnouncement('Retrieve is fetching public sources.')
        return
      case 'retrieve_complete': {
        const { ms, sources, detail } = event
        setAgents(prev => ({ ...prev, retriever: { ...prev.retriever, status: 'complete', ms, sources, detail } }))
        setAnnouncement(sources.length > 0 ? `Retrieve found ${sources.length} sources.` : 'Retrieve found no sources.')
        return
      }
      case 'agent_start': {
        const { agent, maxTokens } = event
        setActiveTab(agent)
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
        const { agent, ms, detail, finish, reasoningTokens, servedModel, usage } = event
        setAgents(prev => ({
          ...prev,
          [agent]: { ...prev[agent], status: 'complete', ms, detail, finish, reasoningTokens, servedModel, usage },
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
  }, [])

  const startRun = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_QUERY_CHARS)
      if (!text || isRunning) return

      setAgents(createAgents())
      setRanQuery(text)
      setSummary(null)
      setElapsedMs(0)
      setIsRunning(true)
      setWasStopped(false)
      setPipelineError(null)
      setNoticesHidden(false)
      setActiveTab('retriever')
      setAnnouncement('Research started. Sources are fetched first, then four stages run in order.')
      stoppedRef.current = false

      const startedAt = Date.now()
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await startResearch(text, handleEvent, controller.signal)
      } catch (err) {
        if (!isAbortError(err)) setPipelineError(runErrorMessage(err))
      } finally {
        setIsRunning(false)
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setWasStopped(stoppedRef.current)
        setAgents(prev => settleAgents(prev, stoppedRef.current))
        setAnnouncement(stoppedRef.current ? 'Research stopped.' : 'Research finished.')
      }
    },
    [isRunning, handleEvent],
  )

  const handleStart = useCallback(() => {
    void startRun(query)
  }, [startRun, query])

  const handleExample = useCallback(
    (text: string) => {
      setQuery(text)
      void startRun(text)
    },
    [startRun],
  )

  const handleStop = useCallback(() => {
    stoppedRef.current = true
    abortRef.current?.abort()
  }, [])

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
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    },
    [],
  )

  const startedRoles = MODEL_ORDER.filter(role => agents[role].status !== 'idle' && agents[role].status !== 'skipped')
  const hasStarted = AGENT_ORDER.some(role => agents[role].status !== 'idle')
  const hasAnyOutput = MODEL_ORDER.some(role => agents[role].output.trim().length > 0)
  const runningRole = AGENT_ORDER.find(role => agents[role].status === 'working')
  const phase = derivePhase(agents, isRunning, wasStopped)
  const badge =
    phase === 'running' && runningRole
      ? { label: `Running: ${AGENT_META[runningRole].name}`, tone: 'accent' as BadgeTone }
      : BADGE[phase]

  const metricsState: MetricsState = isRunning ? 'running' : hasStarted ? 'done' : 'idle'
  const stageMsTotal = AGENT_ORDER.reduce((sum, role) => sum + (agents[role].ms ?? 0), 0)
  const totalMs = summary?.totalMs ?? (isRunning ? elapsedMs : stageMsTotal > 0 ? stageMsTotal : undefined)
  const totalIsStageSum = !summary && !isRunning && stageMsTotal > 0
  const usage = summary ? summary.usage : sumUsage(startedRoles.map(role => agents[role].usage))
  const model = summary ? summary.model : startedRoles.map(role => agents[role].servedModel).find(Boolean)

  const traceRows: TraceRow[] = AGENT_ORDER.map((role, i) => {
    const agent = agents[role]
    return {
      index: i + 1,
      name: AGENT_META[role].name,
      view: statusView(agent),
      running: agent.status === 'working',
      ms: agent.ms,
      detail: traceDetail(agent),
      meta: traceMeta(agent),
    }
  })

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
  const showExamples = !isRunning && !hasAnyOutput
  const exportState: ExportState = isRunning ? 'running' : !hasAnyOutput ? 'empty' : phase === 'complete' ? 'complete' : 'partial'

  return (
    <div className="ds-app">
      <Header badgeLabel={badge.label} badgeTone={badge.tone} />

      <main className="ds-main">
        <div className="ds-bench">
          <div className="ds-controls">
            <QueryBar
              query={query}
              onQueryChange={setQuery}
              isRunning={isRunning}
              showExamples={showExamples}
              announcement={announcement}
              pipelineError={pipelineError}
              onDismissError={() => setPipelineError(null)}
              onStart={handleStart}
              onStop={handleStop}
              onExample={handleExample}
            />
            <ExportBar state={exportState} busy={exporting} onExport={handleExport} />
          </div>

          <div className="ds-run">
            <section className="ds-section" aria-labelledby="pipeline-heading">
              <div className="ds-section__head">
                <h2 id="pipeline-heading" className="ds-section__title">
                  Pipeline
                </h2>
                <p className="ds-section__sub">Retrieve fetches public sources. Each other node is one model call, and the Synthesizer reads the three stages before it.</p>
              </div>
              <div className="ds-panel pipeline-panel">
                <div className="pipeline-canvas">
                  <PipelineCanvas nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} />
                </div>
              </div>
            </section>

            <section className="ds-section" aria-labelledby="figures-heading">
              <div className="ds-section__head">
                <h2 id="figures-heading" className="ds-section__title">
                  Run figures
                </h2>
                <p className="ds-section__sub">What the provider reports for the run. A figure it did not send shows as not reported.</p>
              </div>
              <RunMetrics state={metricsState} totalMs={totalMs} totalIsStageSum={totalIsStageSum} usage={usage} model={model} />
            </section>

            <section className="ds-section" aria-labelledby="report-heading">
              <div className="ds-section__head">
                <h2 id="report-heading" className="ds-section__title">
                  Report
                </h2>
                <p className="ds-section__sub">Each tab fills when its step finishes. Retrieve lists the sources, and the Synthesizer holds the final answer.</p>
              </div>
              <div className="ds-panel report-panel">
                <OutputPanel agents={agents} activeTab={activeTab} onSelect={setActiveTab} />
              </div>
              {showNotices && (
                <div className="ds-notice app-notes">
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
            </section>

            <section className="ds-section" aria-labelledby="trace-heading">
              <div className="ds-section__head">
                <h2 id="trace-heading" className="ds-section__title">
                  Run trace
                </h2>
                <p className="ds-section__sub">Timed on the server, one line per step.</p>
              </div>
              <RunTrace rows={traceRows} />
            </section>
          </div>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
