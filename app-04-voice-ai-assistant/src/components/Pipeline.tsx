import type { ReactNode } from 'react'
import { formatMs } from '../lib/format'
import type { PipelineView, StageState, StageView } from '../lib/pipeline'

const LABEL: Record<StageState, string> = {
  waiting: 'Waiting',
  running: 'Running',
  ok: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  notrun: 'Not run',
}

const DOT: Record<StageState, string> = {
  waiting: 'ds-dot',
  running: 'ds-dot ds-dot--running',
  ok: 'ds-dot ds-dot--ok',
  failed: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
  notrun: 'ds-dot',
}

interface StageNodeProps {
  name: string
  where: ReactNode
  stage: StageView
}

// A stage shows its name, what runs it, a dot with the word, and its time. Colour never stands alone.
function StageNode({ name, where, stage }: StageNodeProps) {
  return (
    <div className="vox-node" data-state={stage.state}>
      <p className="vox-node__name">{name}</p>
      <p className="vox-node__where">{where}</p>
      <p className="vox-node__status">
        <span className={DOT[stage.state]} aria-hidden="true" />
        {LABEL[stage.state]}
        {stage.ms !== undefined && <span className="vox-node__time">{formatMs(stage.ms)}</span>}
      </p>
    </div>
  )
}

interface EdgeProps {
  label: string
  passed: boolean
}

// A line with an arrowhead, labelled with what passes along it. A dashed line is an edge the question did not take.
function Edge({ label, passed }: EdgeProps) {
  return (
    <div
      className={passed ? 'vox-edge vox-edge--taken' : 'vox-edge'}
      role="img"
      aria-label={passed ? `${label} passed on` : `${label} not used`}
    >
      <span className="vox-edge__label" aria-hidden="true">
        {label}
      </span>
      <svg viewBox="0 0 80 12" aria-hidden="true" focusable="false">
        <line x1="0" y1="6" x2="70" y2="6" />
        <path d="M68 0 L80 6 L68 12 Z" />
      </svg>
    </div>
  )
}

interface PipelineProps {
  view: PipelineView
  model: string | undefined
  idle: boolean
}

export default function Pipeline({ view, model, idle }: PipelineProps) {
  return (
    <section className="ds-section" aria-labelledby="pipeline-title">
      <div className="ds-section__head">
        <h2 id="pipeline-title" className="ds-section__title">
          Listen, think, speak
        </h2>
        <p className="ds-section__sub">
          Each question passes these three stages in order. The active stage is filled, and the path taken stays marked.
        </p>
      </div>
      <div className="ds-panel">
        <div className="ds-scroll-x">
          <div className="vox-chain" role="group" aria-label="Stages of the question">
            <StageNode
              name="Listen"
              where={
                view.listen.note ?? (
                  <>
                    Deepgram <span className="ds-mono">nova-3</span> on the server
                  </>
                )
              }
              stage={view.listen}
            />
            <Edge label="transcript" passed={view.transcriptPassed} />
            <StageNode
              name="Think"
              where={model ? <>Served by <span className="ds-mono">{model}</span></> : 'One chat model call on the server'}
              stage={view.think}
            />
            <Edge label="reply" passed={view.replyPassed} />
            <StageNode name="Speak" where="Browser voice on this device" stage={view.speak} />
          </div>
        </div>
        {idle && <p className="ds-help vox-panel-help">Ask a question to fill in the three stages.</p>}
      </div>
    </section>
  )
}
