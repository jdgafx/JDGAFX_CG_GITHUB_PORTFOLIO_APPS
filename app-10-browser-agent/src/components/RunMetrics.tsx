import { useEffect, useState } from 'react'
import type { Phase, RunState } from '../lib/runState'
import { readoutFor } from '../lib/trace'

/** The clock, refreshed twice a second while a run is live and still otherwise. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [live])
  return now
}

interface RunMetricsProps {
  state: RunState
  phase: Phase
}

/** The run's figures as one four-cell readout. Time ticks while the run is live. The model is a chip with its full id in the title. */
export default function RunMetrics({ state, phase }: RunMetricsProps) {
  const live = phase === 'planning' || phase === 'running'
  const tone = phase === 'idle' ? ' ds-strip--pending' : live ? ' ds-strip--live' : ''
  const cells = readoutFor(state, useNow(live))
  return (
    <section className="ds-section ds-run__readout" aria-label="Run figures">
      <dl className={`ds-strip bb-readout${tone}`}>
        {cells.map((cell) => (
          <div className="ds-strip__item" key={cell.label}>
            <dt className="ds-strip__label">{cell.label}</dt>
            <dd className="ds-strip__value">
              {cell.label === 'Model' && cell.value.includes('/')
                ? <span className="ds-chip" title={cell.value}>{cell.value.replace(/^anthropic\//, '')}</span>
                : cell.value}
            </dd>
            <dd className="ds-strip__hint">{cell.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
