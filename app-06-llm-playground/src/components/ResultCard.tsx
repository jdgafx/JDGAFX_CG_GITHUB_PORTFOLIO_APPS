import { useEffect, useState, type ReactNode } from 'react'
import type { PanelResult, RatingChange, Slot } from '../../netlify/shared/contract'
import { barPercent, formatCount, formatMs, formatUsd, plainModel, splitModel } from '../lib/format'
import { panelStatus } from '../lib/run'
import { Delta } from './Delta'
import { Prose } from './Prose'

// The two 14px icons on the copy button, drawn on a 24px grid in the current text colour.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const NOT_REPORTED = 'served model not reported'

export type CardPhase = 'idle' | 'running' | 'stopped' | 'error' | 'done'

const PLACEHOLDER: Record<CardPhase, string> = {
  idle: 'Run a comparison to see this answer.',
  running: 'Waiting for this panel.',
  stopped: 'Stopped before this panel answered.',
  error: 'No answer. The run did not reach the providers.',
  done: 'No answer text was returned.',
}

interface StateView {
  label: string
  dot: string
}

// The panel's state word, with the dot that matches it.
function stateView(panel: PanelResult | null, phase: CardPhase): StateView {
  if (panel) {
    const status = panelStatus(panel)
    return status
  }
  if (phase === 'running') return { label: 'Running', dot: 'ds-dot--running' }
  if (phase === 'stopped') return { label: 'Stopped', dot: 'ds-dot--skipped' }
  return { label: 'Not run', dot: '' }
}

// Estimated costs say so. Billed costs say they came from usage.
function costHint(panel: PanelResult): string | null {
  if (!panel.cost) return null
  return panel.cost.source === 'estimated' ? 'estimated' : 'from usage'
}

interface ResultCardProps {
  slot: Slot
  requested: string
  panel: PanelResult | null
  phase: CardPhase
  fastest: boolean
  cheapest: boolean
  judgePick: boolean
  scaleMs: number | null
  // The visitor's own pick in a blind vote, the rating change it caused, and whether the models were just revealed.
  yourPick?: boolean
  change?: RatingChange | null
  revealed?: boolean
}

// The model behind a panel: the model the provider answered with leads, then its vendor. The request alias is never
// shown. A panel with no reported served model says so; a panel still waiting shows the visitor's own pick, or nothing for the alias.
function ModelName({ panel, requested, revealed }: { panel: PanelResult | null; requested: string; revealed: boolean }) {
  const served = panel ? panel.servedModel : null
  const pickedId = !panel && !requested.startsWith('~') ? requested : null
  const id = served ?? pickedId
  const { vendor, name } = id ? splitModel(id) : { vendor: '', name: panel ? NOT_REPORTED : 'shown with the answer' }
  return (
    <p className={revealed ? 'arena-name arena-name--revealed' : 'arena-name'} title={id ? plainModel(id) : name}>
      <span className="arena-name__model">{name}</span>
      <span className="arena-name__meta">{vendor}</span>
    </p>
  )
}

export function ResultCard(props: ResultCardProps) {
  const { slot, requested, panel, phase, fastest, cheapest, judgePick, scaleMs, yourPick = false, change = null, revealed = false } = props
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => setCopyState('idle'), 1600)
    return () => clearTimeout(timer)
  }, [copyState])

  const state = stateView(panel, phase)
  const headingId = `panel-${slot}-title`
  const pending = phase === 'running' ? 'waiting' : 'not run'
  const active = panel === null && phase === 'running'
  const hint = panel ? costHint(panel) : null

  async function copyAnswer() {
    if (!panel) return
    try {
      await navigator.clipboard.writeText(panel.text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <article
      className={`ds-panel arena-panel${active ? ' arena-panel--active' : ''}${yourPick ? ' arena-panel--picked' : ''}`}
      aria-labelledby={headingId}
    >
      <div className="arena-panel__head">
        <span className="arena-letter" aria-hidden="true">{slot}</span>
        <div className="arena-panel__id">
          <h3 className="arena-panel__title" id={headingId}>Panel {slot}</h3>
          <ModelName panel={panel} requested={requested} revealed={revealed} />
        </div>
        <span className="ds-badge">
          <span className={`ds-dot ${state.dot}`} aria-hidden="true" />
          {state.label}
        </span>
      </div>
      {(judgePick || yourPick || change) && (
        <ul className="arena-marks" aria-label={`Panel ${slot} markers`}>
          {yourPick && (
            <li className="ds-badge arena-badge--pick">
              <span aria-hidden="true">{'\u2713'}</span> Your pick
            </li>
          )}
          {change && (
            <li className="ds-badge">
              Rating <Delta delta={change.after - change.before} />
            </li>
          )}
          {judgePick && (
            <li className="ds-badge">
              <span className="ds-dot arena-dot--ring" aria-hidden="true" />
              Judge's pick
            </li>
          )}
        </ul>
      )}
      {panel?.error && (
        <div className="ds-notice ds-notice--error" role="alert">
          {panel.error}
        </div>
      )}
      {panel?.text ? (
        <>
          <div className="arena-answer" tabIndex={0} role="region" aria-label={`Panel ${slot} answer`}>
            <Prose text={panel.text} />
          </div>
          <div className="ds-row">
            <button type="button" className="ds-button" onClick={copyAnswer}>
              <Icon>
                {copyState === 'copied' ? (
                  <polyline points="20 6 9 17 4 12" />
                ) : (
                  <>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </>
                )}
              </Icon>
              {copyState === 'copied' ? 'Copied' : 'Copy answer'}
            </button>
            <span className="ds-sr-only" role="status">
              {copyState === 'failed' ? 'Copy failed' : copyState === 'copied' ? 'Answer copied' : ''}
            </span>
          </div>
        </>
      ) : (
        <p className="ds-help arena-placeholder">{panel ? PLACEHOLDER.done : PLACEHOLDER[phase]}</p>
      )}
      <div className="arena-readouts">
        <div className="arena-readout">
          <span className="arena-readout__label">Latency{fastest && <span className="arena-best"> · fastest</span>}</span>
          <span className="arena-readout__value">{panel ? formatMs(panel.latencyMs) : pending}</span>
          <span className="arena-bar" aria-hidden="true">
            <span style={{ width: `${barPercent(panel?.latencyMs ?? 0, scaleMs)}%` }} />
          </span>
        </div>
        <div className="arena-readout">
          <span className="arena-readout__label">Output tokens</span>
          <span className="arena-readout__value">{panel ? formatCount(panel.usage.completion_tokens) : pending}</span>
        </div>
        <div className="arena-readout">
          <span className="arena-readout__label">Cost{cheapest && <span className="arena-best"> · cheapest</span>}</span>
          <span className="arena-readout__value">
            {panel ? (panel.cost ? formatUsd(panel.cost.usd) : 'not reported') : pending}
          </span>
          {hint && <span className="arena-readout__hint">{hint}</span>}
        </div>
      </div>
    </article>
  )
}
