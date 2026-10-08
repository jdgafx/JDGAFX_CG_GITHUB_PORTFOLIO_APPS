import type { RunView, Status, StageName } from '../lib/view'

const STATE_WORD: Record<Status, string> = {
  idle: 'waiting',
  running: 'running',
  ok: 'done',
  failed: 'failed',
}

const STAGE_LABEL: Record<StageName, string> = {
  split: 'Split',
  reduce: 'Reduce',
  synthesize: 'Synthesize',
  check: 'Check',
  final: 'Final',
}

function StageNode({ name, status }: { name: StageName; status: Status }) {
  return (
    <li className={`graph-node is-${status}`}>
      <span className="graph-node__name">{STAGE_LABEL[name]}</span>
      <span className="graph-node__state">{STATE_WORD[status]}</span>
    </li>
  )
}

function Arrow() {
  return (
    <li className="graph-arrow" aria-hidden="true">
      &rarr;
    </li>
  )
}

export function GraphView({ view }: { view: RunView }) {
  const fan = view.edges.find((e) => e.startsWith('fan out')) ?? 'Waiting for a run'
  const finish = view.edges.find((e) => e.startsWith('coverage') || e.includes('still missing'))
  return (
    <section className="ds-card" aria-labelledby="graph-title">
      <div className="ds-card__head">
        <h2 id="graph-title" className="ds-card__title">
          Graph
        </h2>
        <span className="ds-hint">{fan}</span>
      </div>
      <ol className="graph-row" aria-label="Graph nodes in run order">
        <StageNode name="split" status={view.stages.split} />
        <Arrow />
        <li className="graph-fan">
          <p className="graph-fan__title">extract, parallel, at most 4 calls at once</p>
          {view.branches.length === 0 ? (
            <p className="ds-hint">One branch per chunk appears here.</p>
          ) : (
            <ul className="graph-branches" aria-label="Extract branches">
              {view.branches.map((b) => (
                <li key={b.chunk} className={`graph-branch is-${b.status}`}>
                  <span>chunk {b.chunk}</span>
                  <span className="graph-branch__state">
                    {STATE_WORD[b.status]}
                    {b.attempts > 1 ? ', retried' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
        <Arrow />
        <StageNode name="reduce" status={view.stages.reduce} />
        <Arrow />
        <StageNode name="synthesize" status={view.stages.synthesize} />
        <Arrow />
        <StageNode name="check" status={view.stages.check} />
        <Arrow />
        <StageNode name="final" status={view.stages.final} />
      </ol>
      {view.retryLabel ? (
        <div className="graph-loop" role="note">
          <span className="graph-loop__label">Loop: check to extract, {view.retryLabel}</span>
          <span className="graph-loop__note">the loop runs once, then the run finishes</span>
        </div>
      ) : null}
      {finish ? <p className="graph-finish ds-hint">Exit: {finish}</p> : null}
    </section>
  )
}
