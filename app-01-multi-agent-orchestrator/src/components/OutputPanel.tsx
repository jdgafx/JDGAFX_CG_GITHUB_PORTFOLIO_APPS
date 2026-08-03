import { useEffect, useRef, useState } from 'react'
import { AGENT_COLORS, AGENT_ORDER, AGENT_TOOLTIPS, wasTruncated } from '../lib/agents'
import { Markdown } from './Markdown'
import type { AgentRole, AgentState } from '../types'

interface OutputPanelProps {
  agents: Record<AgentRole, AgentState>
  activeTab: AgentRole
  onSelect: (role: AgentRole) => void
}

function tabColor(agent: AgentState, isActive: boolean, accent: string): string {
  if (isActive) return accent
  if (agent.status === 'complete') return '#00ff88'
  if (agent.status === 'error') return '#ff3366'
  if (agent.status === 'stopped') return '#ffa500'
  if (agent.status === 'working' || agent.status === 'thinking') return accent
  return '#94a3b8'
}

export function OutputPanel({ agents, activeTab, onSelect }: OutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const prevTabRef = useRef<AgentRole>(activeTab)
  const [transitioning, setTransitioning] = useState(false)

  const active = agents[activeTab]
  const accent = AGENT_COLORS[activeTab]
  const isWorking = active.status === 'working' || active.status === 'thinking'

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Only follow the stream while the reader is already near the bottom.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [active.output, activeTab])

  useEffect(() => {
    if (prevTabRef.current === activeTab) return
    prevTabRef.current = activeTab
    setTransitioning(true)
    const timer = setTimeout(() => setTransitioning(false), 350)
    return () => clearTimeout(timer)
  }, [activeTab])

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = AGENT_ORDER.indexOf(activeTab)
    const next = AGENT_ORDER[(index + delta + AGENT_ORDER.length) % AGENT_ORDER.length]
    if (next) onSelect(next)
  }

  return (
    <div className="output-panel">
      <div
        role="tablist"
        aria-label="Agent outputs"
        onKeyDown={onTabKeyDown}
        style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: '#111827',
          flexShrink: 0,
        }}
      >
        {AGENT_ORDER.map(role => {
          const agent = agents[role]
          const color = AGENT_COLORS[role]
          const isActive = activeTab === role
          const busy = agent.status === 'working' || agent.status === 'thinking'
          return (
            <button
              key={role}
              role="tab"
              id={`tab-${role}`}
              aria-selected={isActive}
              aria-controls="agent-output-panel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(role)}
              className={busy ? 'tab-working' : ''}
              // No aria-label: the visible tab text is the accessible name, so
              // screen-reader and spoken-command users refer to the same word.
              title={AGENT_TOOLTIPS[role]}
              style={{
                flex: 1,
                padding: '10px 4px',
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                textTransform: 'capitalize',
                background: isActive ? `${color}0a` : 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${color}` : '2px solid transparent',
                color: tabColor(agent, isActive, color),
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                fontFamily: 'inherit',
              }}
            >
              {role}
              {agent.status === 'complete' && (
                <span className="check-pop" aria-hidden="true" style={{ color: '#00ff88', marginLeft: 4, display: 'inline-block' }}>
                  ✓
                </span>
              )}
              {busy && (
                <span className="dot-pulse" aria-hidden="true" style={{ color, marginLeft: 4, display: 'inline-block' }}>
                  ●
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div
        ref={scrollRef}
        id="agent-output-panel"
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        aria-live="polite"
        aria-busy={isWorking}
        tabIndex={0}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 24px',
          fontSize: 14,
          lineHeight: 1.75,
          color: '#cbd5e1',
          wordBreak: 'break-word',
          position: 'relative',
        }}
      >
        {isWorking && (
          <div
            aria-hidden="true"
            style={{
              position: 'sticky',
              top: -20,
              left: 0,
              right: 0,
              height: 2,
              marginBottom: 16,
              background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
              boxShadow: `0 0 12px ${accent}60, 0 2px 20px ${accent}30`,
              borderRadius: 1,
              animation: 'scanline 2s ease-in-out infinite',
            }}
          />
        )}

        <div
          className={`output-content ${transitioning ? 'output-enter' : ''} ${isWorking ? 'typing-cursor' : ''}`}
          style={{ minHeight: 40 }}
        >
          {active.output ? (
            <Markdown text={active.output} accent={accent} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#94a3b8', fontStyle: 'italic', fontSize: 13 }}>
              {isWorking ? (
                <>
                  <span
                    className="spinner"
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 14,
                      height: 14,
                      border: `2px solid ${accent}30`,
                      borderTopColor: accent,
                      borderRadius: '50%',
                    }}
                  />
                  <span>{active.name} is thinking...</span>
                </>
              ) : (
                <span>{active.error ?? 'Waiting for task...'}</span>
              )}
            </div>
          )}
        </div>

        {active.output && wasTruncated(active) && (
          <div style={{ marginTop: 14, fontSize: 12, color: '#ffa500' }}>
            This section was cut off before {active.name} finished.
          </div>
        )}

        <div ref={endRef} style={{ height: 1 }} />
      </div>
    </div>
  )
}
