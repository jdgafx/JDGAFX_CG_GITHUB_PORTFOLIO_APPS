import { STAGE_LABELS, type StageId } from '../lib/api'
import type { StageView } from '../lib/run'
import StateMark from './StateMark'

// What each stage starts from. The chain's edges carry these hand-offs from one stage to the next.
const HANDOFF: Record<StageId, string> = {
  research: 'From the topic',
  outline: 'From research',
  draft: 'From research and outline',
  edit: 'From outline and draft',
  polish: 'From the edit',
}

interface PipelineProps {
  views: StageView[]
}

export default function Pipeline({ views }: PipelineProps) {
  return (
    <section className="ds-section" aria-labelledby="pipeline-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="pipeline-title">Pipeline</h2>
        <p className="ds-section__sub">
          Five stages run in order, one model call each. A highlighted edge means that stage finished and passed its output on.
        </p>
      </div>
      <div className="ds-panel">
        <ol className="ds-chain" aria-label="Pipeline stages">
          {views.map(view => (
            <li
              key={view.stage}
              className={`ds-chain__stage ds-chain__stage--${view.state}`}
              aria-current={view.state === 'running' ? 'step' : undefined}
            >
              <p className="ds-chain__name">{STAGE_LABELS[view.stage]}</p>
              <p className="ds-chain__state"><StateMark state={view.state} /></p>
              <p className="ds-chain__count">
                <span className="ds-chain__figure ds-num">{view.words}</span> words
              </p>
              <p className="ds-chain__from">{HANDOFF[view.stage]}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
