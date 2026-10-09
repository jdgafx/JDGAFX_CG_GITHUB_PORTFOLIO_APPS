import { useEffect, useState } from 'react'
import { formatCost, formatCount, formatMs, shortModel } from '../lib/format'
import type { RunStep, RunView } from '../types'

const NONE = '—'

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

interface CellProps {
  label: string
  hint: string
  children: React.ReactNode
  mono?: boolean
}

function Cell({ label, hint, children, mono = true }: CellProps) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value" style={mono ? undefined : { fontSize: 15 }}>{children}</dd>
      <dd className="ds-strip__hint">{hint}</dd>
    </div>
  )
}

function spent(trace: RunStep[]) {
  return {
    ms: trace.reduce((sum, step) => sum + step.ms, 0),
    tokens: trace.reduce((sum, step) => sum + (step.tokens ?? 0), 0),
    cost: trace.reduce((sum, step) => sum + (step.cost ?? 0), 0),
    priced: trace.some((step) => step.cost !== undefined),
  }
}

interface ReadoutStripProps {
  running: boolean
  run: RunView | null
}

/** Live clock while the run goes, the run's own totals once it ends, the figures spent so far after a failure or stop. */
export default function ReadoutStrip({ running, run }: ReadoutStripProps) {
  const failedOrStopped = run !== null && run.outcome !== 'done'
  const sofar = run && failedOrStopped ? spent(run.trace.filter((step) => step.status !== 'skipped')) : null
  const hint = run?.outcome === 'failed' ? 'Before it failed' : 'Before it stopped'
  const usage = run?.usage ?? {}
  const tone = running ? ' ds-strip--live' : run ? '' : ' ds-strip--pending'

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : sofar ? hint : 'Request to result'}>
          {running ? <LiveClock /> : run ? formatMs(sofar ? sofar.ms : run.totalMs) : NONE}
        </Cell>
        <Cell label="Tokens" hint={sofar ? hint : 'All model calls'}>
          {running || !run
            ? NONE
            : sofar
              ? sofar.tokens > 0 ? formatCount(sofar.tokens) : NONE
              : usage.total_tokens === undefined ? 'not reported' : formatCount(usage.total_tokens)}
        </Cell>
        <Cell label="Cost (USD)" hint={sofar ? hint : 'Reported by the provider'}>
          {running || !run
            ? NONE
            : sofar
              ? sofar.priced ? formatCost(sofar.cost) : NONE
              : usage.cost === undefined ? 'not reported' : formatCost(usage.cost)}
        </Cell>
        <Cell label={running ? 'Step' : 'Model'} hint={running ? 'Waiting for the reply' : 'Named in the reply'} mono={false}>
          {running ? (
            <span className="ds-chips"><span className="ds-chip ds-chip--live">planning</span></span>
          ) : run?.model ? (
            <span className="ds-chips"><span className="ds-chip" title={run.model}>{shortModel(run.model)}</span></span>
          ) : run ? 'not reported' : NONE}
        </Cell>
      </dl>
    </section>
  )
}
