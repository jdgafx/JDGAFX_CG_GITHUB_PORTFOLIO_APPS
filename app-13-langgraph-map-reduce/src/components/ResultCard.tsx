import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCells, chunkTexts, pointRefs, retriedChunks, type PointRef } from '../lib/evidence'
import { coverageBadge, missingItems, missingLead, reviewNote } from '../lib/coverage-text'
import { formatCount } from '../lib/format'
import { splitText } from '../../netlify/shared/chunk'
import type { Phase, RunView } from '../lib/view'
import type { RunResult } from '../types/frames'
import { Md } from './Md'
import { CoverageStrip } from './CoverageStrip'
import { SourcePanel, type Selection } from './SourcePanel'

/** Below this width the source panel opens under the point, not beside the summary. */
const SIDE_BY_SIDE_FROM = 760

function useWide(): { ref: React.RefObject<HTMLDivElement | null>; wide: boolean } {
  const ref = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= SIDE_BY_SIDE_FROM))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, wide }
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

function Explorer({ result, analyzed, view }: { result: RunResult; analyzed: string; view: RunView }) {
  const [selection, setSelection] = useState<Selection>(null)
  const { ref, wide } = useWide()
  const panelRef = useRef<HTMLDivElement>(null)
  const chunks = useMemo(() => splitText(analyzed), [analyzed])
  const texts = useMemo(() => chunkTexts(chunks, result.chunkCount), [chunks, result.chunkCount])
  const ids = useMemo(() => chunks.map((c) => c.id), [chunks])
  const refs = useMemo(() => pointRefs(result.summary), [result.summary])
  const retried = useMemo(() => retriedChunks(view.branches), [view.branches])
  const cells = useMemo(() => buildCells(ids, result.summary, result.coverage, retried), [ids, result, retried])
  const point: PointRef | null = selection?.kind === 'point' ? (refs.find((r) => r.key === selection.key) ?? null) : null
  const lit = useMemo(() => new Set(point ? point.chunks : []), [point])
  const chosen = selection?.kind === 'chunk' ? selection.id : null

  const choosePoint = (key: string): void => setSelection((s) => (s?.kind === 'point' && s.key === key ? null : { kind: 'point', key }))
  const chooseChunk = (id: number): void => setSelection((s) => (s?.kind === 'chunk' && s.id === id ? null : { kind: 'chunk', id }))

  // On a narrow screen the panel opens below the fold of the list, so bring it into view when the selection changes.
  useEffect(() => {
    if (!wide && selection) panelRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selection, wide])

  const panel = (
    <div ref={panelRef} className="evidence__panel">
      <SourcePanel selection={selection} point={point} cells={cells} texts={texts} keyPoints={result.keyPoints} onPoint={choosePoint} />
    </div>
  )
  const note = reviewNote(result.reviewFlags)

  return (
    <div
      className="evidence"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selection) setSelection(null)
      }}
    >
      <section className="evidence__strip" aria-label="Coverage map">
        <h3 className="evidence__title">Coverage map</h3>
        <p className="ds-help">Each cell is one chunk of the document. Select a cell to see what it gave the summary.</p>
        <CoverageStrip cells={cells} lit={lit} chosen={chosen} max={Math.max(1, ...cells.map((c) => c.count))} onChoose={chooseChunk} />
        {note ? <p className="coverage-note">{note}</p> : null}
        {!wide && selection?.kind === 'chunk' ? panel : null}
      </section>

      <div className={wide ? 'evidence__body evidence__body--wide' : 'evidence__body'}>
        <div className="evidence__summary">
          <p className="evidence__overview"><Md text={result.summary.overview} /></p>
          <p className="ds-help">Select a point to light up the chunks it cites and read their text. Press Escape to close.</p>
          {result.summary.sections.map((section, s) => (
            <div key={section.heading} className="summary-section">
              <h3 className="summary-section__title"><Md text={section.heading} /></h3>
              <ul className="summary-points">
                {section.points.map((p, i) => {
                  const key = `${s}.${i}`
                  const on = selection?.kind === 'point' && selection.key === key
                  return (
                    <li key={key}>
                      <button type="button" className="point" aria-pressed={on} onClick={() => choosePoint(key)}>
                        <span className="point__text">
                          <Md text={p.text} />
                        </span>
                        <span className="point__cites">
                          {p.chunks.length === 0 ? <span className="ds-hint">no citation</span> : p.chunks.map((id) => (
                            <span key={id} className="ds-badge cite">
                              Chunk {id}
                            </span>
                          ))}
                        </span>
                      </button>
                      {!wide && on ? panel : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {result.entities.length > 0 ? (
            <div className="summary-section">
              <h3 className="summary-section__title">Entities across the document</h3>
              <p className="summary-entities"><Md text={result.entities.join(', ')} /></p>
            </div>
          ) : null}
        </div>
        {wide ? <aside className="evidence__side">{panel}</aside> : null}
      </div>
    </div>
  )
}

interface Props {
  view: RunView
  analyzed: string
  onRetry: () => void
}

/** The summary leads the page: once a run has ended it comes first, whatever the outcome. */
export function ResultCard({ view, analyzed, onRetry }: Props) {
  const { result, phase } = view
  if (!result) {
    const states: Record<Phase, StateProps> = {
      idle: { tone: 'empty', title: 'No summary yet', body: 'Load a Wikipedia article or paste a document, then analyze it. The cited summary and its coverage map appear here.' },
      running: { tone: 'loading', title: 'Analyzing', body: 'The summary is written once every chunk is extracted and merged.' },
      done: { tone: 'empty', title: 'No summary', body: 'This run returned no summary.' },
      error: { tone: 'error', title: 'The run failed', body: `${view.error ?? 'No summary was written.'} The steps that ran are in the trace.`, action: { label: 'Try again', onClick: onRetry } },
      stopped: { tone: 'stopped', title: 'Run stopped', body: 'You stopped it before a summary was written. The steps that finished stay in the trace.', action: { label: 'Analyze again', onClick: onRetry } },
    }
    return (
      <section className="ds-section ds-run__result" aria-label="Summary" aria-live="polite">
        <ResultState {...states[phase]} />
      </section>
    )
  }

  const { covered, missing } = result.coverage
  const total = covered.length + missing.length
  const badge = coverageBadge(result)
  return (
    <section className="ds-section ds-run__result" aria-label="Summary">
      <div className="ds-lead">
        <div className="ds-lead__meta">
          <h2 tabIndex={-1} data-result-focus className="ds-section__title">
            Summary
          </h2>
          <span className={`ds-badge ${missing.length === 0 ? 'ds-badge--success' : 'ds-badge--warning'}`}>
            <span className="ds-dot" aria-hidden="true" />
            {covered.length} of {formatCount(total, 'chunk')} covered
          </span>
          <span className={`ds-badge ${badge.tone}`}>{badge.text}</span>
        </div>
        {result.notice ? (
          <div className="ds-state ds-state--partial" role="status">
            <span className="ds-state__mark" aria-hidden="true" />
            <p className="ds-state__title">Partial retry</p>
            <p className="ds-state__body">{result.notice}</p>
          </div>
        ) : null}
        {missing.length > 0 ? (
          <p className="ds-notice ds-notice--error" role="alert">
            {missingLead(result)}: {missingItems(result.coverage).join(', ')}. The summary does not cover {missing.length === 1 ? 'it' : 'them'}.
          </p>
        ) : null}
        <Explorer key={view.startedAt} result={result} analyzed={analyzed} view={view} />
        <p className="ds-lead__foot">
          A chunk counts as covered when it gave key points and the summary cites it. The review model only adds a note.
        </p>
      </div>
    </section>
  )
}
