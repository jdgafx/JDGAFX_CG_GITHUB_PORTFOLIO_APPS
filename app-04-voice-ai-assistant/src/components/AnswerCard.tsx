import { Fragment } from 'react'
import { parseInline } from '../lib/markdown'
import { answerText, type RunState } from '../lib/run'
import { drawSentences, readingNote } from '../lib/view'
import { formatCount, formatMs, formatUsd } from '../lib/format'

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((piece, i) =>
        piece.kind === 'strong' ? <strong key={i}>{piece.text}</strong> : piece.kind === 'em' ? <em key={i}>{piece.text}</em> : piece.kind === 'code' ? <code key={i}>{piece.text}</code> : <Fragment key={i}>{piece.text}</Fragment>,
      )}
    </>
  )
}

function voiceWord(run: RunState): string {
  if (run.steps.at(-1)?.detail === 'Stopped by you') return 'Voice stopped by you'
  if (run.outcome === 'failed' || run.outcome === 'stopped') return run.voice === 'none' ? 'Text only, no voice here' : 'Voice stopped'
  if (run.voice === 'none') return 'Text only, no voice here'
  if (run.voice === 'failed') return 'Voice failed, text only'
  if (run.voice === 'speaking') return run.active < 0 ? 'Reading aloud' : `Speaking sentence ${run.active + 1} of ${run.sentences.length}${run.streamDone ? '' : ' so far'}`
  if (run.voice === 'done') return 'Read aloud'
  return run.sentences.length > 0 ? 'Waiting for the voice' : 'Voice ready'
}

const LOADING: Record<string, { title: string; body: string }> = {
  recording: { title: 'Listening', body: 'Ask your question. Press Stop recording when you finish speaking.' },
  transcribing: { title: 'Transcribing', body: 'Deepgram is turning the recording into text.' },
  thinking: { title: 'Thinking', body: 'The first words appear here the moment the model writes them, and the voice starts at the first full sentence.' },
}

interface AnswerCardProps {
  run: RunState
  /** Extra line of help, e.g. the weather drift explanation. */
  onRetry: () => void
}

export default function AnswerCard({ run, onRetry }: AnswerCardProps) {
  const text = answerText(run)
  const started = run.outcome !== 'idle'
  const waiting = run.outcome === 'running' && text === ''
  const drawn = drawSentences(run)
  const reads = run.steps.map(readingNote).filter((note): note is string => note !== null)
  const stateOf = (outcome: RunState['outcome']) => (outcome === 'failed' ? 'error' : outcome === 'stopped' ? (text ? 'partial' : 'stopped') : 'empty')

  if (!started) {
    return (
      <section className="ds-run__result" aria-labelledby="answer-title">
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <h2 id="answer-title" className="ds-state__title" data-result-focus tabIndex={-1}>
            Ask a question
          </h2>
          <p className="ds-state__body">Record it, type it or pick an example. The answer streams in here and is read aloud sentence by sentence.</p>
        </div>
      </section>
    )
  }

  if (waiting) {
    const copy = LOADING[run.stage] ?? LOADING.thinking
    return (
      <section className="ds-run__result" aria-labelledby="answer-title">
        <div className="ds-state ds-state--loading" aria-busy="true">
          <span className="ds-state__mark" aria-hidden="true" />
          <h2 id="answer-title" className="ds-state__title" data-result-focus tabIndex={-1}>
            {copy.title}
          </h2>
          <p className="ds-state__body">{copy.body}</p>
          {run.stage !== 'recording' && (
            <div className="ds-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      </section>
    )
  }

  const ended = run.outcome === 'failed' || run.outcome === 'stopped'
  const spent = run.usage
  const footBits = [
    run.totalMs !== undefined ? `Server time ${formatMs(run.totalMs)}` : null,
    spent?.total_tokens !== undefined ? `${formatCount(spent.total_tokens)} tokens` : null,
    spent?.cost !== undefined ? formatUsd(spent.cost) : null,
  ].filter(Boolean)

  return (
    <section className="ds-run__result" aria-labelledby="answer-title">
      {run.outcome === 'failed' && (
        <div className="ds-state ds-state--error vox-state-above" role="alert">
          <span className="ds-state__mark" aria-hidden="true" />
          <h2 id="answer-title" className="ds-state__title" data-result-focus tabIndex={-1}>
            Something failed
          </h2>
          <p className="ds-state__body">
            {run.error} {text ? 'What arrived before the failure is kept below.' : run.steps.length > 0 ? 'The steps that ran are in the trace.' : ''}
          </p>
          <div className="ds-state__actions">
            <button type="button" className="ds-button" onClick={onRetry} disabled={!run.question}>
              Ask again
            </button>
          </div>
        </div>
      )}
      {run.outcome === 'stopped' && (
        <div className={`ds-state ds-state--${stateOf('stopped')} vox-state-above`}>
          <span className="ds-state__mark" aria-hidden="true" />
          <h2 id="answer-title" className="ds-state__title" data-result-focus tabIndex={-1}>
            Stopped
          </h2>
          <p className="ds-state__body">The stream and the voice were ended together. {text ? 'The part that had arrived is kept below.' : 'No words had arrived yet.'}</p>
          <div className="ds-state__actions">
            <button type="button" className="ds-button" onClick={onRetry} disabled={!run.question}>
              Ask again
            </button>
          </div>
        </div>
      )}
      {(text !== '' || !ended) && (
        <div className="ds-lead" aria-busy={run.outcome === 'running'}>
          <div className="ds-lead__meta">
            {!ended && (
              <h2 id="answer-title" className="ds-section__title" data-result-focus tabIndex={-1}>
                Answer
              </h2>
            )}
            {ended && <span className="ds-section__title">{run.outcome === 'stopped' ? 'Partial answer' : 'Answer before the failure'}</span>}
            <span className="ds-chip ds-chip--muted">{voiceWord(run)}</span>
            {run.model && (
              <span className="ds-chip" title={run.model}>
                {run.model.replace(/^anthropic\//, '')}
              </span>
            )}
          </div>
          <p className="vox-asked">
            <span className="vox-asked__label">You asked</span> {run.question || 'a spoken question'}
          </p>
          <div className="ds-lead__text" aria-live="off">
            <p>
              {drawn.map((s, i) => (
                <Fragment key={i}>
                  <span className={`vox-s vox-s--${s.state}`} data-state={s.state}>
                    <Inline text={s.text} />
                  </span>{' '}
                </Fragment>
              ))}
              {run.rest.trim() && <span className="vox-s vox-s--tail"><Inline text={run.rest.trimStart()} /></span>}
            </p>
          </div>
          <div className="ds-lead__foot vox-foot">
            {run.voiceNote && <p>{run.voiceNote}</p>}
            {reads.map(note => (
              <p key={note}>{note}</p>
            ))}
            {reads.length > 0 && (
              <details className="ds-disclosure vox-drift">
                <summary>Why can the source link show other numbers?</summary>
                <p>
                  Open-Meteo blends several weather models and republishes them in runs. The server that answers a request can hold a slightly newer or
                  older run than the one this app read, so the same link can differ by a few tenths of a degree, and more for humidity and wind. The
                  reading time above says which slot this answer used.
                </p>
              </details>
            )}
            {footBits.length > 0 && <p>{footBits.join(', ')}</p>}
          </div>
        </div>
      )}
    </section>
  )
}

