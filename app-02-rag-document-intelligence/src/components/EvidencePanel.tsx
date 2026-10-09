import { Fragment } from 'react'
import { highlightSegments, type Retrieval } from '../lib/bm25'
import { count, score } from '../lib/format'
import { locationLabel } from '../lib/location'
import { PassageMap } from './PassageMap'
import { DocumentViewer } from './DocumentViewer'
import type { DocumentState, RunState } from '../types'

/** Passages shown with their text. The rest of the ones sent are listed by score only. */
export const SHOWN = 5

function where(doc: DocumentState, index: number): string {
  const place = doc.chunkPages[index]
  return `Passage ${index + 1}${place !== undefined ? `, ${locationLabel(doc, place)}` : ''}`
}

interface RankListProps {
  doc: DocumentState
  retrieval: Retrieval
  cited: readonly number[]
  /** Which rows to draw, as a slice of the ranked list. */
  from: number
  to: number
  /** Show the passage text with the question's words marked. */
  text: boolean
}

/** Ranked passages with a bar for the BM25 score, scaled to the best passage, and the matched words marked in the text. */
export function RankList({ doc, retrieval, cited, from, to, text }: RankListProps) {
  const best = retrieval.ranked[0]?.score ?? 1
  return (
    <ol className="docmind-rank" start={from + 1} aria-label="Passages ranked by BM25 score">
      {retrieval.ranked.slice(from, to).map((item, i) => (
        <li key={item.index} className="docmind-rank__item">
          <span className="docmind-rank__n">{from + i + 1}</span>
          <div className="docmind-rank__body">
            <div className="docmind-rank__head">
              <span className="docmind-rank__where">{where(doc, item.index)}</span>
              {cited.includes(item.index) && <span className="ds-badge ds-badge--accent">Cited in the answer</span>}
            </div>
            <div className="docmind-rank__bar" title={`Matched: ${item.matched.join(', ')}`}>
              <span className="ds-hbar__track">
                <span className="ds-hbar__bar" style={{ '--w': `${Math.max(2, (item.score / best) * 100)}%` } as React.CSSProperties} />
              </span>
              <span className="docmind-rank__score">{score(item.score)}</span>
            </div>
            {text && (
              <p className="docmind-rank__text">
                {highlightSegments(doc.chunks[item.index] ?? '', retrieval.terms).map((seg, k) =>
                  seg.hit ? <mark key={k} className="docmind-term">{seg.text}</mark> : <Fragment key={k}>{seg.text}</Fragment>,
                )}
              </p>
            )}
            {text && <p className="docmind-rank__matched">{`Matched ${item.matched.join(', ')}`}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

interface EvidencePanelProps {
  doc: DocumentState | null
  docVersion: number
  retrieval: Retrieval | null
  sent: number[]
  cited: number[]
  state: RunState | null
}

/** The retrieval, laid open: what was searched for, which passages scored best and why. */
export function EvidencePanel({ doc, docVersion, retrieval, sent, cited, state }: EvidencePanelProps) {
  // Without a document the answer block already says what to do first; nothing to rank yet.
  if (!doc) return null
  return (
    <section className="ds-section ds-run__stage" aria-labelledby="evidence-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 id="evidence-title" className="ds-section__title">
          Evidence
        </h2>
        <p className="ds-section__sub">
          BM25 scores every passage in your browser. Bars are scaled to the best one; matched words are marked.
        </p>
      </div>

      {!retrieval ? (
        <div className="ds-state ds-state--empty">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">Nothing ranked yet</p>
          <p className="ds-state__body">{`Ask a question. DocMind ranks all ${count(doc.chunks.length)} passages and shows the best five here.`}</p>
        </div>
      ) : retrieval.ranked.length === 0 ? (
        <div className="ds-state ds-state--partial">
          <span className="ds-state__mark" aria-hidden="true" />
          <p className="ds-state__title">No passage matched</p>
          <p className="ds-state__body">
            {`All ${count(retrieval.total)} passages were checked for ${retrieval.terms.map(t => t.word).join(', ') || 'your words'}. None contains one of them, so the model was not called.`}
          </p>
        </div>
      ) : (
        <div className="ds-stack">
          <div className="docmind-terms">
            <span className="ds-help">Searched for</span>
            <span className="ds-chips">
              {retrieval.terms.map(t => (
                <span key={t.stem} className="ds-chip">
                  {t.word}
                </span>
              ))}
            </span>
          </div>
          <RankList doc={doc} retrieval={retrieval} cited={cited} from={0} to={SHOWN} text />
          {retrieval.ranked.length > SHOWN && (
            <details className="ds-disclosure">
              <summary>{`The other ${retrieval.ranked.length - SHOWN} passages sent to the model`}</summary>
              <RankList doc={doc} retrieval={retrieval} cited={cited} from={SHOWN} to={retrieval.ranked.length} text={false} />
            </details>
          )}
        </div>
      )}

      <div className="docmind-doc">
          <PassageMap total={doc.chunks.length} sent={sent} citedLatest={cited} latestState={state} start={0} end={0} />
          <details className="ds-disclosure">
            <summary>Browse the passages</summary>
            <DocumentViewer key={docVersion} document={doc} sent={sent} cited={cited} />
          </details>
      </div>
    </section>
  )
}
