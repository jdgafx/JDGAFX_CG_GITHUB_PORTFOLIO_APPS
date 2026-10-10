import { useEffect, useState, type ReactNode } from 'react'
import { formatCount, formatMs, formatUsd, splitModel } from '../lib/format'
import { runTotals, type RunTotals, type RunView } from '../lib/run'

interface CellProps {
  label: string
  hint: string
  children: ReactNode
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

const NONE = '—'

function answeringLabel(totals: RunTotals): string {
  if (totals.answering === 0) return 'No panel answered'
  return `${totals.answering} answering ${totals.answering === 1 ? 'panel' : 'panels'}`
}

function costHint(totals: RunTotals): string {
  if (totals.answering === 0) return 'No panel answered'
  const base = `${totals.costedPanels} of ${totals.answering} reported cost`
  return totals.panelCost?.source === 'estimated' ? `${base}, part estimated` : base
}

// The run's figures: a clock while it runs, the totals once the models are known, dashes before a run.
// A blind run before the vote shows only the time, because tokens, cost and model names would give the models away.
export function RunTotalsStrip({ run }: { run: RunView | null }) {
  const running = run?.status === 'running'
  const hidden = run?.status === 'voting'
  const totals = run?.compare ? runTotals(run) : null
  const pending = !run
  const tone = running ? ' ds-strip--live' : pending ? ' ds-strip--pending' : ''
  const models = [...new Set(run?.compare?.panels.flatMap(p => (p.ok && p.servedModel ? [p.servedModel] : [])) ?? [])]
  const waiting = hidden ? 'After your vote' : NONE

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : hidden ? 'Panels answered' : 'Panels plus judge'}>
          {running ? <LiveClock /> : hidden && run?.blind ? formatMs(run.blind.totalMs) : totals ? formatMs(totals.runMs) : NONE}
        </Cell>
        <Cell label="Tokens" hint={totals ? answeringLabel(totals) : 'Answering panels'} mono={totals !== null || !hidden}>
          {totals ? formatCount(totals.totalTokens) : waiting}
        </Cell>
        <Cell label="Cost (USD)" hint={totals ? costHint(totals) : 'Reported or estimated'} mono={totals !== null || !hidden}>
          {totals ? (totals.panelCost ? formatUsd(totals.panelCost.usd) : 'not reported') : waiting}
        </Cell>
        <Cell label="Models" hint={hidden ? 'Hidden until you vote' : 'Served by the provider'} mono={false}>
          {models.length > 0 ? (
            <span className="ds-chips">
              {models.map(id => (
                <span key={id} className="ds-chip" title={id}>{splitModel(id).name}</span>
              ))}
            </span>
          ) : (
            waiting
          )}
        </Cell>
      </dl>
    </section>
  )
}
