import { COMPARE_MAX_TOKENS, type BlindAnswer, type BlindCompareResponse, type VoteChoice } from '../../netlify/shared/contract'
import type { VoteView } from '../lib/run'
import { Prose } from './Prose'

interface BlindAnswersProps {
  blind: BlindCompareResponse
  vote: VoteView
  onVote: (choice: VoteChoice) => void
}

function answerState(answer: BlindAnswer): { label: string; dot: string } {
  if (!answer.ok) return { label: 'Failed', dot: 'ds-dot--failed' }
  if (answer.finishReason === 'length') return { label: `Capped at ${COMPARE_MAX_TOKENS} tokens`, dot: 'arena-dot--warn' }
  return { label: 'Complete', dot: 'ds-dot--ok' }
}

// The answers with the models withheld. Nothing here names a model or carries a figure that could.
export function BlindAnswers({ blind, vote, onVote }: BlindAnswersProps) {
  const sending = vote.state === 'sending'
  const dead = vote.state === 'failed' && vote.final
  const answered = blind.answers.filter(a => a.ok).length
  return (
    <div className="arena-blind">
      <div className="arena-grid">
        {blind.answers.map(answer => {
          const state = answerState(answer)
          const id = `blind-${answer.label}`
          return (
            <article className="ds-panel arena-panel" aria-labelledby={`${id}-title`} key={answer.label}>
              <div className="arena-panel__head">
                <span className="arena-letter" aria-hidden="true">{answer.label}</span>
                <div className="arena-panel__id">
                  <h3 className="arena-panel__title" id={`${id}-title`}>Panel {answer.label}</h3>
                  <p className="arena-name arena-name--hidden">
                    <span className="arena-name__model" aria-label="Model hidden until you vote">
                      <span className="arena-mask" aria-hidden="true" />
                    </span>
                    <span className="arena-name__meta">Hidden until you vote</span>
                  </p>
                </div>
                <span className="ds-badge">
                  <span className={`ds-dot ${state.dot}`} aria-hidden="true" />
                  {state.label}
                </span>
              </div>
              {answer.error && (
                <div className="ds-notice ds-notice--error" role="alert">{answer.error}</div>
              )}
              {answer.text ? (
                <div className="arena-answer" tabIndex={0} role="region" aria-label={`Panel ${answer.label} answer`}>
                  <Prose text={answer.text} />
                </div>
              ) : (
                <p className="ds-help arena-placeholder">No answer text was returned. It cannot be picked.</p>
              )}
              <button
                type="button"
                className="ds-button arena-pick"
                disabled={!answer.ok || sending || dead}
                onClick={() => onVote(answer.label)}
                aria-busy={sending && vote.choice === answer.label}
              >
                {sending && vote.choice === answer.label ? 'Counting your vote' : `Panel ${answer.label} is best`}
              </button>
            </article>
          )
        })}
      </div>
      <div className="arena-votebar" role="group" aria-label="Other votes">
        <p className="arena-votebar__q">
          {answered < blind.answers.length ? 'Not every panel answered. Pick among the rest, or' : 'No clear best?'}
        </p>
        <div className="ds-row">
          <button type="button" className="ds-button" disabled={sending || dead} onClick={() => onVote('tie')}>
            It is a tie
          </button>
          <button type="button" className="ds-button" disabled={sending || dead} onClick={() => onVote('all-bad')}>
            All answers are bad
          </button>
        </div>
        <p className="ds-help">
          A tie draws every pair. "All answers are bad" is counted as a ballot but moves no rating. One vote per comparison.
        </p>
      </div>
      {vote.state === 'failed' && (
        <div className="ds-state ds-state--error" role="alert">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">{vote.final ? 'This vote cannot be counted' : 'Your vote was not counted'}</p>
          <p className="ds-state__body">{vote.message}</p>
        </div>
      )}
    </div>
  )
}
