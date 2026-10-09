import type { TraceStep } from '../lib/api'
import type { InsightRun } from '../lib/insightRun'
import { parseInline } from '../lib/markdown'

// The server's own wording, for example "2 of 3 figures match the summary" or "1 of 1 figure matches the summary and spike evidence".
const COUNT_LINE = /^(\d+) of (\d+) figures? match(?:es)? the summary(?: and spike evidence)?(?:\. Not in the summary: ([\s\S]*))?$/

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

/** One line of model text: emphasis, strong and code become elements; nothing else is interpreted, so no markers or markup show. */
function Inline({ line }: { line: string }) {
  return (
    <>
      {parseInline(line).map((piece, i) =>
        piece.kind === 'text' ? piece.text : piece.kind === 'strong' ? <strong key={i}>{piece.text}</strong> : piece.kind === 'em' ? <em key={i}>{piece.text}</em> : <code key={i}>{piece.text}</code>,
      )}
    </>
  )
}

const paragraphs = (text: string): string[] =>
  text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')

/** What the figure check found, as a badge, with the figures it could not find listed beside it. */
function CheckBadge({ step }: { step: TraceStep }) {
  const match = step.status === 'skipped' ? null : COUNT_LINE.exec(step.detail)
  const failed = step.status === 'failed'
  const missing = match?.[3]?.split(', ') ?? []
  return (
    <>
      <span className={`ds-badge ${failed ? 'ds-badge--warning' : 'ds-badge--success'}`}>
        <span className={`ds-dot ${failed ? 'ds-dot--stopped' : 'ds-dot--ok'}`} aria-hidden="true" />
        {match ? `${match[1]} of ${match[2]} figures match the evidence` : step.detail}
      </span>
      {missing.length > 0 && (
        <span className="hub-missing">
          Not in the evidence:{' '}
          {missing.map((figure) => (
            <span key={figure} className="ds-chip">
              {figure}
            </span>
          ))}
        </span>
      )}
    </>
  )
}

interface AnswerCardProps {
  run: InsightRun
  ready: boolean
  onStart: () => void
}

/** The explanation is the one editorial block: the model's words, with the result of the figure check above them. */
export default function AnswerCard({ run, ready, onStart }: AnswerCardProps) {
  const { status, answer, steps, errorMessage } = run
  const check = steps.find((step) => step.name === 'Check figures')
  const retry = onStart

  const card = (live: boolean) => (
    <article className="ds-lead" aria-live="polite" aria-busy={live}>
      <div className="ds-lead__meta">
        <h2 className="hub-result-title" tabIndex={-1} data-result-focus>
          Explanation
        </h2>
        {check ? (
          <CheckBadge step={check} />
        ) : (
          <span className="ds-badge">
            <span className={`ds-dot ${live ? 'ds-dot--running' : 'ds-dot--skipped'}`} aria-hidden="true" />
            {live ? 'The check runs when the text is complete' : 'Not checked: the run stopped first'}
          </span>
        )}
      </div>
      <div className="ds-lead__text">
        {paragraphs(answer).map((part, i) => (
          <p key={i}>
            <Inline line={part} />
          </p>
        ))}
      </div>
      <p className="ds-lead__foot">
        The check tests percentages, download counts, multiples, dates and versions against the figures and spike evidence
        the model was given. It does not judge whether the conclusions are right.
      </p>
    </article>
  )

  return (
    <section className="ds-run__result" aria-label="Explanation">
      {status === 'idle' && (
        <AnswerState
          tone="empty"
          title="No explanation yet"
          body={
            ready
              ? 'Explain spikes sends the figures and the marked days to the model. Its text appears here, with a check of every number, date and version it quotes.'
              : 'The explanation unlocks when the downloads and the release history have loaded.'
          }
        />
      )}
      {status === 'running' &&
        (answer ? (
          card(true)
        ) : (
          <AnswerState tone="loading" title="Explaining" body="The model is reading the figures and the unusual days. Its text streams in here." />
        ))}
      {status === 'done' && card(false)}
      {status === 'failed' && (
        <AnswerState tone="error" title="The explanation failed" body={`${errorMessage} The steps that ran are in the trace.`} action={{ label: 'Try again', onClick: retry }} />
      )}
      {status === 'stopped' && (
        <div className="ds-stack">
          <AnswerState
            tone="stopped"
            title="Stopped"
            body={answer ? 'You stopped the run. The text below arrived before you stopped.' : 'You stopped the run before any text arrived.'}
            action={{ label: 'Start again', onClick: retry }}
          />
          {answer && card(false)}
        </div>
      )}
    </section>
  )
}
