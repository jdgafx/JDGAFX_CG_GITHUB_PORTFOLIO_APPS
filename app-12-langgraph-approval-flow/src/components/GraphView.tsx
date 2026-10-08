import type { NodeName } from '../types'
import type { NodeStatus, RunView } from '../lib/run-state'

const STATE_TEXT: Record<NodeStatus, string> = {
  idle: 'not started',
  running: 'running',
  waiting: 'waiting for a person',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

function NodeChip({ name, status }: { name: NodeName; status: NodeStatus }) {
  return (
    <li className={`gg-node gg-node--${status}`}>
      <span className="gg-node__name">{name}</span>
      <span className="gg-node__state">{STATE_TEXT[status]}</span>
    </li>
  )
}

function Edge({ taken, label }: { taken: boolean; label?: string }) {
  return (
    <li className={`gg-edge${taken ? ' gg-edge--taken' : ''}`}>
      <span className="gg-edge__line" aria-hidden="true" />
      {label ? <span className="gg-edge__label">{label}</span> : null}
      <span className="visually-hidden">{taken ? 'taken' : 'not taken'}</span>
    </li>
  )
}

function Terminal({ name }: { name: string }) {
  return <li className="gg-terminal">{name}</li>
}

/** The graph as the run has walked it. Taken edges are highlighted, and both decide edges carry their labels. */
export function GraphView({ run }: { run: RunView }) {
  const taken = (key: string) => key in run.taken
  return (
    <section className="ds-card" aria-labelledby="graph-heading">
      <div className="ds-card__head">
        <h2 id="graph-heading" className="ds-card__title">Graph</h2>
        <span className="ds-hint">Each step is a node. Decide has two conditional edges.</span>
      </div>

      <ol className="gg-flow" aria-label="Graph path">
        <Terminal name="START" />
        <Edge taken />
        <NodeChip name="intake" status={run.nodes.intake} />
        <Edge taken={taken('intake>policy')} />
        <NodeChip name="policy" status={run.nodes.policy} />
        <Edge taken={taken('policy>decide')} />
        <NodeChip name="decide" status={run.nodes.decide} />
        <Edge taken={taken('decide>review')} label="requiresHuman" />
        <NodeChip name="review" status={run.nodes.review} />
        <Edge taken={taken('review>reply')} />
        <NodeChip name="reply" status={run.nodes.reply} />
        <Edge taken />
        <Terminal name="END" />
      </ol>

      <ol className="gg-flow gg-flow--bypass" aria-label="Automatic branch from decide">
        <NodeChip name="decide" status={run.nodes.decide} />
        <Edge taken={taken('decide>reply')} label="otherwise" />
        <NodeChip name="reply" status={run.nodes.reply} />
      </ol>
    </section>
  )
}
