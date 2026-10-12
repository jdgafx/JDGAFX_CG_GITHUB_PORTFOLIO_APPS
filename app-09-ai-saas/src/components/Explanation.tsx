import { Fragment, type ReactNode } from 'react'
import type { Judged } from '../../shared/claims'
import type { PackageFacts, RunWindow } from '../../shared/types'
import { formatDate, joinNames, labelFor, shownList, titleFor, type Figure, type LabelContext, type PackageResult } from '../lib/labels'

interface ExplanationProps {
  names: string[]
  window: RunWindow
  packages: PackageResult[]
  facts: PackageFacts[]
  /** Positions of the numbered figures among the shown paragraphs. */
  figures: Figure[]
}

const UNAVAILABLE = 'The explanation model did not answer in time or is unavailable.'

/** A text segment, byte for byte, with any undeclared number the check found wrapped as an unchecked mark. */
function TextSegment({ j }: { j: Judged }) {
  const s = j.seg.t === 'text' ? j.seg.s : ''
  const runs = j.runs ?? []
  if (runs.length === 0) return <>{s}</>
  const pieces: ReactNode[] = []
  let at = 0
  runs.forEach((run, i) => {
    pieces.push(s.slice(at, run.start))
    pieces.push(
      <mark key={i} className="claim claim--unchecked" title="The model did not declare this number as a figure, so it was not checked">
        {s.slice(run.start, run.end)}
      </mark>,
    )
    at = run.end
  })
  pieces.push(s.slice(at))
  return <>{pieces}</>
}

function ClaimMark({ j, ctx, figure }: { j: Judged; ctx: LabelContext; figure: number | undefined }) {
  const label = labelFor(j.seg, ctx)
  return (
    <>
      <mark className={`claim claim--${j.verdict}`} title={titleFor(j, ctx)} id={figure === undefined ? undefined : `fig-${figure}`}>
        {j.rendered}
      </mark>
      {label && <span className="claim-label"> {label}</span>}
      {j.verdict === 'wrong' && <span className="claim-note"> (differs from npm)</span>}
    </>
  )
}

function State({ kind, title, children }: { kind: 'error' | 'partial' | 'loading'; title: string; children: ReactNode }) {
  return (
    <div className={`ds-state ds-state--${kind}`}>
      <span className="ds-state__mark" aria-hidden="true" />
      <p className="ds-state__title">{title}</p>
      <p className="ds-state__body">{children}</p>
    </div>
  )
}

/**
 * The explanation region. Code writes no digit here: windows are named in words, versions and npm values sit in
 * titles, counts live in the figure check, and every number or date is inside a claim mark or a date mark.
 */
export default function Explanation({ names, window, packages, facts, figures }: ExplanationProps) {
  const ctx: LabelContext = { window, facts }
  const shown = shownList(packages)
  const allFailed = packages.length > 0 && packages.every(p => p.outcome.status === 'error')
  const paragraphIndex = new Map(shown.map((s, i) => [s.name, i]))
  const figureAt = (p: number, s: number) => {
    const i = figures.findIndex(f => f.paragraph === p && f.segment === s)
    return i < 0 ? undefined : i + 1
  }

  return (
    <section className="explanation ds-lead" aria-labelledby="explanation-title">
      <h2 id="explanation-title" className="explanation__title" tabIndex={-1} data-result-focus>
        Downloads for {joinNames(names)} over {window.name}
      </h2>
      <div className="ds-lead__text">
        {allFailed ? (
          <State kind="error" title="No explanation">
            {UNAVAILABLE}
          </State>
        ) : (
          packages.map(({ name, outcome }) => (
            <article key={name} className="explanation__package">
              <h3 className="ds-section__title">{name}</h3>
              {outcome.status === 'pending' && (
                <State kind="loading" title="Explaining">
                  Waiting for the model.
                </State>
              )}
              {outcome.status === 'error' && (
                <State kind="error" title="No explanation">
                  {UNAVAILABLE}
                </State>
              )}
              {outcome.status === 'withheld' && (
                <State kind="partial" title="Withheld">
                  {`The explanation was withheld: the model's answer was not in the agreed format (${outcome.reason}).`}
                </State>
              )}
              {outcome.status === 'ok' && (
                <p className="explanation__text">
                  {outcome.judged.map((j, s) => (
                    <Fragment key={s}>
                      {j.seg.t === 'text' ? <TextSegment j={j} /> : <ClaimMark j={j} ctx={ctx} figure={figureAt(paragraphIndex.get(name) ?? -1, s)} />}
                    </Fragment>
                  ))}
                </p>
              )}
            </article>
          ))
        )}
      </div>
      <p className="ds-lead__foot">
        Latest day with data: <time className="date-mark" dateTime={window.L}>{formatDate(window.L)}</time>
      </p>
    </section>
  )
}
