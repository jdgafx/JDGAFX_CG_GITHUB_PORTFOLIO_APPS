import type { ResultFrame } from '../../netlify/shared/events'
import { plural } from '../lib/format'
import { answerNotice } from '../lib/notices'
import type { Phase } from '../lib/runState'

function criticBadge(result: ResultFrame): { text: string; tone: string } {
  if (!result.critic.reviewed) return { text: 'Not reviewed', tone: 'ds-badge--warning' }
  if (result.critic.verdict === 'accept') return { text: 'Critic accepted', tone: 'ds-badge--success' }
  return { text: 'Critic asked for changes', tone: 'ds-badge--warning' }
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

interface AnswerCardProps {
  result: ResultFrame | null
  phase: Phase
}

export function AnswerCard({ result, phase }: AnswerCardProps) {
  if (!result) {
    return (
      <section className="ds-section" aria-labelledby="answer-title" aria-live="polite">
        <div className="ds-section__head">
          <h2 id="answer-title" className="ds-section__title">
            Answer
          </h2>
          <p className="ds-section__sub">The draft the critic reviewed. Bracketed numbers match the sources.</p>
        </div>
        <div className="ds-empty">
          {phase === 'running'
            ? 'Researching. The cited answer appears here when the critic is done.'
            : 'Start research to see a cited answer, with its sources, here.'}
        </div>
      </section>
    )
  }

  const badge = criticBadge(result)
  const notice = answerNotice(result)
  return (
    <section className="ds-section" aria-labelledby="answer-title" aria-live="polite">
      <div className="ds-section__head">
        <h2 id="answer-title" className="ds-section__title">
          Answer
        </h2>
        <p className="ds-section__sub">The draft the critic reviewed. Bracketed numbers match the sources.</p>
        <span className={`ds-badge answer-verdict ${badge.tone}`}>
          <span className="ds-dot" aria-hidden="true" />
          {badge.text}
        </span>
      </div>
      <div className="ds-stack">
        {notice && <p className="ds-notice">{notice}</p>}
        <div className="answer-text">
          {paragraphs(result.answer).map((part, i) => (
            <p key={i}>{part}</p>
          ))}
        </div>
        <div>
          <h3 className="answer-subhead">Sources</h3>
          {result.sources.length === 0 ? (
            <p className="ds-help">The answer cites no source.</p>
          ) : (
            <ol className="source-list">
              {result.sources.map((source) => (
                <li key={source.n} className="source-item">
                  <span className="source-n">{`[${source.n}]`}</span>
                  <span>
                    <a className="source-title" href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.title}
                    </a>
                    <span className="source-url">{source.url}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <p className="ds-help">
          {`Read ${plural(result.evidenceCount, 'page')}. Revised ${plural(result.revisions, 'time')}.`}
          {result.critic.notes ? ` Critic notes: ${result.critic.notes}` : ''}
        </p>
      </div>
    </section>
  )
}
