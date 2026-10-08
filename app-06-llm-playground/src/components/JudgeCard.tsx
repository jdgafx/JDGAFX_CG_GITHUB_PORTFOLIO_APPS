import { SLOTS, type CompareResponse, type JudgeVerdict, type Slot } from '../../netlify/shared/contract'
import type { JudgeView } from '../lib/run'

interface JudgeCardProps {
  judge: JudgeView
  compare: CompareResponse | null
}

export function JudgeCard({ judge, compare }: JudgeCardProps) {
  return (
    <section className="ds-card" aria-labelledby="judge-title">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="judge-title">AI judge (opinion)</h2>
        <span className="ds-hint">One model's view, not a measurement</span>
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
      return <p className="ds-hint" aria-busy="true">The judge is reading the answers.</p>
    case 'skipped':
      return <p className="ds-hint">{judge.reason}</p>
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

function nameFor(slot: Slot, compare: CompareResponse | null): string {
  const panel = compare?.panels.find(p => p.slot === slot)
  return panel ? (panel.servedModel ?? panel.requestedModel) : ''
}

function Verdict({ verdict, compare }: { verdict: JudgeVerdict; compare: CompareResponse | null }) {
  const best = verdict.bestOverall
  const answered = SLOTS.filter(slot => verdict.perPanel[slot] !== undefined)
  const headline =
    best === 'tie'
      ? 'Tie. The judge sees no clear winner.'
      : `Best overall: Panel ${best}${nameFor(best, compare) ? `, ${nameFor(best, compare)}` : ''}.`
  return (
    <div className="arena-verdicts">
      <p>{headline}</p>
      <dl className="arena-notes">
        {answered.map(slot => (
          <div key={slot}>
            <dt>{`Panel ${slot}${nameFor(slot, compare) ? `, ${nameFor(slot, compare)}` : ''}`}</dt>
            <dd>{verdict.perPanel[slot]}</dd>
          </div>
        ))}
      </dl>
      {verdict.caveat && <p className="ds-hint">{verdict.caveat}</p>}
      <p className="ds-hint">Judged by {verdict.model ?? 'a model not reported'}.</p>
    </div>
  )
}
