import { useState } from 'react'
import { STAGE_LABELS, type StageId, type StageOutputs } from '../../netlify/shared/contract'
import type { StageView } from '../lib/run'
import Prose from './Prose'
import SourceList from './SourceList'
import StateMark from './StateMark'

// What each stage starts from. The chain's edges carry these hand-offs from one stage to the next.
const HANDOFF: Record<StageId, string> = {
  sources: 'Wikipedia, Hacker News',
  research: 'From the sources',
  outline: 'From research',
  draft: 'From sources, research, outline',
  edit: 'From outline and draft',
  polish: 'From the edit',
}

const STAGE_HINTS: Record<StageId, string> = {
  sources: 'Live Wikipedia articles and Hacker News stories, numbered for citation.',
  research: 'Notes drawn from the numbered sources.',
  outline: 'Section headings with bullet points under each.',
  draft: 'The first full version, built from the research and outline.',
  edit: 'Grammar, flow and argument in the draft.',
  polish: 'A final pass on the prose, opening and conclusion.',
}

interface PipelineProps {
  views: StageView[]
  outputs: StageOutputs
  names: string[]
  onCopy: (label: string, text: string) => void
}

// The six steps, once: each finished step is a button that opens its output under the chain.
export default function Pipeline({ views, outputs, names, onCopy }: PipelineProps) {
  const [open, setOpen] = useState<StageId | null>(null)
  const text = open ? outputs[open] : undefined

  return (
    <section className="ds-section" aria-labelledby="pipeline-title">
      <div className="ds-section__head ds-section__head--bare">
        <h2 className="ds-section__title" id="pipeline-title">Pipeline</h2>
        <p className="ds-section__sub">Select a finished step to read its output.</p>
      </div>
      <div className="ds-stage">
        <ol className="ds-chain" aria-label="Pipeline stages">
          {views.map(view => {
            const ready = outputs[view.stage] !== undefined
            const selected = open === view.stage
            const body = (
              <>
                <span className="ds-chain__name">{STAGE_LABELS[view.stage]}</span>
                <span className="ds-chain__state"><StateMark state={view.state} /></span>
                <span className="ds-chain__count"><span className="ds-chain__figure ds-mono">{view.amount}</span> {view.unit}</span>
                <span className="ds-chain__from">{HANDOFF[view.stage]}</span>
              </>
            )
            return (
              <li key={view.stage} className={`ds-chain__stage ds-chain__stage--${view.state}${selected ? ' ds-chain__stage--selected' : ''}`} aria-current={view.state === 'running' ? 'step' : undefined}>
                {ready ? (
                  <button type="button" className="ds-chain__button" aria-pressed={selected} aria-controls="stage-panel" onClick={() => setOpen(selected ? null : view.stage)}>
                    {body}
                  </button>
                ) : <div className="ds-chain__button ds-chain__button--idle">{body}</div>}
              </li>
            )
          })}
        </ol>
        {open && text !== undefined && (
          <div className="stage-panel" id="stage-panel" role="region" aria-label={`${STAGE_LABELS[open]} output`}>
            <div className="stage-panel__head">
              <h3 className="stage-panel__title">{STAGE_LABELS[open]}</h3>
              <p className="ds-help">{STAGE_HINTS[open]}</p>
              <button type="button" className="ds-button ds-button--quiet" onClick={() => onCopy(`${STAGE_LABELS[open]} output`, text)}>Copy</button>
            </div>
            {open === 'sources' ? <SourceList text={text} /> : <Prose text={text} names={names} />}
          </div>
        )}
      </div>
    </section>
  )
}
