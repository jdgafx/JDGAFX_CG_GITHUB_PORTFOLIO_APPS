import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEdgesState, useNodesState, type Edge, type Node } from '@xyflow/react'
import { ExportBar, type ExportKind } from './components/ExportBar'
import { Header } from './components/Header'
import { OutputPanel } from './components/OutputPanel'
import { PipelineCanvas } from './components/PipelineCanvas'
import { QueryBar } from './components/QueryBar'
import { StatusPanel } from './components/StatusPanel'
import { AGENT_ORDER, MAX_QUERY_CHARS, createAgents, hasUsefulOutput, wasTruncated } from './lib/agents'
import { startResearch } from './lib/api'
import type { AgentRole, AgentState, StreamEvent } from './types'

/** Matches the stacked-layout breakpoint in index.css. */
const COMPACT_QUERY = '(max-width: 767px)'

function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY)
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches)
    setCompact(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return compact
}

/**
 * Stacked on desktop. On a phone the graph area is short and wide, where a
 * four-node column can only fit at an unreadable zoom, so it becomes a 2x2 grid.
 */
function nodePosition(index: number, compact: boolean): { x: number; y: number } {
  if (compact) return { x: (index % 2) * 250 + 30, y: Math.floor(index / 2) * 175 + 20 }
  return { x: 60, y: index * 160 + 20 }
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

const STATIC_EDGES: Edge[] = AGENT_ORDER.slice(0, -1).map((role, i) => ({
  id: `e-${role}`,
  source: role,
  target: AGENT_ORDER[i + 1] as string,
  animated: false,
}))

export default function App() {
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>(createAgents)
  const [query, setQuery] = useState('')
  const [ranQuery, setRanQuery] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [wasStopped, setWasStopped] = useState(false)
  const [activeTab, setActiveTab] = useState<AgentRole>('researcher')
  const [elapsed, setElapsed] = useState(0)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [noticeDismissed, setNoticeDismissed] = useState(false)
  const [exporting, setExporting] = useState<ExportKind | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stoppedRef = useRef(false)

  const compact = useIsCompact()
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(createAgents(), compact))
  const [edges, setEdges, onEdgesChange] = useEdgesState(STATIC_EDGES)

  useEffect(() => {
    setNodes(prev => prev.map((node, i) => ({ ...node, position: nodePosition(i, compact) })))
  }, [compact, setNodes])

  // Only the agent whose state object actually changed gets a new node object, so
  // a streamed chunk re-renders one node instead of rebuilding the whole graph.
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

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      if (event.type === 'session_complete') {
        setSessionEnded(true)
        return
      }

      if (event.agent === 'system') {
        // A system-level failure ends every agent still in flight — otherwise they
        // pulse "thinking" forever behind the error banner.
        if (event.type !== 'agent_error') return
        setAgents(prev => {
          const next = { ...prev }
          for (const role of AGENT_ORDER) {
            const status = next[role].status
            if (status === 'working' || status === 'thinking') {
              next[role] = { ...next[role], status: 'error', error: event.error, endTime: Date.now() }
            }
          }
          return next
        })
        setEdges(prev => prev.map(edge => ({ ...edge, animated: false })))
        setPipelineError(event.error ?? 'An error occurred during processing.')
        return
      }

      const role = event.agent
      switch (event.type) {
        case 'agent_start':
          setActiveTab(role)
          setAgents(prev => ({
            ...prev,
            [role]: {
              ...prev[role],
              status: 'working',
              startTime: Date.now(),
              maxTokens: event.maxTokens ?? prev[role].maxTokens,
              finish: null,
              error: undefined,
            },
          }))
          setEdges(prev => prev.map(edge => ({ ...edge, animated: edge.source === role || edge.target === role })))
          break
        case 'agent_chunk':
          setAgents(prev => ({
            ...prev,
            [role]: { ...prev[role], output: prev[role].output + (event.content ?? '') },
          }))
          break
        case 'agent_complete':
          setAgents(prev => ({
            ...prev,
            [role]: {
              ...prev[role],
              status: 'complete',
              tokens: event.tokens ?? 0,
              reasoningTokens: event.reasoningTokens ?? 0,
              finish: event.finish ?? null,
              endTime: Date.now(),
            },
          }))
          setEdges(prev => prev.map(edge => ({ ...edge, animated: false })))
          break
        case 'agent_error':
          setAgents(prev => ({
            ...prev,
            [role]: { ...prev[role], status: 'error', error: event.error, endTime: Date.now() },
          }))
          setEdges(prev => prev.map(edge => ({ ...edge, animated: false })))
          setPipelineError(event.error ?? 'An error occurred during processing.')
          break
      }
    },
    [setEdges],
  )

  const startRun = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_QUERY_CHARS)
      if (!text || isRunning) return

      const fresh = createAgents()
      setAgents(fresh)
      setNodes(buildNodes(fresh, compact))
      setEdges(STATIC_EDGES)
      setRanQuery(text)
      setElapsed(0)
      setIsRunning(true)
      setSessionEnded(false)
      setWasStopped(false)
      setPipelineError(null)
      setNoticeDismissed(false)
      setActiveTab('researcher')
      stoppedRef.current = false

      const startedAt = Date.now()
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await startResearch(text, handleEvent, controller.signal)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setPipelineError((err as Error).message || 'An unexpected error occurred.')
        }
      } finally {
        setIsRunning(false)
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setEdges(prev => prev.map(edge => ({ ...edge, animated: false })))
        setWasStopped(stoppedRef.current)
        // Once the stream is over nothing can still be running — leaving an agent
        // on "working" pulses it forever and hides whatever partial text it got.
        setAgents(prev => {
          let changed = false
          const next = { ...prev }
          for (const role of AGENT_ORDER) {
            const status = next[role].status
            if (status === 'working' || status === 'thinking') {
              changed = true
              next[role] = { ...next[role], status: 'stopped', endTime: Date.now() }
            }
          }
          return changed ? next : prev
        })
      }
    },
    [isRunning, handleEvent, setEdges, setNodes, compact],
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
        .catch((err: unknown) =>
          setPipelineError(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`),
        )
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

  const synthesizerOutput = agents.synthesizer.output
  useEffect(() => {
    if (sessionEnded && synthesizerOutput.trim()) setActiveTab('synthesizer')
  }, [sessionEnded, synthesizerOutput])

  const totalTokens = AGENT_ORDER.reduce((sum, role) => sum + agents[role].tokens, 0)
  const hasAnyOutput = AGENT_ORDER.some(role => agents[role].output.trim().length > 0)
  const allProduced = AGENT_ORDER.every(role => agents[role].status === 'complete' && hasUsefulOutput(agents[role]))
  const runFinished = !isRunning && hasAnyOutput
  const isPipelineComplete = runFinished && sessionEnded && allProduced
  const showExamples = !isRunning && !hasAnyOutput

  const notices = useMemo(() => {
    if (isRunning) return []
    const names = (roles: AgentRole[]) => roles.map(role => agents[role].name).join(', ')
    const messages: string[] = []
    if (wasStopped) {
      messages.push('You stopped the run. Whatever the agents had produced is kept below and can still be exported.')
    }
    const truncated = AGENT_ORDER.filter(role => wasTruncated(agents[role]))
    if (truncated.length > 0) {
      messages.push(`Cut off before finishing: ${names(truncated)}. Those sections may end mid-thought.`)
    }
    const missing = AGENT_ORDER.filter(role => agents[role].status !== 'idle' && !hasUsefulOutput(agents[role]))
    if (missing.length > 0) {
      messages.push(`No usable output from: ${names(missing)}. The report below is incomplete.`)
    }
    if (AGENT_ORDER.some(role => agents[role].reasoningTokens > 0)) {
      messages.push('The model spent part of its budget on internal reasoning, which shortens the visible answers.')
    }
    return messages
  }, [agents, isRunning, wasStopped])

  const showNotices = notices.length > 0 && !noticeDismissed

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0a0e1a' }}>
      <Header elapsed={elapsed} isRunning={isRunning} isComplete={isPipelineComplete} totalTokens={totalTokens} />

      <div className="workspace">
        <PipelineCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          statusPanel={
            isRunning || runFinished ? (
              <StatusPanel agents={agents} activeTab={activeTab} isRunning={isRunning} isComplete={isPipelineComplete} />
            ) : undefined
          }
        />
        <OutputPanel agents={agents} activeTab={activeTab} onSelect={setActiveTab} />
      </div>

      {runFinished && <ExportBar complete={isPipelineComplete} busy={exporting} onExport={handleExport} />}

      {showNotices && (
        <div
          role="status"
          style={{
            padding: '10px 20px',
            borderTop: '1px solid rgba(255,165,0,0.25)',
            background: 'rgba(255,165,0,0.06)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ width: 8, height: 8, marginTop: 6, borderRadius: '50%', background: '#ffa500', flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 12.5, color: '#ffbf4d', lineHeight: 1.5 }}>
            {notices.map(message => (
              <div key={message}>{message}</div>
            ))}
          </div>
          <button
            onClick={() => setNoticeDismissed(true)}
            title="Dismiss these notices"
            aria-label="Dismiss notices"
            style={{
              background: 'none',
              border: 'none',
              color: '#ffa500',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 4px',
              fontFamily: 'inherit',
            }}
          >
            ×
          </button>
        </div>
      )}

      {pipelineError && (
        <div
          role="alert"
          style={{
            padding: '10px 20px',
            borderTop: '1px solid rgba(255,51,102,0.25)',
            background: 'rgba(255,51,102,0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff3366', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, color: '#ff6688', lineHeight: 1.4 }}>{pipelineError}</span>
          <button
            onClick={() => setPipelineError(null)}
            title="Dismiss this error"
            aria-label="Dismiss error"
            style={{
              background: 'none',
              border: 'none',
              color: '#ff3366',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 4px',
              fontFamily: 'inherit',
            }}
          >
            ×
          </button>
        </div>
      )}

      <QueryBar
        query={query}
        onQueryChange={setQuery}
        isRunning={isRunning}
        showExamples={showExamples}
        onStart={handleStart}
        onStop={handleStop}
        onExample={handleExample}
      />
      <footer
        style={{
          textAlign: 'center',
          padding: '12px 0',
          fontSize: 12,
          color: '#94a3b8',
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
