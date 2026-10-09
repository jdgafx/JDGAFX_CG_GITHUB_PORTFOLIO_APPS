import { useEffect, useState, type ReactNode } from 'react'
import { STAGE_LABELS, type StageId } from '../../netlify/shared/contract'
import { formatCount, formatMs, formatUsd, type Phase, type RunTotals } from '../lib/run'

function shortModel(id: string): string {
  return id.slice(id.indexOf('/') + 1)
}

/** Counts up from the moment this run started. */
function LiveClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [])
  return <>{formatMs(Math.max(0, Math.round((now - since) / 100) * 100))}</>
}

interface CellProps {
  label: string
  hint: string
  children: ReactNode
  small?: boolean
}

function Cell({ label, hint, children, small }: CellProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value" style={small ? { fontSize: 15 } : undefined}>{children}</dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

interface ReadoutProps {
  phase: Phase
  totals: RunTotals | null
  runningStage: StageId | null
  startedAt: number
}

/** Live figures while the run goes, the run's own totals once it ends, dashes before the first call. */
export default function Readout({ phase, totals, runningStage, startedAt }: ReadoutProps) {
  const running = phase === 'running'
  const none = '—'
  const hint = running ? 'So far' : phase === 'failed' ? 'Before it failed' : phase === 'stopped' ? 'Before it stopped' : ''
  const modelCalls = totals?.modelCalls ?? 0
  const costHint = hint || (modelCalls === 0 ? 'No model call yet' : totals?.costCalls === modelCalls ? 'Reported by the provider' : totals?.costCalls === 0 ? 'No call reported a cost' : `${totals?.costCalls} of ${modelCalls} calls reported a cost`)
  const tone = running ? ' ds-strip--live' : totals ? '' : ' ds-strip--pending'

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={hint || (totals ? `Sum of ${totals.calls} ${totals.calls === 1 ? 'call' : 'calls'}` : 'Start to finish')}>
          {running ? <LiveClock since={startedAt} /> : totals ? formatMs(totals.ms) : none}
        </Cell>
        <Cell label="Tokens" hint={hint || 'All model calls'}>
          {totals ? (totals.totalTokens === null ? 'not reported' : formatCount(totals.totalTokens)) : none}
        </Cell>
        <Cell label="Cost (USD)" hint={costHint}>
          {totals ? (totals.cost === null ? 'not reported' : formatUsd(totals.cost)) : none}
        </Cell>
        {running ? (
          <Cell label="Step" hint="Current step" small>
            <span className="ds-chips"><span className="ds-chip ds-chip--live">{runningStage ? STAGE_LABELS[runningStage] : 'starting'}</span></span>
          </Cell>
        ) : (
          <Cell label="Model" hint="Named in the provider replies" small>
            {totals && totals.models.length > 0
              ? <span className="ds-chips">{totals.models.map(id => <span key={id} className="ds-chip" title={id}>{shortModel(id)}</span>)}</span>
              : totals && modelCalls > 0 ? 'not reported' : none}
          </Cell>
        )}
      </dl>
    </section>
  )
}
