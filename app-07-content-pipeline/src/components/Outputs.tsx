import { STAGE_LABELS, type StageId, type StageOutputs } from '../../netlify/shared/contract'
import type { StageView } from '../lib/run'
import Prose from './Prose'
import SourceList from './SourceList'
import StateMark from './StateMark'

const STAGE_HINTS: Record<StageId, string> = {
  sources: 'Live Wikipedia articles and Hacker News stories, numbered for citation',
  research: 'Notes drawn from the numbered sources',
  outline: 'Section headings with bullet points under each',
  draft: 'The first full version, built from the research and outline',
  edit: 'Grammar, flow and argument in the draft',
  polish: 'A final pass on the prose, opening and conclusion',
}

interface OutputsProps {
  outputs: StageOutputs
  views: StageView[]
  onCopy: (label: string, text: string) => void
}

// Every stage's own output, for checking the piece against what it was built from.
export default function Outputs({ outputs, views, onCopy }: OutputsProps) {
  const shown = views.filter(view => outputs[view.stage] !== undefined || view.state === 'running')
  if (shown.length === 0) return null
  return (
    <section className="ds-section" aria-labelledby="stages-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="stages-title">Stage outputs</h2>
      </div>
      <ol className="stage-list" aria-label="Stage outputs">
        {shown.map(view => {
          const label = STAGE_LABELS[view.stage]
          const text = outputs[view.stage]
          return (
            <li key={view.stage} className="stage-item">
              <details>
                <summary>
                  <span className="stage-name">{label}</span>
                  <span className="ds-help">{view.state === 'running' ? 'Running now' : `${view.amount} ${view.unit}. ${STAGE_HINTS[view.stage]}`}</span>
                  <StateMark state={view.state} />
                </summary>
                {text !== undefined && (
                  <>
                    {view.stage === 'sources' ? <SourceList text={text} /> : <Prose text={text} />}
                    <div className="ds-row">
                      <button type="button" className="ds-button ds-button--quiet" aria-label={`Copy ${label} output`} onClick={() => onCopy(`${label} output`, text)}>Copy</button>
                    </div>
                  </>
                )}
              </details>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
