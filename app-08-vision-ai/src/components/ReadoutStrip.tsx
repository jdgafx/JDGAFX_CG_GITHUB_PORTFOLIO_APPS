import { useEffect, useState } from 'react'
import type { RunSummary, TraceStep } from '../lib/api'
import { NOT_REPORTED, formatCount, formatMs, formatUsd, shortModel } from '../lib/format'
import type { RunStatus } from '../lib/useAnalysis'

interface CellProps {
  label: string
  hint: string
  children: React.ReactNode
  small?: boolean
}

function Cell({ label, hint, children, small = false }: CellProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value" style={small ? { fontSize: 15 } : undefined}>
        {children}
      </dd>
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
  return <>{formatMs(Math.round(elapsed / 100) * 100)}</>
}

interface ReadoutStripProps {
  status: RunStatus
  steps: TraceStep[]
  summary: RunSummary | null
}

const NONE = '—'

/** Live figures while the run is going, the run's own totals once it has ended, dashes before one. */
export default function ReadoutStrip({ status, steps, summary }: ReadoutStripProps) {
  const running = status === 'running'
  const cut = status === 'failed' || status === 'cancelled'
  const current = steps.find(step => step.status === 'running')
  const tone = running ? ' ds-strip--live' : summary ? '' : ' ds-strip--pending'
  const spent = cut ? (status === 'failed' ? 'Before it failed' : 'Before it stopped') : ''
  const usage = summary?.usage
  const tokens = summary ? formatCount(usage?.total_tokens) : NONE
  const cost = summary ? formatUsd(usage?.cost) : NONE

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : spent || 'Start to answer'}>
          {running ? <LiveClock /> : summary ? formatMs(summary.totalMs) : NONE}
        </Cell>
        <Cell label="Tokens" hint={spent || (usage ? `${formatCount(usage.prompt_tokens)} in, ${formatCount(usage.completion_tokens)} out` : 'Prompt plus answer')} small={tokens === NOT_REPORTED}>
          {tokens}
        </Cell>
        <Cell label="Cost (USD)" hint={spent || 'As the provider reports it'} small={cost === NOT_REPORTED}>
          {cost}
        </Cell>
        {running ? (
          <Cell label="Step" hint="Current step" small>
            <span className="ds-chips">
              <span className="ds-chip ds-chip--live">{current?.name ?? 'starting'}</span>
            </span>
          </Cell>
        ) : (
          <Cell label="Model" hint="Named in the provider reply" small>
            {summary?.model ? (
              <span className="ds-chips">
                <span className="ds-chip" title={summary.model}>
                  {shortModel(summary.model)}
                </span>
              </span>
            ) : summary ? (
              NOT_REPORTED
            ) : (
              NONE
            )}
          </Cell>
        )}
      </dl>
    </section>
  )
}
