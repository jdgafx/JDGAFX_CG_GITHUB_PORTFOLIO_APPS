import type { TraceStep } from '../lib/api'
import type { InsightRun } from '../lib/insightRun'
import { parseInline } from '../lib/markdown'
import { markFigures } from '../lib/markFigures'

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
function Inline({ line, missing }: { line: string; missing: string[] }) {
  // A figure the check rejected is underlined where it is written, with the reason in its title.
  const flag = (text: string) =>
    markFigures(text, missing).map((part, i) =>
      part.flagged ? (
        <mark key={i} className="hub-unmatched" title="Not in the evidence">
          {part.text}
        </mark>
      ) : (
        part.text
      ),
    )
  return (
    <>
      {parseInline(line).map((piece, i) =>
        piece.kind === 'text' ? <span key={i}>{flag(piece.text)}</span> : piece.kind === 'strong' ? <strong key={i}>{flag(piece.text)}</strong> : piece.kind === 'em' ? <em key={i}>{flag(piece.text)}</em> : <code key={i}>{piece.text}</code>,
      )}
    </>
  )
}

const paragraphs = (text: string): string[] =>
  text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')

/** What the figure check came to: the counts the server worked out, or, for an older reply, the counts in its text. */
function figureResult(step: TraceStep): { text: string; failed: boolean; rejected: string[]; titles: string[]; unchecked: string[] } {
  const failed = step.status === 'failed'
  if (step.check) {
    const { matched, checked, rejected, unchecked } = step.check
    return {
      text: `${matched} of ${checked} figures match the evidence`,
      failed,
      rejected: rejected.map((r) => r.figure),
      titles: rejected.map((r) => r.quote),
      unchecked,
    }
  }
  const match = step.status === 'skipped' ? null : COUNT_LINE.exec(step.detail)
  return {
    text: match ? `${match[1]} of ${match[2]} figures match the evidence` : step.detail,
    failed,
    rejected: match?.[3]?.split(', ') ?? [],
    titles: [],
    unchecked: [],
  }
}

/** What the figure check found, as a badge, with the figures that did not match listed beside it and the unchecked ones noted. */
function CheckBadge({ result }: { result: ReturnType<typeof figureResult> }) {
  return (
    <>
      <span className={`ds-badge ${result.failed ? 'ds-badge--warning' : 'ds-badge--success'}`}>
        <span className={`ds-dot ${result.failed ? 'ds-dot--stopped' : 'ds-dot--ok'}`} aria-hidden="true" />
        {result.text}
      </span>
      {result.rejected.length > 0 && (
        <span className="hub-missing">
          Not in the evidence:{' '}
          {result.rejected.map((figure, i) => (
            <span key={`${figure}-${i}`} className="ds-chip" title={result.titles[i]}>
              {figure}
            </span>
          ))}
        </span>
      )}
      {result.unchecked.length > 0 && (
        <span className="hub-unchecked ds-help" title={result.unchecked.join(', ')}>
          {result.unchecked.length} {result.unchecked.length === 1 ? 'figure' : 'figures'} unchecked
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
  const missing = check && check.status !== 'skipped' ? figureResult(check).rejected : []

  const card = (live: boolean) => (
    <article className="ds-lead" aria-live="polite" aria-busy={live}>
      <div className="ds-lead__meta">
        <h2 className="hub-result-title" tabIndex={-1} data-result-focus>
          Explanation
        </h2>
        {check ? (
          <CheckBadge result={figureResult(check)} />
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
            <Inline line={part} missing={missing} />
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
