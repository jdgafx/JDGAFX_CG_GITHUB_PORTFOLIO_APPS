import { useState, type KeyboardEvent } from 'react'
import { AGENT_META, MODEL_ORDER, statusView, wasTruncated } from '../lib/agents'
import type { AgentRole, AgentState } from '../types'
import { Markdown } from './Markdown'
import { SourceList } from './SourceList'

/** The tabs: Retrieve and the three stages that feed the report. The final report has its own card above. */
const TABS: AgentRole[] = ['retriever', ...MODEL_ORDER.filter(role => role !== 'synthesizer')]

interface StageOutputsProps {
  agents: Record<AgentRole, AgentState>
  active: AgentRole
  onSelect: (role: AgentRole) => void
}

function EmptyState({ agent }: { agent: AgentState }) {
  const name = AGENT_META[agent.id].name
  switch (agent.status) {
    case 'working':
      return <p className="app-note">{agent.id === 'retriever' ? 'Retrieve is looking up Wikipedia and Hacker News. The sources appear when it finishes.' : `${name} is working. Its text appears when it finishes.`}</p>
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

/** What each step before the report produced, one tab per step. */
/** Open at start on a wide screen; folded on a phone, where it is the longest block on the page. */
const openAtStart = () => window.matchMedia('(min-width: 1000px)').matches

export function StageOutputs({ agents, active, onSelect }: StageOutputsProps) {
  const [open, setOpen] = useState(openAtStart)
  const current = agents[TABS.includes(active) ? active : 'retriever']
  const sources = agents.retriever.sources ?? []
  const hasText = current.output.trim().length > 0
  const showSources = current.id === 'retriever' && sources.length > 0

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = TABS[(TABS.indexOf(current.id) + step + TABS.length) % TABS.length]
    if (next) {
      onSelect(next)
      document.getElementById(`tab-${next}`)?.focus()
    }
  }

  return (
    <section className="ds-section ds-run__trace" aria-label="Stage outputs">
      <details className="ds-disclosure stage-fold" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>Stage outputs</summary>
        <div className="stage-fold__body">
          <p className="ds-section__sub">What each step before the report produced. Each tab fills when its step finishes.</p>
          <div className="ds-seg stage-tabs" role="tablist" aria-label="Stage outputs" onKeyDown={onKeyDown}>
            {TABS.map(role => {
              const view = statusView(agents[role])
              return (
                <button key={role} id={`tab-${role}`} type="button" role="tab" aria-selected={role === current.id} aria-controls="stage-panel" tabIndex={role === current.id ? 0 : -1} onClick={() => onSelect(role)}>
                  {AGENT_META[role].name}
                  <span className="stage-tabs__state">
                    <span className={view.dot} aria-hidden="true" />
                    {view.word}
                  </span>
                </button>
              )
            })}
          </div>
          <div id="stage-panel" role="tabpanel" aria-labelledby={`tab-${current.id}`} aria-busy={current.status === 'working'} tabIndex={0} className="stage-panel">
            {showSources ? (
              <>
                <p className="app-note">{current.detail} The Researcher cites them as [1], [2] and so on.</p>
                <SourceList sources={sources} />
              </>
            ) : hasText ? (
              <>
                <Markdown text={current.output} sources={sources} />
                {wasTruncated(current) && <p className="app-note">This stage was cut off before {AGENT_META[current.id].name} finished.</p>}
              </>
            ) : (
              <EmptyState agent={current} />
            )}
          </div>
        </div>
      </details>
    </section>
  )
}
