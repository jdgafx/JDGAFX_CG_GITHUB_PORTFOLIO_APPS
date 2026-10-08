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
      <section className="ds-card" aria-labelledby="answer-title">
        <div className="ds-card__head">
          <h2 id="answer-title" className="ds-card__title">Answer</h2>
        </div>
        <div className="ds-empty">
          {phase === 'running' ? 'Waiting for the draft and the critic.' : 'Run a question to see a cited answer here.'}
        </div>
      </section>
    )
  }

  const badge = criticBadge(result)
  const notice = answerNotice(result)
  return (
    <section className="ds-card" aria-labelledby="answer-title">
      <div className="ds-card__head">
        <h2 id="answer-title" className="ds-card__title">Answer</h2>
        <span className={`ds-badge ${badge.tone}`}>{badge.text}</span>
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
            <p className="ds-hint">The answer cites no source.</p>
          ) : (
            <ol className="source-list">
              {result.sources.map((source) => (
                <li key={source.n}>
                  <span className="source-title">{`[${source.n}] ${source.title}`}</span>
                  <br />
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.url}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>

        <p className="ds-hint">
          {`Read ${plural(result.evidenceCount, 'page')}. Revised ${plural(result.revisions, 'time')}.`}
          {result.critic.notes ? ` Critic notes: ${result.critic.notes}` : ''}
        </p>
      </div>
    </section>
  )
}
