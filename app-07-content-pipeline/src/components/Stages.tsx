import { STAGE_IDS, STAGE_LABELS, type StageId, type StageOutputs } from '../lib/api'
import { wordCount } from '../lib/run'

const STAGE_HINTS: Record<StageId, string> = {
  research: 'Facts, figures and background on the topic',
  outline: 'Section headings with bullet points under each',
  draft: 'The first full version, built from the research and outline',
  edit: 'Grammar, flow and argument in the draft',
  polish: 'A final pass on the prose, opening and conclusion',
}

type StageState = 'done' | 'running' | 'failed' | 'waiting'

const BADGE_TONE: Record<StageState, string> = {
  done: 'ds-badge--success',
  running: 'ds-badge--accent',
  failed: 'ds-badge--danger',
  waiting: '',
}

const BADGE_TEXT: Record<StageState, string> = {
  done: 'Done',
  running: 'Running',
  failed: 'Failed',
  waiting: 'Waiting',
}

interface StagesProps {
  outputs: StageOutputs
  runningStage: StageId | null
  failedStage: StageId | null
  copyNote: string
  onCopy: (label: string, text: string) => void
}

export default function Stages({ outputs, runningStage, failedStage, copyNote, onCopy }: StagesProps) {
  const finalPiece = outputs.polish

  return (
    <section className="ds-card" aria-labelledby="stages-title">
      <div className="ds-card__head">
        <h2 className="ds-card__title" id="stages-title">Stages</h2>
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

      <ol className="stage-list" aria-label="Stage outputs">
        {STAGE_IDS.map(stage => {
          const label = STAGE_LABELS[stage]
          const text = outputs[stage]
          const state: StageState = text !== undefined
            ? 'done'
            : runningStage === stage
              ? 'running'
              : failedStage === stage
                ? 'failed'
                : 'waiting'

          return (
            <li key={stage} className="stage-item">
              <div className="stage-head">
                <div className="stage-title">
                  <h3 className="ds-card__title">{label}</h3>
                  <span className="ds-hint">{STAGE_HINTS[stage]}</span>
                </div>
                <span className={`ds-badge ${BADGE_TONE[state]}`}>{BADGE_TEXT[state]}</span>
              </div>

              {text !== undefined && (
                <>
                  <details open>
                    <summary>Output, {wordCount(text)} words</summary>
                    <p className="stage-output">{text}</p>
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

      <p className="ds-hint" aria-live="polite">{copyNote}</p>
    </section>
  )
}
