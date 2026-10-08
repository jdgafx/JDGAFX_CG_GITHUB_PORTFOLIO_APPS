import type { KeyboardEvent } from 'react'
import { AGENT_META, AGENT_ORDER, wasTruncated } from '../lib/agents'
import type { AgentRole, AgentState, AgentStatus } from '../types'
import { Markdown } from './Markdown'

const TAB_WORD: Record<AgentStatus, string> = {
  idle: 'Waiting',
  working: 'Working',
  complete: 'Finished',
  error: 'Failed',
  skipped: 'Not run',
  stopped: 'Stopped',
}

const TAB_DOT: Record<AgentStatus, string> = {
  idle: 'ds-dot',
  working: 'ds-dot ds-dot--running',
  complete: 'ds-dot ds-dot--ok',
  error: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
  stopped: 'ds-dot app-dot--warning',
}

/** The word and dot a stage tab shows. A stage cut off mid-answer says so. */
function tabState(agent: AgentState): { word: string; dot: string } {
  if (agent.status === 'complete' && wasTruncated(agent)) return { word: 'Cut off', dot: 'ds-dot app-dot--warning' }
  return { word: TAB_WORD[agent.status], dot: TAB_DOT[agent.status] }
}

interface OutputPanelProps {
  agents: Record<AgentRole, AgentState>
  activeTab: AgentRole
  onSelect: (role: AgentRole) => void
}

/** What the report shows while a stage has no text yet. */
function EmptyState({ agent }: { agent: AgentState }) {
  const name = AGENT_META[agent.id].name
  switch (agent.status) {
    case 'working':
      return <p className="app-note">{name} is working. Its text appears when it finishes.</p>
    case 'error':
      return (
        <div className="ds-notice ds-notice--error" role="alert">
          {agent.error ?? `${name} failed.`}
        </div>
      )
    case 'idle':
      return <p className="app-note">Start research to fill this tab.</p>
    default:
      return <p className="app-note">{agent.detail}</p>
  }
}

export function OutputPanel({ agents, activeTab, onSelect }: OutputPanelProps) {
  const active = agents[activeTab]
  const hasText = active.output.trim().length > 0

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = AGENT_ORDER.indexOf(activeTab)
    const next = AGENT_ORDER[(index + step + AGENT_ORDER.length) % AGENT_ORDER.length]
    if (next) {
      onSelect(next)
      document.getElementById(`tab-${next}`)?.focus()
    }
  }

  return (
    <div>
      <div role="tablist" aria-label="Stage outputs" className="output-tabs" onKeyDown={onTabKeyDown}>
        {AGENT_ORDER.map(role => {
          const isActive = role === activeTab
          const state = tabState(agents[role])
          return (
            <button
              key={role}
              id={`tab-${role}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls="report-panel"
              tabIndex={isActive ? 0 : -1}
              className="output-tab"
              onClick={() => onSelect(role)}
            >
              <span className="output-tab__name">{AGENT_META[role].name}</span>
              <span className="output-tab__state">
                <span className={state.dot} aria-hidden="true" />
                {state.word}
              </span>
            </button>
          )
        })}
      </div>

      <div
        id="report-panel"
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        aria-busy={active.status === 'working'}
        tabIndex={0}
        className="output-body"
      >
        {hasText ? (
          <>
            <Markdown text={active.output} />
            {wasTruncated(active) && (
              <p className="app-note">This stage was cut off before {AGENT_META[activeTab].name} finished.</p>
            )}
          </>
        ) : (
          <EmptyState agent={active} />
        )}
      </div>
    </div>
  )
}
