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

// A lower bound is said so: calls that may have been billed with no usage are not in the figure.
function lowerBound(text: string, totals: RunTotals): string {
  return totals.notReported > 0 ? `at least ${text}` : text
}

function notReportedNote(totals: RunTotals): string {
  return `${totals.notReported} ${totals.notReported === 1 ? 'call' : 'calls'} not reported`
}

// The judge's share is named apart from the panels', so the total is never read as panels only.
function tokensHint(totals: RunTotals): string {
  const base = totals.judgeTokens === null ? 'Panels, judge not reported' : `Panels and judge (judge ${formatCount(totals.judgeTokens)})`
  return totals.notReported > 0 ? `${base}; ${notReportedNote(totals)}` : base
}

function costHint(totals: RunTotals): string {
  if (totals.billedCalls === 0) return totals.notReported > 0 ? notReportedNote(totals) : 'No call reported usage'
  const judge = totals.judgeCost === null ? '' : ` (judge ${formatUsd(totals.judgeCost.usd)})`
  const base = `${totals.costedCalls} of ${totals.billedCalls} calls reported cost${judge}`
  const estimated = totals.totalCost?.source === 'estimated' ? `${base}, part estimated` : base
  return totals.notReported > 0 ? `${estimated}; ${notReportedNote(totals)}` : estimated
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
        <Cell label="Tokens" hint={totals ? tokensHint(totals) : 'Panels and judge'} mono={totals !== null || !hidden}>
          {totals ? (totals.totalTokens === null ? 'not reported' : lowerBound(formatCount(totals.totalTokens), totals)) : waiting}
        </Cell>
        <Cell label="Cost (USD)" hint={totals ? costHint(totals) : 'Reported or estimated'} mono={totals !== null || !hidden}>
          {totals ? (totals.totalCost ? lowerBound(formatUsd(totals.totalCost.usd), totals) : 'not reported') : waiting}
        </Cell>
        <Cell label="Models" hint={hidden ? 'Hidden until you vote' : 'Served by the provider'} mono={false}>
          {models.length > 0 ? (
            <span className="ds-chips">
              {models.map(id => (
                <span key={id} className="ds-chip ds-chip--wrap" title={id}>{splitModel(id).name}</span>
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
