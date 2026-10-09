import { useEffect, useState, type ReactNode } from 'react'
import type { PanelResult, Slot } from '../../netlify/shared/contract'
import { barPercent, formatCount, formatMs, formatUsd } from '../lib/format'
import { panelStatus } from '../lib/run'

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
}

export function ResultCard(props: ResultCardProps) {
  const { slot, requested, panel, phase, fastest, cheapest, judgePick, scaleMs } = props
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
      className={active ? 'ds-panel arena-panel arena-panel--active' : 'ds-panel arena-panel'}
      aria-labelledby={headingId}
    >
      <div className="arena-panel__head">
        <h3 className="arena-panel__title" id={headingId}>
          Panel {slot}
        </h3>
        <span className="ds-badge">
          <span className={`ds-dot ${state.dot}`} aria-hidden="true" />
          {state.label}
        </span>
      </div>
      {(fastest || cheapest || judgePick) && (
        <ul className="arena-marks" aria-label={`Panel ${slot} markers`}>
          {fastest && (
            <li className="ds-badge ds-badge--accent">
              <span className="ds-dot arena-dot--accent" aria-hidden="true" />
              Fastest
            </li>
          )}
          {cheapest && (
            <li className="ds-badge ds-badge--accent">
              <span className="ds-dot arena-dot--accent" aria-hidden="true" />
              Cheapest
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
      <p className="arena-served">
        {panel ? (
          panel.servedModel ? (
            <>
              Served by <span className="ds-mono">{panel.servedModel}</span>
            </>
          ) : (
            'Served model not reported'
          )
        ) : (
          <>
            Model <span className="ds-mono">{requested}</span>
          </>
        )}
      </p>
      {panel?.error && (
        <div className="ds-notice ds-notice--error" role="alert">
          {panel.error}
        </div>
      )}
      {panel?.text ? (
        <>
          <div className="arena-answer" tabIndex={0} role="region" aria-label={`Panel ${slot} answer`}>
            {panel.text}
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
            <span className="sr-only" role="status">
              {copyState === 'failed' ? 'Copy failed' : copyState === 'copied' ? 'Answer copied' : ''}
            </span>
          </div>
        </>
      ) : (
        <p className="ds-help arena-placeholder">{panel ? PLACEHOLDER.done : PLACEHOLDER[phase]}</p>
      )}
      <div className="arena-readouts">
        <div className="arena-readout">
          <span className="arena-readout__label">Latency</span>
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
          <span className="arena-readout__label">Cost</span>
          <span className="arena-readout__value">
            {panel ? (panel.cost ? formatUsd(panel.cost.usd) : 'not reported') : pending}
          </span>
          {hint && <span className="arena-readout__hint">{hint}</span>}
        </div>
      </div>
    </article>
  )
}
