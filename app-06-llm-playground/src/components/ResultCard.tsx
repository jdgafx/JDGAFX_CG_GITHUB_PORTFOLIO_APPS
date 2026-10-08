import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { PanelResult, Slot } from '../../netlify/shared/contract'
import { barPercent, formatCount, formatMs, formatUsd } from '../lib/format'
import { panelStatus, type Status, type Tone } from '../lib/run'
import { Metric } from './Metric'

export type CardPhase = 'idle' | 'running' | 'stopped' | 'error' | 'done'

const TONE_CLASS: Record<Tone, string> = {
  success: 'ds-badge--success',
  warning: 'ds-badge--warning',
  danger: 'ds-badge--danger',
  accent: 'ds-badge--accent',
  muted: '',
}

const PLACEHOLDER: Record<CardPhase, string> = {
  idle: 'Run a comparison to see this answer.',
  running: 'Waiting for this panel.',
  stopped: 'Stopped before this panel answered.',
  error: 'No answer. The run did not reach the providers.',
  done: 'No answer text was returned.',
}

function phaseStatus(phase: CardPhase): Status {
  if (phase === 'running') return { label: 'Running', tone: 'accent' }
  if (phase === 'stopped') return { label: 'Stopped', tone: 'muted' }
  return { label: 'Not run', tone: 'muted' }
}

interface ResultCardProps {
  slot: Slot
  requested: string
  panel: PanelResult | null
  phase: CardPhase
  fastest: boolean
  scaleMs: number | null
}

export function ResultCard({ slot, requested, panel, phase, fastest, scaleMs }: ResultCardProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => setCopyState('idle'), 1600)
    return () => clearTimeout(timer)
  }, [copyState])

  const status = panel ? panelStatus(panel) : phaseStatus(phase)
  const headingId = `panel-${slot}-title`
  const servedLine = panel
    ? panel.servedModel
      ? `Served by ${panel.servedModel}`
      : 'Served model not reported'
    : `Model ${requested}`

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
    <article className="ds-card arena-card" aria-labelledby={headingId}>
      <div className="ds-card__head">
        <h3 className="ds-card__title" id={headingId}>Panel {slot}</h3>
        <div className="ds-row">
          {fastest && <span className="ds-badge ds-badge--accent">Fastest</span>}
          <span className={`ds-badge ${TONE_CLASS[status.tone]}`}>{status.label}</span>
        </div>
      </div>
      <p className="arena-served ds-mono">{servedLine}</p>
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
              {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copyState === 'copied' ? 'Copied' : 'Copy answer'}
            </button>
            <span className="sr-only" role="status">
              {copyState === 'failed' ? 'Copy failed' : copyState === 'copied' ? 'Answer copied' : ''}
            </span>
          </div>
        </>
      ) : (
        <p className="ds-hint">{panel ? PLACEHOLDER.done : PLACEHOLDER[phase]}</p>
      )}
      {panel && (
        <>
          <div className="arena-bar" aria-hidden="true">
            <span style={{ width: `${barPercent(panel.latencyMs ?? 0, scaleMs)}%` }} />
          </div>
          <div className="ds-metrics">
            <Metric label="Latency" value={formatMs(panel.latencyMs)} />
            <Metric label="Output tokens" value={formatCount(panel.usage.completion_tokens)} />
            <Metric
              label="Cost"
              value={panel.cost ? formatUsd(panel.cost.usd) : 'not reported'}
              hint={panel.cost?.source}
            />
          </div>
        </>
      )}
    </article>
  )
}
