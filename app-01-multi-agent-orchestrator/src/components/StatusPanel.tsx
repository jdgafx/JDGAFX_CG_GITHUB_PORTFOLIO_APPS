import { AGENT_ACTIVITY, AGENT_COLORS, AGENT_ORDER } from '../lib/agents'
import type { AgentRole, AgentState } from '../types'

interface StatusPanelProps {
  agents: Record<AgentRole, AgentState>
  activeTab: AgentRole
  isRunning: boolean
  isComplete: boolean
}

function activityText(agent: AgentState, role: AgentRole): string {
  if (agent.status === 'complete') return AGENT_ACTIVITY[role].complete
  if (agent.status === 'idle') return AGENT_ACTIVITY[role].idle
  if (agent.status === 'error') return `${agent.name} could not finish. See the message below.`
  if (agent.status === 'stopped') return `${agent.name} was stopped before it finished.`
  return AGENT_ACTIVITY[role].working
}

export function StatusPanel({ agents, activeTab, isRunning, isComplete }: StatusPanelProps) {
  const accent = isRunning ? '#00d4ff' : isComplete ? '#00ff88' : '#ffa500'
  const active = agents[activeTab]

  return (
    <div
      style={{
        margin: '0 16px 16px',
        padding: '12px 18px',
        borderRadius: 14,
        background: 'rgba(17,24,39,0.92)',
        border: `1px solid ${accent}33`,
        boxShadow: `0 0 30px ${accent}14`,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div
          className={isRunning ? 'agent-active' : ''}
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: accent,
            boxShadow: `0 0 8px ${accent}`,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>
          {isComplete ? 'Pipeline Complete' : isRunning ? active.name : 'Pipeline Stopped'}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.55 }}>
        {isComplete ? AGENT_ACTIVITY.synthesizer.complete : activityText(active, activeTab)}
      </p>

      {isRunning && (
        <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
          {AGENT_ORDER.map(role => {
            const color = AGENT_COLORS[role]
            const status = agents[role].status
            const isWorking = status === 'working' || status === 'thinking'
            const isDone = status === 'complete'
            return (
              <div
                key={role}
                title={`${agents[role].name}: ${status}`}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.06)',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  className={isWorking ? 'progress-fill-active' : ''}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 2,
                    background: isDone ? '#00ff88' : isWorking ? `linear-gradient(90deg, ${color}, ${color}aa)` : 'transparent',
                    boxShadow: isDone ? '0 0 6px #00ff8880' : isWorking ? `0 0 8px ${color}60` : 'none',
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: isDone || isWorking ? 'scaleX(1)' : 'scaleX(0)',
                    transformOrigin: 'left',
                  }}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
