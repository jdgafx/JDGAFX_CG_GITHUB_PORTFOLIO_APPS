import '@xyflow/react/dist/style.css'
import { useState, useCallback, useRef, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type NodeTypes,
  type Node,
  type Edge,
} from '@xyflow/react'
import { Bot, ChevronRight, Square } from 'lucide-react'
import { AgentNode } from './components/AgentNode'
import { startResearch } from './lib/api'
import type { AgentRole, AgentState, StreamEvent } from './types'

const nodeTypes: NodeTypes = { agent: AgentNode as unknown as NodeTypes[string] }

const AGENT_ORDER: AgentRole[] = ['researcher', 'analyst', 'critic', 'synthesizer']

const DEFAULT_AGENTS: Record<AgentRole, AgentState> = {
  researcher: { id: 'researcher', name: 'Researcher', description: 'Web search & data', status: 'idle', output: '', tokens: 0 },
  analyst: { id: 'analyst', name: 'Analyst', description: 'Pattern analysis', status: 'idle', output: '', tokens: 0 },
  critic: { id: 'critic', name: 'Critic', description: 'Quality review', status: 'idle', output: '', tokens: 0 },
  synthesizer: { id: 'synthesizer', name: 'Synthesizer', description: 'Final report', status: 'idle', output: '', tokens: 0 },
}

function buildNodes(agents: Record<AgentRole, AgentState>): Node[] {
  return AGENT_ORDER.map((role, i) => ({
    id: role,
    type: 'agent',
    position: { x: i * 220 + 20, y: 100 },
    data: agents[role] as unknown as Record<string, unknown>,
  }))
}

const STATIC_EDGES: Edge[] = AGENT_ORDER.slice(0, -1).map((role, i) => ({
  id: `e-${role}`,
  source: role,
  target: AGENT_ORDER[i + 1] as string,
  animated: false,
}))

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function App() {
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>(DEFAULT_AGENTS)
  const [query, setQuery] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<AgentRole>('researcher')
  const [elapsed, setElapsed] = useState(0)
  const [totalTokens, setTotalTokens] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(DEFAULT_AGENTS))
  const [edges, setEdges, onEdgesChange] = useEdgesState(STATIC_EDGES)

  const syncNodes = useCallback(
    (next: Record<AgentRole, AgentState>) => setNodes(buildNodes(next)),
    [setNodes],
  )

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      if (event.type === 'agent_start') {
        setActiveTab(event.agent)
        setAgents(prev => {
          const next = { ...prev, [event.agent]: { ...prev[event.agent], status: 'working' as const, startTime: Date.now() } }
          syncNodes(next)
          return next
        })
        setEdges(prev => prev.map(e => ({ ...e, animated: e.source === event.agent || e.target === event.agent })))
      } else if (event.type === 'agent_chunk') {
        setAgents(prev => {
          const next = { ...prev, [event.agent]: { ...prev[event.agent], output: prev[event.agent].output + (event.content ?? '') } }
          syncNodes(next)
          return next
        })
      } else if (event.type === 'agent_complete') {
        const tokens = event.tokens ?? 0
        setAgents(prev => {
          const next = { ...prev, [event.agent]: { ...prev[event.agent], status: 'complete' as const, tokens, endTime: Date.now() } }
          syncNodes(next)
          return next
        })
        setTotalTokens(prev => prev + tokens)
        setEdges(prev => prev.map(e => ({ ...e, animated: false })))
      } else if (event.type === 'agent_error') {
        setAgents(prev => {
          const next = { ...prev, [event.agent]: { ...prev[event.agent], status: 'error' as const } }
          syncNodes(next)
          return next
        })
      }
    },
    [syncNodes, setEdges],
  )

  const handleStart = useCallback(async () => {
    if (!query.trim() || isRunning) return

    const fresh = { ...DEFAULT_AGENTS }
    setAgents(fresh)
    syncNodes(fresh)
    setEdges(STATIC_EDGES)
    setTotalTokens(0)
    setElapsed(0)
    setIsRunning(true)
    setActiveTab('researcher')

    const start = Date.now()
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      await startResearch(query, handleEvent, ctrl.signal)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error(err)
    } finally {
      setIsRunning(false)
      if (timerRef.current) clearInterval(timerRef.current)
      setEdges(prev => prev.map(e => ({ ...e, animated: false })))
    }
  }, [query, isRunning, handleEvent, syncNodes, setEdges])

  const handleStop = useCallback(() => abortRef.current?.abort(), [])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (timerRef.current) clearInterval(timerRef.current)
    },
    [],
  )

  const activeAgent = agents[activeTab]
  const isActiveWorking = activeAgent.status === 'working' || activeAgent.status === 'thinking'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#0a0e1a' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: '#111827',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ padding: 7, borderRadius: 10, background: 'rgba(0,212,255,0.12)', color: '#00d4ff', display: 'flex' }}>
            <Bot size={20} />
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9', letterSpacing: -0.3 }}>AgentFlow</span>
          <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8, fontWeight: 400 }}>Enter a research topic and watch 4 AI agents collaborate in real time.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 13, color: '#94a3b8' }}>
          {isRunning && (
            <span style={{ color: '#00d4ff', fontFamily: 'monospace', fontWeight: 600 }}>
              {formatTime(elapsed)}
            </span>
          )}
          {totalTokens > 0 && <span>{totalTokens.toLocaleString()} tokens</span>}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="rgba(255,255,255,0.025)" gap={28} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <div
          style={{
            width: 400,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: '#111827',
              flexShrink: 0,
            }}
          >
            {AGENT_ORDER.map(role => (
              <button
                key={role}
                onClick={() => setActiveTab(role)}
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: 'capitalize',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === role ? '2px solid #00d4ff' : '2px solid transparent',
                  color: activeTab === role ? '#00d4ff' : '#64748b',
                  cursor: 'pointer',
                  transition: 'color 0.15s',
                }}
              >
                {role}
                {agents[role].status === 'complete' && (
                  <span style={{ color: '#00ff88', marginLeft: 3 }}>✓</span>
                )}
                {(agents[role].status === 'working' || agents[role].status === 'thinking') && (
                  <span style={{ color: '#00d4ff', marginLeft: 3 }}>●</span>
                )}
              </button>
            ))}
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              lineHeight: 1.65,
              color: '#94a3b8',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {activeAgent.output ? (
              <span className={isActiveWorking ? 'typing-cursor' : ''}>{activeAgent.output}</span>
            ) : (
              <span style={{ color: '#475569', fontStyle: 'italic' }}>
                {activeAgent.status === 'idle' ? 'Waiting for task...' : 'Processing...'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '12px 20px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          background: '#111827',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleStart()}
            placeholder="Enter research query..."
            disabled={isRunning}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 12,
              background: 'rgba(17,24,39,0.7)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#f1f5f9',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={isRunning ? handleStop : handleStart}
            disabled={!isRunning && !query.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 20px',
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              cursor: !isRunning && !query.trim() ? 'not-allowed' : 'pointer',
              background: isRunning ? 'rgba(255,51,102,0.12)' : 'rgba(0,212,255,0.1)',
              color: isRunning ? '#ff3366' : '#00d4ff',
              border: isRunning ? '1px solid rgba(255,51,102,0.3)' : '1px solid rgba(0,212,255,0.3)',
              transition: 'all 0.15s',
              opacity: !isRunning && !query.trim() ? 0.5 : 1,
              fontFamily: 'inherit',
            }}
          >
            {isRunning ? (
              <><Square size={13} /> Stop</>
            ) : (
              <><ChevronRight size={13} /> Start Research</>
            )}
          </button>
        </div>
      </div>
      <footer style={{ textAlign: 'center', padding: '12px 0', fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        Authored by Christopher Gentile / CGDarkstardev1 / NewDawn AI
      </footer>
    </div>
  )
}
