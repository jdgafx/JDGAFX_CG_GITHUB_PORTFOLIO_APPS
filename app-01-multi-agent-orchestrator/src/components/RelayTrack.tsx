import type { Mark, Step } from '../lib/graphLayout'

type NodeState = 'idle' | 'active' | 'done' | 'failed' | 'skipped' | 'stopped'

const STATE: Record<Mark, NodeState> = { idle: 'idle', active: 'active', ok: 'done', warn: 'done', failed: 'failed', skipped: 'skipped', stopped: 'stopped' }

const NOTE: Record<string, string> = {
  researcher: 'finds facts',
  analyst: 'finds patterns',
  critic: 'names gaps',
  synthesizer: 'writes the report',
}

/**
 * The four agents as a relay track, built from the same steps as the run trace: node n is active while stage n runs and done when it
 * finished. The state is also the word under each node, so colour never carries it alone.
 */
export function RelayTrack({ steps }: { steps: Step[] }) {
  const agents = steps.filter(step => step.id in NOTE)
  return (
    <section className="relay-track-card" aria-label="The four agents, in order">
      <ol className="relay-track">
        {agents.map(step => (
          <li key={step.id} className="relay-node" data-relay-node data-agent={step.id} data-state={STATE[step.mark]} aria-current={step.mark === 'active' ? 'step' : undefined}>
            <span className="relay-dot" data-relay-dot aria-hidden="true" />
            <span className="relay-name">{step.title}</span>
            <span className="relay-note">({NOTE[step.id]})</span>
            <span className="relay-word">
              {step.word}
              {step.ms !== undefined ? ` · ${(step.ms / 1000).toFixed(1)} s` : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
