import type { ResultFrame } from '../../netlify/shared/events'
import { plural } from '../lib/format'
import { parseInline } from '../lib/markdown'
import type { Phase } from '../lib/runState'

function badgeFor(result: ResultFrame): { text: string; tone: string } {
  if (result.ending.kind === 'no_answer') return { text: 'No answer written', tone: 'ds-badge--warning' }
  if (!result.critic.reviewed) return { text: 'Not reviewed', tone: 'ds-badge--warning' }
  if (result.critic.verdict === 'accept') return { text: 'Critic accepted', tone: 'ds-badge--success' }
  return { text: 'Critic asked for changes', tone: 'ds-badge--warning' }
}

function Inline({ line }: { line: string }) {
  return (
    <>
      {parseInline(line).map((part, i) => {
        if (part.kind === 'em') return <em key={i}>{part.text}</em>
        if (part.kind === 'strong') return <strong key={i}>{part.text}</strong>
        if (part.kind === 'code') return <code key={i}>{part.text}</code>
        return part.text
      })}
    </>
  )
}

function paragraphs(text: string): string[] {
  return text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** The host and path of a source, without the scheme, so a citation row stays short. */
function shownUrl(url: string): string {
  return decodeURI(url.replace(/^https?:\/\//, ''))
}

interface StateProps {
  tone: 'empty' | 'loading' | 'error' | 'stopped'
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}

function AnswerState({ tone, title, body, action }: StateProps) {
  return (
    <div className={`ds-state ds-state--${tone}`}>
      <span className="ds-state__mark" aria-hidden="true" />
      <p className="ds-state__title" tabIndex={-1} data-result-focus>
        {title}
      </p>
      <p className="ds-state__body">{body}</p>
      {tone === 'loading' && (
        <div className="ds-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {action && (
        <div className="ds-state__actions">
          <button type="button" className="ds-button" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  )
}

interface AnswerCardProps {
  result: ResultFrame | null
  phase: Phase
  error: string | null
  hasSteps: boolean
  onRetry: () => void
}

/** The answer is the page's lead: once a run has ended it comes first, whatever the outcome. */
export function AnswerCard({ result, phase, error, hasSteps, onRetry }: AnswerCardProps) {
  if (!result) {
    return (
      <section className="ds-section ds-run__result" aria-label="Answer" aria-live="polite">
        {phase === 'running' ? (
          <AnswerState
            tone="loading"
            title="Researching"
            body="The cited answer appears here when the critic is done."
          />
        ) : phase === 'failed' ? (
          <AnswerState
            tone="error"
            title="The run failed"
            body={`${error ?? 'No answer was written.'} ${hasSteps ? 'The steps that ran are in the trace.' : 'No step had started.'}`}
            action={{ label: 'Try again', onClick: onRetry }}
          />
        ) : phase === 'stopped' ? (
          <AnswerState
            tone="stopped"
            title="Run stopped"
            body={`You stopped it before an answer was written. ${hasSteps ? 'The steps that finished stay in the trace.' : 'No step had finished.'}`}
            action={{ label: 'Start again', onClick: onRetry }}
          />
        ) : (
          <AnswerState
            tone="empty"
            title="No answer yet"
            body="Start research to see a cited answer, with its sources, here."
          />
        )}
      </section>
    )
  }

  const badge = badgeFor(result)
  const noAnswer = result.ending.kind === 'no_answer'
  return (
    <section className="ds-section ds-run__result" aria-label="Answer" aria-live="polite">
      <div className="ds-lead">
        <div className="ds-lead__meta">
          <h2 className="ds-section__title" tabIndex={-1} data-result-focus>
            {noAnswer ? 'Pages read' : 'Answer'}
          </h2>
          <span className={`ds-badge ${badge.tone}`}>
            <span className="ds-dot" aria-hidden="true" />
            {badge.text}
          </span>
        </div>
        {result.ending.kind !== 'complete' && (
          <div className="ds-state ds-state--partial">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">{noAnswer ? 'No answer written' : 'Partial answer'}</p>
            <p className="ds-state__body">{result.ending.message}</p>
          </div>
        )}
        {result.truncated && <p className="ds-notice">The answer was cut short at its length limit.</p>}
        {!noAnswer && (
          <div className="ds-lead__text">
            {paragraphs(result.answer).map((part, i) => (
              <p key={i}>
                <Inline line={part} />
              </p>
            ))}
          </div>
        )}
        {result.sources.length === 0 ? (
          <p className="ds-help">The answer cites no source.</p>
        ) : (
          <ol className="ds-cite" aria-label="Sources">
            {result.sources.map((source) => (
              <li key={source.n}>
                <span className="ds-cite__n">{`[${source.n}]`}</span>
                <a className="ds-cite__title" href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
                <span className="ds-cite__url">{shownUrl(source.url)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="ds-lead__foot">
          {`Read ${plural(result.evidenceCount, 'page')}. Revised ${plural(result.revisions, 'time')}.`}
          {result.critic.reviewed && result.critic.notes ? ` Critic notes: ${result.critic.notes}` : ''}
        </p>
      </div>
    </section>
  )
}
