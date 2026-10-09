import { useState } from 'react'
import type { ResultFrame } from '../../netlify/shared/events'
import { countParts, diffWords, sameAnswer, sourceDelta } from '../lib/fork'
import { count, milliseconds, plural } from '../lib/format'
import type { RunView } from '../lib/runState'

interface Props {
  original: ResultFrame
  fork: RunView
  onBack: () => void
}

/** The diff compares words, so emphasis marks the model wrote are dropped and cannot show as changes. */
const plainText = (text: string) => text.replace(/[*`]/g, '')

function Answer({ text, parts, kind }: { text: string; parts: ReturnType<typeof diffWords> | null; kind: 'add' | 'del' }) {
  if (!parts) return <p>{plainText(text)}</p>
  return (
    <p>
      {parts
        .filter((part) => part.kind === 'same' || part.kind === kind)
        .map((part, i) =>
          part.kind === 'same' ? (
            <span key={i}>{`${part.text} `}</span>
          ) : kind === 'add' ? (
            <ins key={i} className="fork__ins">{`${part.text} `}</ins>
          ) : (
            <del key={i} className="fork__del">{`${part.text} `}</del>
          ),
        )}
    </p>
  )
}

function SourceList({ result }: { result: ResultFrame }) {
  if (result.sources.length === 0) return <p className="ds-help">The answer cites no source.</p>
  return (
    <ol className="ds-cite" aria-label="Sources">
      {result.sources.map((source) => (
        <li key={source.url}>
          <span className="ds-cite__n">{`[${source.n}]`}</span>
          <a className="ds-cite__title" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
        </li>
      ))}
    </ol>
  )
}

/** The original answer and the answer after the edit, side by side, with a word diff and what the rewind kept and re-ran. */
export function ForkCompare({ original, fork, onBack }: Props) {
  const [showDiff, setShowDiff] = useState(true)
  const next = fork.result
  const parts = next && showDiff ? diffWords(plainText(original.answer), plainText(next.answer)) : null
  const counts = parts ? countParts(parts) : null
  const delta = next ? sourceDelta(original.sources, next.sources) : null
  const info = next?.fork
  const running = fork.phase === 'running'
  const identical = next ? sameAnswer(original, next) : false

  return (
    <section className="ds-section ds-run__result fork" aria-label="Original and new answer" aria-live="polite">
      <div className="ds-lead">
        <div className="ds-lead__meta">
          <h2 className="ds-section__title" tabIndex={-1} data-result-focus>
            {running ? 'Re-running from your edit' : 'Original and new answer'}
          </h2>
          <button type="button" className="ds-button" onClick={onBack}>Back to the original run</button>
        </div>
        {info && next && (
          <p className="fork__summary">
            {`Kept ${plural(info.reused, 'step')} from the original run and ran ${plural(info.rerun, 'step')} again in ${milliseconds(next.totals.ms)}. `}
            {identical
              ? 'The new answer reads the same as the original.'
              : counts && `The new answer adds ${plural(counts.added, 'word')} and drops ${plural(counts.removed, 'word')}.`}
          </p>
        )}
        {info && next && next.ending.kind !== 'complete' && (
          <div className="ds-state ds-state--partial">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">Partial new answer</p>
            <p className="ds-state__body">{next.ending.message}</p>
          </div>
        )}
        <div className="fork__grid">
          <article className="fork__col" aria-label="Original answer">
            <h3 className="fork__head">Original answer</h3>
            <div className="ds-lead__text"><Answer text={original.answer} parts={parts} kind="del" /></div>
            <SourceList result={original} />
            <p className="ds-lead__foot">{`${milliseconds(original.totals.ms)}. Read ${plural(original.evidenceCount, 'page')}.`}</p>
          </article>
          <article className="fork__col fork__col--new" aria-label="New answer">
            <h3 className="fork__head">After your edit</h3>
            {next ? (
              <>
                <div className="ds-lead__text"><Answer text={next.answer} parts={parts} kind="add" /></div>
                <SourceList result={next} />
                {delta && (delta.added.length > 0 || delta.dropped.length > 0) && (
                  <p className="ds-chips">
                    {delta.added.map((s) => <span key={s.url} className="ds-chip ds-chip--add">{s.title}</span>)}
                    {delta.dropped.map((s) => <span key={s.url} className="ds-chip ds-chip--remove">{s.title}</span>)}
                  </p>
                )}
                <p className="ds-lead__foot">
                  {`${count(next.totals.tokens ?? 0)} tokens in the re-run. `}
                  {next.critic.reviewed && next.critic.notes ? `Critic notes: ${next.critic.notes}` : ''}
                </p>
              </>
            ) : running ? (
              <div className="ds-state ds-state--loading">
                <span className="ds-state__mark" aria-hidden="true" />
                <p className="ds-state__title">Running the steps after your edit</p>
                <p className="ds-state__body">The new answer appears here. The kept steps are marked in the trace.</p>
                <div className="ds-skeleton" aria-hidden="true"><span /><span /><span /></div>
              </div>
            ) : (
              <div className={`ds-state ds-state--${fork.phase === 'stopped' ? 'stopped' : 'error'}`}>
                <span className="ds-state__mark" aria-hidden="true" />
                <p className="ds-state__title">{fork.phase === 'stopped' ? 'Re-run stopped' : 'The re-run failed'}</p>
                <p className="ds-state__body">{fork.error ?? 'No new answer was written. Edit and try again, or go back to the original run.'}</p>
              </div>
            )}
          </article>
        </div>
        {next && (
          <div className="ds-seg" role="group" aria-label="How to show the answers">
            <button type="button" aria-pressed={showDiff} onClick={() => setShowDiff(true)}>Show changes</button>
            <button type="button" aria-pressed={!showDiff} onClick={() => setShowDiff(false)}>Plain</button>
          </div>
        )}
      </div>
    </section>
  )
}
