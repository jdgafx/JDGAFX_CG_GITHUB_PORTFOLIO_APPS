import { useEffect, useRef, type ReactNode } from 'react'
import type { Retrieval } from '../lib/bm25'
import { contextAround, sentencesCiting, supportingSentences, type ParsedAnswer, type Support } from '../lib/evidence'
import { score } from '../lib/format'
import { locationLabel } from '../lib/location'
import type { DocumentState } from '../types'

interface SourcePanelProps {
  doc: DocumentState
  index: number
  parsed: ParsedAnswer
  retrieval: Retrieval
  /** 'cited' passages are matched to the sentence that cites them. A passage that was only checked has no answer to match. */
  mode: 'cited' | 'checked'
  onClose: () => void
}

/** The passage as text and marked sentences, in order. */
function marked(passage: string, supports: Support[]): ReactNode {
  const out: ReactNode[] = []
  let at = 0
  supports.forEach((support, i) => {
    out.push(passage.slice(at, support.sentence.start))
    out.push(
      <mark key={i} className="docmind-mark">
        {passage.slice(support.sentence.start, support.sentence.end)}
      </mark>,
    )
    at = support.sentence.end
  })
  out.push(passage.slice(at))
  return out
}

/** The cited passage with the sentence that supports the answer marked, and the text on each side of it. */
export function SourcePanel({ doc, index, parsed, retrieval, mode, onClose }: SourcePanelProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const passage = doc.chunks[index] ?? ''
  const place = doc.chunkPages[index]
  const { before, after, joinBefore, joinAfter } = contextAround(doc.chunks[index - 1], passage, doc.chunks[index + 1])
  const citing = mode === 'cited' ? sentencesCiting(parsed, index) : []
  const supports = supportingSentences(passage, citing)
  const rank = retrieval.ranked.findIndex(r => r.index === index)
  const ranked = rank >= 0 ? retrieval.ranked[rank] : undefined

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [index])

  return (
    <aside className="docmind-source" aria-labelledby="source-title">
      <div className="docmind-source__head">
        <h3 id="source-title" className="docmind-source__title" tabIndex={-1} ref={heading}>
          {`Passage ${index + 1}${place !== undefined ? `, ${locationLabel(doc, place)}` : ''}`}
        </h3>
        <button type="button" className="ds-button ds-button--quiet" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="docmind-source__text">
        {before !== '' && <span className="docmind-source__ctx">{`…${before}${joinBefore ? '' : ' '}`}</span>}
        {marked(passage, supports)}
        {after !== '' && <span className="docmind-source__ctx">{`${joinAfter ? '' : ' '}${after}…`}</span>}
      </p>

      <p className="ds-help">
        {mode === 'checked'
          ? 'The answer does not rest on this passage, so no sentence is marked. It is one the model was given.'
          : supports.length > 0
            ? `Marked: for each answer sentence that cites this passage, the sentence that shares the most words with it (${[...new Set(supports.flatMap(s => s.shared))].join(', ')}).`
            : 'No sentence here shares a word with the answer, so none is marked.'}
        {ranked && ` BM25 rank ${rank + 1} of ${retrieval.ranked.length} sent, score ${score(ranked.score)}.`}
      </p>
    </aside>
  )
}
