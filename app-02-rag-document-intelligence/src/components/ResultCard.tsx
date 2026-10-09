import { useMemo } from 'react'
import { parseAnswer, sentencesCiting, supportingSentence } from '../lib/evidence'
import { count, score } from '../lib/format'
import { locationLabel } from '../lib/location'
import { AnswerBody, citeKey } from './AnswerBody'
import { SourcePanel } from './SourcePanel'
import type { DocumentState, Turn } from '../types'

export type Phase = 'idle' | 'running' | 'done' | 'failed' | 'stopped'

/** The passage open in the source panel. */
export interface Selection {
  turnId: string
  index: number
  mode: 'cited' | 'checked'
}

interface StateProps {
  tone: 'empty' | 'loading' | 'error' | 'stopped'
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}

function ResultState({ tone, title, body, action }: StateProps) {
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

const where = (doc: DocumentState, index: number): string => {
  const place = doc.chunkPages[index]
  return place === undefined ? `Passage ${index + 1}` : `Passage ${index + 1}, ${locationLabel(doc, place)}`
}

interface TurnCardProps {
  turn: Turn
  doc: DocumentState
  lead: boolean
  selection: Selection | null
  onSelect: (selection: Selection) => void
  onClose: () => void
}

/** One question and its answer: the text with clickable citations, the sources, and the panel that opens from either. */
function TurnCard({ turn, doc, lead, selection, onSelect, onClose }: TurnCardProps) {
  const parsed = useMemo(() => parseAnswer(turn.answer, turn.sourceChunks), [turn])
  const mine = selection?.turnId === turn.id ? selection : null
  const noMatch = turn.kind === 'no-matches'
  const notFound = !noMatch && turn.sourceChunks.length === 0
  const Heading = lead ? 'h2' : 'h3'
  const title = noMatch || notFound ? 'Not in the document' : 'Answer'
  const checked = turn.retrieval.ranked.slice(0, 5)

  const badge = noMatch
    ? { tone: 'ds-badge--warning', dot: 'ds-dot--stopped', text: 'Model not called' }
    : notFound
      ? { tone: 'ds-badge--warning', dot: 'ds-dot--stopped', text: 'No supporting passage' }
      : { tone: 'ds-badge--success', dot: 'ds-dot--ok', text: `Cites ${turn.sourceChunks.length} ${turn.sourceChunks.length === 1 ? 'passage' : 'passages'}` }

  return (
    <div className="ds-lead">
      <div className="ds-lead__meta">
        <Heading className="ds-section__title" tabIndex={lead ? -1 : undefined} data-result-focus={lead ? '' : undefined}>
          {title}
        </Heading>
        <span className={`ds-badge ${badge.tone}`}>
          <span className={`ds-dot ${badge.dot}`} aria-hidden="true" />
          {badge.text}
        </span>
      </div>
      <p className="docmind-question">{turn.question}</p>

      {noMatch ? (
        <div className="ds-lead__text">
          <p>{turn.answer}</p>
        </div>
      ) : (
        <AnswerBody
          turnId={turn.id}
          parsed={parsed}
          selected={mine?.mode === 'cited' ? mine.index : null}
          onSelect={index => onSelect({ turnId: turn.id, index, mode: 'cited' })}
        />
      )}

      {noMatch && (
        <p className="docmind-checked-note">
          {`All ${count(turn.retrieval.total)} passages were checked for ${turn.retrieval.terms.map(t => t.word).join(', ')}. None contains one of them.`}
        </p>
      )}

      {notFound && checked.length > 0 && (
        <div className="docmind-checked">
          <p className="ds-help">
            {`The model was given ${count(turn.retrieval.ranked.length)} passages and found no answer in them. The best matches by BM25 score; open one to read it:`}
          </p>
          <ul className="docmind-checked__list">
            {checked.map(item => (
              <li key={item.index}>
                <button
                  type="button"
                  className="docmind-chip"
                  data-cite={citeKey(turn.id, item.index)}
                  aria-pressed={mine?.mode === 'checked' && mine.index === item.index}
                  onClick={() => onSelect({ turnId: turn.id, index: item.index, mode: 'checked' })}
                >
                  <span>{`Passage ${item.index + 1}`}</span>
                  <span className="ds-mono">{score(item.score)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {turn.sourceChunks.length > 0 && (
        <ol className="ds-cite" aria-label="Sources">
          {turn.sourceChunks.map(index => {
            const support = supportingSentence(doc.chunks[index] ?? '', sentencesCiting(parsed, index))
            const open = mine?.mode === 'cited' && mine.index === index
            return (
              <li key={index}>
                <button
                  type="button"
                  className="docmind-cite docmind-cite--row"
                  data-cite={citeKey(turn.id, index)}
                  aria-pressed={open}
                  aria-label={`${where(doc, index)}: show the supporting sentence`}
                  onClick={() => onSelect({ turnId: turn.id, index, mode: 'cited' })}
                >
                  {index + 1}
                </button>
                <span className="ds-cite__title docmind-cite__where">{where(doc, index)}</span>
                <span className="ds-cite__url">{support ? `“${support.sentence.text}”` : 'No sentence stands out in this passage.'}</span>
              </li>
            )
          })}
        </ol>
      )}

      {mine && (
        <SourcePanel
          doc={doc}
          index={mine.index}
          parsed={parsed}
          retrieval={turn.retrieval}
          mode={mine.mode}
          onClose={onClose}
        />
      )}

      {!noMatch && (
        <p className="ds-lead__foot">
          {turn.selfRated !== null && `Self-rated ${Math.round(turn.selfRated * 100)}%: the model rated its own answer, and the rating is not checked against the passages. `}
          {turn.model && (
            <>
              Served by <span className="ds-mono">{turn.model}</span>.
            </>
          )}
        </p>
      )}
    </div>
  )
}

interface ResultCardProps {
  doc: DocumentState | null
  phase: Phase
  turns: Turn[]
  error: string | null
  hasSteps: boolean
  selection: Selection | null
  onSelect: (selection: Selection) => void
  onClose: () => void
  onRetry: () => void
}

/** The page's lead once a question has ended: the answer, or the reason there is none. */
export function ResultCard({ doc, phase, turns, error, hasSteps, selection, onSelect, onClose, onRetry }: ResultCardProps) {
  const leadTurn = phase === 'done' ? turns[turns.length - 1] : undefined
  const earlier = leadTurn ? turns.slice(0, -1) : turns

  return (
    <section className="ds-section ds-run__result" aria-label="Answer" aria-live="polite">
      {leadTurn && doc ? (
        <TurnCard turn={leadTurn} doc={doc} lead selection={selection} onSelect={onSelect} onClose={onClose} />
      ) : phase === 'running' ? (
        <ResultState tone="loading" title="Reading the best passages" body="The cited answer appears here when the model has replied." />
      ) : phase === 'failed' ? (
        <ResultState
          tone="error"
          title="The question did not get an answer"
          body={`${error ?? 'No answer was written.'} ${hasSteps ? 'The steps that ran are in the trace.' : 'No step had started.'}`}
          action={{ label: 'Try again', onClick: onRetry }}
        />
      ) : phase === 'stopped' ? (
        <ResultState
          tone="stopped"
          title="Question stopped"
          body={`You stopped it before an answer came back. ${hasSteps ? 'The steps that finished stay in the trace.' : 'No step had finished.'}`}
          action={{ label: 'Ask again', onClick: onRetry }}
        />
      ) : doc ? (
        <ResultState tone="empty" title="No answer yet" body="Ask a question. The answer appears here with citations you can click to read the sentence behind them." />
      ) : (
        <ResultState tone="empty" title="No document yet" body="Choose a Wikipedia article, an arXiv paper or a file on the left. Then ask a question about it." />
      )}

      {doc && earlier.length > 0 && (
        <details className="ds-disclosure docmind-earlier">
          <summary>{`Earlier questions (${earlier.length})`}</summary>
          <div className="ds-stack">
            {[...earlier].reverse().map(turn => (
              <TurnCard key={turn.id} turn={turn} doc={doc} lead={false} selection={selection} onSelect={onSelect} onClose={onClose} />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
