import { useEffect, useState } from 'react'
import { formatCost, formatMs, formatTokens } from '../lib/format'
import type { Phase, RunView } from '../lib/run-state'
import { totalsOf } from '../lib/totals'

/** Counts up from the press of Triage while it is on screen. */
function LiveClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [])
  return <>{formatMs(Math.round((now - since) / 100) * 100)}</>
}

interface ReadoutProps {
  run: RunView
  phase: Phase
  /** When the stream on screen began, or null. */
  startedAt: number | null
}

function Cell({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value">{children}</dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

/** The run's figures: live while it runs, the totals of the steps that ran once it ends, dashes before any step. */
export function Readout({ run, phase, startedAt }: ReadoutProps) {
  const totals = run.result?.totals ?? totalsOf(run.trace)
  const running = phase === 'running'
  const show = run.trace.some((row) => row.status !== 'skipped' && row.status !== 'pending')
  const ended = phase === 'failed' || phase === 'stopped'
  const sofar = running ? 'So far' : ended ? (phase === 'failed' ? 'Before it failed' : 'Before it stopped') : null
  const tone = running ? ' ds-strip--live' : show ? '' : ' ds-strip--pending'
  const none = '—'

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Step time" hint={running ? 'Running now' : (sofar ?? (show ? 'Sum of the steps that ran' : 'Shown while it runs'))}>
          {running && startedAt !== null ? <LiveClock since={startedAt} /> : show ? formatMs(totals.nodeMs) : none}
        </Cell>
        <Cell label="Tokens" hint={sofar ?? (show ? 'Prompt plus completion, all calls' : 'All model calls')}>
          {show ? formatTokens(totals.tokens) : none}
        </Cell>
        <Cell label="Cost (USD)" hint={sofar ?? (totals.costSource === 'estimated' ? 'Estimated from list prices' : show ? 'As reported by OpenRouter' : 'Reported or estimated')}>
          {show ? formatCost(totals.cost ?? undefined, totals.costSource ?? undefined) : none}
        </Cell>
        <Cell label="Models" hint={show ? 'Named in the provider replies' : 'Named in the provider replies'}>
          {totals.models.length > 0 ? (
            <span className="ds-chips">
              {totals.models.map((model) => (
                <span key={model} className="ds-chip" title={model}>
                  {model.replace(/^anthropic\//, '')}
                </span>
              ))}
            </span>
          ) : (
            none
          )}
        </Cell>
      </dl>
    </section>
  )
}
