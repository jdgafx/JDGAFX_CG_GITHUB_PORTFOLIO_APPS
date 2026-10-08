import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useEdgesState, useNodesState, type Edge, type Node } from '@xyflow/react'
import { ExportBar, type ExportKind } from './components/ExportBar'
import { Header, type BadgeTone } from './components/Header'
import { OutputPanel } from './components/OutputPanel'
import { PipelineCanvas } from './components/PipelineCanvas'
import { QueryBar } from './components/QueryBar'
import { RunMetrics, type MetricsState } from './components/RunMetrics'
import { RunTrace, type TraceRow } from './components/RunTrace'
import { AGENT_META, AGENT_ORDER, MAX_QUERY_CHARS, createAgents, hasUsefulOutput, wasTruncated } from './lib/agents'
import { isAbortError, runErrorMessage, startResearch } from './lib/api'
import { sumUsage } from './lib/usage'
import type { AgentRole, AgentState, AgentStatus, RunSummary, StreamEvent } from './types'

/** Stacked layout at phone widths. Matches the breakpoint in app.css. */
const COMPACT_QUERY = '(max-width: 720px)'

type RunPhase = 'ready' | 'running' | 'complete' | 'partial' | 'stopped' | 'failed'

const BADGE: Record<RunPhase, { label: string; tone: BadgeTone }> = {
  ready: { label: 'Ready', tone: 'neutral' },
  running: { label: 'Running', tone: 'accent' },
  complete: { label: 'Complete', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  stopped: { label: 'Stopped', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
}

const TRACE_STATUS: Record<AgentStatus, TraceRow['status']> = {
  idle: 'waiting',
  working: 'running',
  complete: 'ok',
  error: 'failed',
  skipped: 'skipped',
  stopped: 'stopped',
}

function subscribeCompact(onChange: () => void): () => void {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readCompact(): boolean {
  return window.matchMedia(COMPACT_QUERY).matches
}

/** The viewport class, read from the media query on every render. No state is copied in an effect. */
function useIsCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, readCompact)
}

function nodePosition(index: number, compact: boolean): { x: number; y: number } {
  if (compact) return { x: (index % 2) * 200 + 20, y: Math.floor(index / 2) * 150 + 16 }
  return { x: index * 210 + 16, y: 24 }
}

function buildNodes(agents: Record<AgentRole, AgentState>, compact: boolean): Node[] {
  return AGENT_ORDER.map((role, i) => ({
    id: role,
    type: 'agent',
    position: nodePosition(i, compact),
    draggable: false,
    selectable: false,
    connectable: false,
    data: agents[role] as unknown as Record<string, unknown>,
  }))
}

/** On phones the stages form a 2x2 grid, so the analyst-to-critic edge drops down. The rest run across. */
function buildEdges(compact: boolean): Edge[] {
  return AGENT_ORDER.slice(0, -1).map((source, i) => {
    const down = compact && i === 1
    return {
      id: `e-${source}`,
      source,
      target: AGENT_ORDER[i + 1] ?? source,
      sourceHandle: down ? 'source-bottom' : 'source-right',
      targetHandle: down ? 'target-top' : 'target-left',
      animated: false,
    }
  })
}

function traceDetail(agent: AgentState): string {
  switch (agent.status) {
    case 'idle':
      return 'Waiting to start.'
    case 'working':
      return 'Model call in progress.'
    case 'complete':
      return agent.detail
    case 'error':
      return agent.error ?? 'Failed.'
    case 'skipped':
      return agent.detail
    case 'stopped':
      return 'Stopped before it finished.'
  }
}

/** Once the stream has ended nothing can still be running. Each unfinished stage says why. */
function settleAgents(prev: Record<AgentRole, AgentState>, stopped: boolean): Record<AgentRole, AgentState> {
  const next = { ...prev }
  for (const role of AGENT_ORDER) {
    const agent = prev[role]
    if (agent.status === 'working') {
      next[role] = stopped
        ? { ...agent, status: 'stopped', detail: 'Stopped before it finished.' }
        : { ...agent, status: 'error', error: 'The connection ended before this stage finished.', detail: 'The connection ended before this stage finished.' }
    } else if (agent.status === 'idle') {
      next[role] = { ...agent, status: 'skipped', detail: stopped ? 'Not started: the run was stopped.' : 'Not started: the run ended first.' }
    }
  }
  return next
}

/** A system-level failure ends every stage still in flight, so none pulses behind the error. */
function failInFlight(prev: Record<AgentRole, AgentState>, message: string): Record<AgentRole, AgentState> {
  const next = { ...prev }
  for (const role of AGENT_ORDER) {
    const agent = prev[role]
    if (agent.status === 'working') next[role] = { ...agent, status: 'error', error: message, detail: message }
  }
  return next
}

function derivePhase(agents: Record<AgentRole, AgentState>, isRunning: boolean, wasStopped: boolean): RunPhase {
  if (isRunning) return 'running'
  if (AGENT_ORDER.every(role => agents[role].status === 'idle')) return 'ready'
  if (wasStopped) return 'stopped'
  if (AGENT_ORDER.every(role => agents[role].status === 'complete' && hasUsefulOutput(agents[role]) && !wasTruncated(agents[role])))
    return 'complete'
  if (AGENT_ORDER.some(role => agents[role].output.trim().length > 0)) return 'partial'
  return 'failed'
}

export default function App() {
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>(createAgents)
  const [query, setQuery] = useState('')
  const [ranQuery, setRanQuery] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [wasStopped, setWasStopped] = useState(false)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [activeTab, setActiveTab] = useState<AgentRole>('researcher')
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [noticesHidden, setNoticesHidden] = useState(false)
  const [exporting, setExporting] = useState<ExportKind | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stoppedRef = useRef(false)

  const compact = useIsCompact()
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(createAgents(), compact))
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges(compact))

  useEffect(() => {
    setNodes(prev => prev.map((node, i) => ({ ...node, position: nodePosition(i, compact) })))
    setEdges(buildEdges(compact))
  }, [compact, setNodes, setEdges])

  // Only a stage whose state object changed gets a new node object, so a streamed chunk
  // re-renders one node instead of the whole graph.
  useEffect(() => {
    setNodes(prev => {
      let changed = false
      const next = prev.map(node => {
        const state = agents[node.id as AgentRole]
        if (!state || node.data === (state as unknown)) return node
        changed = true
        return { ...node, data: state as unknown as Record<string, unknown> }
      })
      return changed ? next : prev
    })
  }, [agents, setNodes])

  const setFlowing = useCallback(
    (role: AgentRole | null) => {
      setEdges(prev => prev.map(edge => ({ ...edge, animated: role !== null && (edge.source === role || edge.target === role) })))
    },
    [setEdges],
  )

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case 'session_complete':
          setSummary(event)
          if (event.result.trim()) setActiveTab('synthesizer')
          return
        case 'agent_start': {
          const role = event.agent
          const maxTokens = event.maxTokens
          setActiveTab(role)
          setAgents(prev => ({ ...prev, [role]: { ...prev[role], status: 'working', maxTokens, detail: 'Model call in progress.' } }))
          setFlowing(role)
          setAnnouncement(`${AGENT_META[role].name} is working.`)
          return
        }
        case 'agent_chunk': {
          const role = event.agent
          const text = event.content
          setAgents(prev => ({ ...prev, [role]: { ...prev[role], output: prev[role].output + text } }))
          return
        }
        case 'agent_complete': {
          const role = event.agent
          const { ms, detail, finish, reasoningTokens, servedModel, usage } = event
          setAgents(prev => ({
            ...prev,
            [role]: { ...prev[role], status: 'complete', ms, detail, finish, reasoningTokens, servedModel, usage },
          }))
          setFlowing(null)
          setAnnouncement(`${AGENT_META[role].name} finished in ${ms.toLocaleString('en-US')} ms.`)
          return
        }
        case 'agent_skipped': {
          const role = event.agent
          const detail = event.detail
          setAgents(prev => ({ ...prev, [role]: { ...prev[role], status: 'skipped', detail } }))
          setAnnouncement(`${AGENT_META[role].name} was not run.`)
          return
        }
        case 'agent_error': {
          const message = event.error
          setFlowing(null)
          setPipelineError(message)
          if (event.agent === 'system') {
            setAgents(prev => failInFlight(prev, message))
            return
          }
          const role = event.agent
          const ms = event.ms
          setAgents(prev => ({ ...prev, [role]: { ...prev[role], status: 'error', error: message, detail: message, ms } }))
          setAnnouncement(`${AGENT_META[role].name} failed. ${message}`)
          return
        }
      }
    },
    [setFlowing],
  )

  const startRun = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_QUERY_CHARS)
      if (!text || isRunning) return

      const fresh = createAgents()
      setAgents(fresh)
      setNodes(buildNodes(fresh, compact))
      setEdges(buildEdges(compact))
      setRanQuery(text)
      setSummary(null)
      setElapsedMs(0)
      setIsRunning(true)
      setWasStopped(false)
      setPipelineError(null)
      setNoticesHidden(false)
      setActiveTab('researcher')
      setAnnouncement('Run started.')
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
        setFlowing(null)
        setAgents(prev => settleAgents(prev, stoppedRef.current))
        setAnnouncement(stoppedRef.current ? 'Run stopped.' : 'Run finished.')
      }
    },
    [isRunning, handleEvent, setEdges, setNodes, compact, setFlowing],
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

  const startedRoles = AGENT_ORDER.filter(role => agents[role].status !== 'idle' && agents[role].status !== 'skipped')
  const hasStarted = AGENT_ORDER.some(role => agents[role].status !== 'idle')
  const hasAnyOutput = AGENT_ORDER.some(role => agents[role].output.trim().length > 0)
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
      status: agent.status === 'complete' && wasTruncated(agent) ? 'cut off' : TRACE_STATUS[agent.status],
      ms: agent.ms,
      detail: traceDetail(agent),
      tokens: agent.usage?.completion_tokens,
      cost: agent.usage?.cost,
    }
  })

  const names = (roles: AgentRole[]) => roles.map(role => AGENT_META[role].name).join(', ')
  const notices: string[] = []
  if (!isRunning && wasStopped) notices.push('You stopped the run. Finished stages are kept below and can be exported.')
  const cut = AGENT_ORDER.filter(role => wasTruncated(agents[role]))
  if (!isRunning && cut.length > 0) notices.push(`Cut off before finishing: ${names(cut)}. Those sections may end mid-thought.`)
  const incomplete = AGENT_ORDER.filter(role => agents[role].status === 'complete' && !hasUsefulOutput(agents[role]))
  if (!isRunning && incomplete.length > 0) notices.push(`No usable output from: ${names(incomplete)}. The report is incomplete.`)
  const notRun = AGENT_ORDER.filter(role => agents[role].status === 'skipped')
  if (!isRunning && notRun.length > 0) notices.push(`Not run: ${names(notRun)}. The run ended before reaching them.`)
  if (AGENT_ORDER.some(role => agents[role].reasoningTokens > 0)) {
    notices.push('The model spent part of its budget on internal reasoning, which shortens the visible answers.')
  }
  const showNotices = notices.length > 0 && !noticesHidden
  const canExport = !isRunning && hasAnyOutput
  const showExamples = !isRunning && !hasAnyOutput

  return (
    <div className="ds-app">
      <Header badgeLabel={badge.label} badgeTone={badge.tone} />

      <main className="ds-main">
        <QueryBar
          query={query}
          onQueryChange={setQuery}
          isRunning={isRunning}
          showExamples={showExamples}
          onStart={handleStart}
          onStop={handleStop}
          onExample={handleExample}
        />

        <p className="ds-hint app-status" role="status" aria-live="polite">
          {announcement}
        </p>

        {pipelineError && (
          <div className="ds-notice ds-notice--error app-alert" role="alert">
            <span>{pipelineError}</span>
            <button type="button" className="ds-button" onClick={() => setPipelineError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <section className="ds-card" aria-labelledby="pipeline-heading">
          <div className="ds-card__head">
            <h2 id="pipeline-heading" className="ds-card__title">
              Pipeline
            </h2>
            <span className="ds-hint">Each node is one model call. Stages run in order.</span>
          </div>
          <div className="pipeline-canvas">
            <PipelineCanvas nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} />
          </div>
        </section>

        <section className="ds-card" aria-labelledby="report-heading">
          <div className="ds-card__head">
            <h2 id="report-heading" className="ds-card__title">
              Report
            </h2>
            <span className="ds-hint">Each stage's output appears when that stage finishes.</span>
          </div>
          <OutputPanel agents={agents} activeTab={activeTab} onSelect={setActiveTab} />
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

        <div className="ds-grid-2">
          <section className="ds-card" aria-labelledby="trace-heading">
            <div className="ds-card__head">
              <h2 id="trace-heading" className="ds-card__title">
                Run trace
              </h2>
              <span className="ds-hint">Timed on the server, one line per stage.</span>
            </div>
            <RunTrace rows={traceRows} />
          </section>

          <section className="ds-card" aria-labelledby="metrics-heading">
            <div className="ds-card__head">
              <h2 id="metrics-heading" className="ds-card__title">
                Run metrics
              </h2>
              <span className="ds-hint">Figures the provider reports. Gaps show as not reported.</span>
            </div>
            <RunMetrics
              state={metricsState}
              totalMs={totalMs}
              totalIsStageSum={totalIsStageSum}
              usage={usage}
              model={model}
            />
          </section>
        </div>

        {canExport && (
          <ExportBar complete={phase === 'complete'} busy={exporting} disabled={isRunning} onExport={handleExport} />
        )}
      </main>

      <footer className="ds-footer">
        <div className="ds-footer__inner">Christopher Gentile</div>
      </footer>
    </div>
  )
}
