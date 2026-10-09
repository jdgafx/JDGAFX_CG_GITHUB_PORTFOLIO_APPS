import type { KeyboardEvent } from 'react'
import { AGENT_META, AGENT_ORDER, statusView, wasTruncated } from '../lib/agents'
import type { AgentRole, AgentState } from '../types'
import { Markdown } from './Markdown'
import { SourceList } from './SourceList'

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
      return agent.id === 'retriever' ? (
        <p className="app-note">Retrieve is looking up Wikipedia and Hacker News. The sources appear when it finishes.</p>
      ) : (
        <p className="app-note">{name} is working. Its text appears when it finishes.</p>
      )
    case 'error':
      return (
        <div className="ds-notice ds-notice--error" role="alert">
          {agent.error ?? `${name} failed.`}
        </div>
      )
    case 'idle':
      return <p className="app-note">{agent.id === 'retriever' ? 'Start research to fetch sources.' : 'Start research to fill this tab.'}</p>
    default:
      return <p className="app-note">{agent.detail}</p>
  }
}

export function OutputPanel({ agents, activeTab, onSelect }: OutputPanelProps) {
  const active = agents[activeTab]
  const sources = agents.retriever.sources ?? []
  const hasText = active.output.trim().length > 0
  const showSources = activeTab === 'retriever' && sources.length > 0

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
          const state = statusView(agents[role])
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
        {showSources ? (
          <>
            <p className="app-note">{active.detail} The Researcher cites them as [1], [2] and so on.</p>
            <SourceList sources={sources} />
          </>
        ) : hasText ? (
          <>
            <Markdown text={active.output} sources={sources} />
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
