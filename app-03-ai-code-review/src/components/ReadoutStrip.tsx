import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { count, milliseconds, shortModel, usd } from '../lib/format'
import { passTimes, seconds } from '../lib/verdicts'
import type { RunPhase, RunSummary } from '../types'

function Cell({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value">{children}</dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

/** Counts up from zero while it is on screen, so mounting it starts the clock. */
function LiveClock() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = window.setInterval(() => setElapsed(Date.now() - start), 100)
    return () => window.clearInterval(id)
  }, [])
  return <>{milliseconds(Math.round(elapsed / 100) * 100)}</>
}

interface ReadoutStripProps {
  phase: RunPhase
  summary: RunSummary | null
}

/** Live clock while the run is going, the run's own totals once it ends, dashes before one. */
export function ReadoutStrip({ phase, summary }: ReadoutStripProps) {
  const running = phase === 'running'
  const none = '—'
  const usage = summary?.usage ?? null
  const times = summary ? passTimes(summary.trace) : { pass1: null, pass2: null }
  const sofar = phase === 'failed' ? 'Before it failed' : null
  const passes = [times.pass1 !== null ? `Pass 1 ${seconds(times.pass1)}` : '', times.pass2 !== null ? `pass 2 ${seconds(times.pass2)}` : ''].filter(Boolean).join(', ')
  const tone = running ? ' ds-strip--live' : summary ? '' : ' ds-strip--pending'
  const reported = (value: number | undefined, show: (n: number) => string) => (value === undefined ? 'not reported' : show(value))

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : (sofar ?? (passes || 'Start to finish'))}>
          {running ? <LiveClock /> : summary ? milliseconds(summary.totalMs) : none}
        </Cell>
        <Cell label="Tokens" hint={sofar ?? 'Both passes'}>
          {summary ? reported(usage?.total_tokens, count) : none}
        </Cell>
        <Cell label="Cost (USD)" hint={sofar ?? 'Reported by the provider'}>
          {summary ? reported(usage?.cost, usd) : none}
        </Cell>
        <Cell label="Model" hint="Named in the provider reply">
          {summary?.model ? (
            <span className="ds-chips">
              <span className="ds-chip" title={summary.model}>
                {shortModel(summary.model)}
              </span>
            </span>
          ) : summary ? (
            'not reported'
          ) : (
            none
          )}
        </Cell>
      </dl>
    </section>
  )
}
