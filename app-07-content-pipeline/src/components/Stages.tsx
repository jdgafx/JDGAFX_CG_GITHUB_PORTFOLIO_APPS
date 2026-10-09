import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { STAGE_LABELS, type StageId, type StageOutputs } from '../../netlify/shared/contract'
import type { StageView } from '../lib/run'
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

interface StagesProps {
  outputs: StageOutputs
  views: StageView[]
  // True before any run has started, so the page can invite the first action.
  idle: boolean
  copyNote: string
  onCopy: (label: string, text: string) => void
}

export default function Stages({ outputs, views, idle, copyNote, onCopy }: StagesProps) {
  const finalPiece = outputs.polish

  return (
    <section className="ds-section" aria-labelledby="stages-title">
      <div className="ds-section__head ds-section__head--row">
        <div className="section-title-block">
          <h2 className="ds-section__title" id="stages-title">Stage outputs</h2>
          <p className="ds-section__sub">What each stage produced, as it finishes. The final piece ends with its Sources list. Copy one stage, or the final piece.</p>
        </div>
        <button
          type="button"
          className="ds-button"
          disabled={!finalPiece}
          onClick={() => {
            if (finalPiece) onCopy('Final piece', finalPiece)
          }}
        >
          Copy final piece
        </button>
      </div>

      {idle ? (
        <div className="ds-empty">Press Generate to write the piece. Each stage&apos;s output appears here as it finishes.</div>
      ) : (
        <ol className="stage-list" aria-label="Stage outputs">
          {views.map(view => {
            const label = STAGE_LABELS[view.stage]
            const text = outputs[view.stage]

            return (
              <li key={view.stage} className="stage-item">
                <div className="stage-head">
                  <div className="stage-title">
                    <h3 className="stage-name">{label}</h3>
                    <p className="ds-help">{STAGE_HINTS[view.stage]}</p>
                  </div>
                  <StateMark state={view.state} />
                </div>

                {text !== undefined && (
                  <>
                    <details open>
                      <summary>Output, {view.amount} {view.unit}</summary>
                      {view.stage === 'sources' ? (
                        <SourceList text={text} />
                      ) : (
                        <div className="stage-output">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                        </div>
                      )}
                    </details>
                    <div className="ds-row">
                      <button
                        type="button"
                        className="ds-button"
                        aria-label={`Copy ${label} output`}
                        onClick={() => onCopy(`${label} output`, text)}
                      >
                        Copy
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <p className="ds-help" aria-live="polite">{copyNote}</p>
    </section>
  )
}
