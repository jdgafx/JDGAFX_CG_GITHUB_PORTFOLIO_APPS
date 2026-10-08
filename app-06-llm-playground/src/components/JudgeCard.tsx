import type { ReactNode } from 'react'
import { SLOTS, type CompareResponse, type JudgeVerdict, type Slot } from '../../netlify/shared/contract'
import type { JudgeView } from '../lib/run'

interface JudgeCardProps {
  judge: JudgeView
  compare: CompareResponse | null
}

export function JudgeCard({ judge, compare }: JudgeCardProps) {
  return (
    <section className="ds-section" aria-labelledby="judge-title">
      <div className="ds-section__head">
        <h2 className="ds-section__title" id="judge-title">
          AI judge
        </h2>
        <p className="ds-section__sub">One model's opinion of the three answers. It is not a measurement.</p>
      </div>
      <JudgeBody judge={judge} compare={compare} />
    </section>
  )
}

function JudgeBody({ judge, compare }: JudgeCardProps) {
  switch (judge.state) {
    case 'idle':
      return <div className="ds-empty">The judge reads the answers after a run.</div>
    case 'running':
      return (
        <p className="ds-help" aria-busy="true">
          The judge is reading the answers.
        </p>
      )
    case 'skipped':
      return <p className="ds-help">{judge.reason}</p>
    case 'failed':
      return (
        <div className="ds-notice ds-notice--error" role="alert">
          The judge did not give an opinion. {judge.step.detail}
        </div>
      )
    case 'done':
      return <Verdict verdict={judge.verdict} compare={compare} />
  }
}

// The model name after a panel, when the panel has one.
function nameTag(slot: Slot, compare: CompareResponse | null): ReactNode {
  const panel = compare?.panels.find(p => p.slot === slot)
  const name = panel ? (panel.servedModel ?? panel.requestedModel) : ''
  return name ? (
    <>
      , <span className="ds-mono">{name}</span>
    </>
  ) : null
}

function Verdict({ verdict, compare }: { verdict: JudgeVerdict; compare: CompareResponse | null }) {
  const best = verdict.bestOverall
  const answered = SLOTS.filter(slot => verdict.perPanel[slot] !== undefined)
  return (
    <div className="arena-judge">
      <p className="arena-judge__headline">
        {best === 'tie' ? (
          'Tie. The judge sees no clear winner.'
        ) : (
          <>
            Best overall: Panel {best}
            {nameTag(best, compare)}.
          </>
        )}
      </p>
      <dl className="arena-notes">
        {answered.map(slot => (
          <div key={slot}>
            <dt>
              Panel {slot}
              {nameTag(slot, compare)}
            </dt>
            <dd>{verdict.perPanel[slot]}</dd>
          </div>
        ))}
      </dl>
      {verdict.caveat && <p className="ds-help">{verdict.caveat}</p>}
      <p className="ds-help">
        Judged by{' '}
        {verdict.model ? <span className="ds-mono">{verdict.model}</span> : 'a model not reported'}.
      </p>
    </div>
  )
}
