import { useEffect, useState, type ReactNode } from 'react'
import { count, milliseconds, shortModel, usd } from '../lib/format'
import type { LatestRun, TraceStep } from '../types'

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
  running: boolean
  pending: string | null
  liveTrace: TraceStep[]
  latest: LatestRun | null
  /** Passages sent to the model for the latest question, and how many the document has. */
  sent: number
  total: number
}

const NONE = '—'

/** Live figures while a question runs, the run's own totals once it has ended, dashes before one. */
export function ReadoutStrip({ running, pending, liveTrace, latest, sent, total }: ReadoutStripProps) {
  const report = latest?.report ?? null
  const usage = report?.usage ?? null
  const trace = running ? liveTrace : (report?.trace ?? [])
  const spentTokens = trace.reduce((sum, step) => sum + (step.tokens ?? 0), 0)
  const spentCost = trace.reduce((sum, step) => sum + (step.cost ?? 0), 0)
  const priced = trace.some(step => typeof step.cost === 'number')
  const notCalled = latest?.state === 'no-matches'
  const ended = !running && latest !== null
  const tone = running ? ' ds-strip--live' : latest ? '' : ' ds-strip--pending'
  const model = report?.model ?? null
  const partial = !running && (latest?.state === 'failed' || latest?.state === 'stopped')
  const sofar = partial ? (latest?.state === 'failed' ? 'Before it failed' : 'Before it stopped') : null

  const tokens = running
    ? spentTokens > 0 ? count(spentTokens) : NONE
    : notCalled ? 'not called'
    : usage ? (typeof usage.total_tokens === 'number' ? count(usage.total_tokens) : 'not reported')
    : spentTokens > 0 ? count(spentTokens) : NONE
  const cost = running
    ? priced ? usd(spentCost) : NONE
    : notCalled ? 'not called'
    : usage ? (typeof usage.cost === 'number' ? usd(usage.cost) : 'not reported')
    : priced ? usd(spentCost) : NONE
  const costHint = usage?.cost_source === 'estimated' ? 'Estimated from list prices' : usage?.cost_source === 'reported' ? 'Reported by OpenRouter' : (sofar ?? 'Reported or estimated')

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : notCalled ? 'Ranked in this browser' : (sofar ?? 'Whole question')}>
          {running ? <LiveClock /> : ended && report?.totalMs != null ? milliseconds(report.totalMs) : NONE}
        </Cell>
        <Cell label="Tokens" hint={sofar ?? 'All model calls'}>
          {tokens}
        </Cell>
        <Cell label="Cost (USD)" hint={costHint}>
          {cost}
        </Cell>
        <Cell label="Passages sent" hint={sent > 0 ? `Of ${count(total)} in the document` : 'Ranked by BM25'}>
          {sent > 0 ? count(sent) : ended && notCalled ? '0' : NONE}
        </Cell>
        {running ? (
          <Cell label="Step" hint="Current step">
            <span className="ds-chips">
              <span className="ds-chip ds-chip--live">{pending ?? 'starting'}</span>
            </span>
          </Cell>
        ) : (
          <Cell label="Model" hint="Named in the provider reply">
            {model ? (
              <span className="ds-chips">
                <span className="ds-chip" title={model}>
                  {shortModel(model)}
                </span>
              </span>
            ) : notCalled ? (
              'not called'
            ) : (
              NONE
            )}
          </Cell>
        )}
      </dl>
    </section>
  )
}
