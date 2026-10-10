import { useEffect, useState } from 'react'
import { formatCost, formatCount, formatMs, formatTokens } from '../lib/format'
import { metricsFor } from '../lib/metrics'
import type { RunView } from '../lib/view'
import type { NodeName, RunMetrics, TraceRow } from '../types/frames'

const CALL_WORD: Partial<Record<NodeName, string>> = { extract: 'Extract', check: 'Check', synthesize: 'Synthesize' }

/** Each distinct model that served a call, with how many calls each role made to it. Derived from the rows. */
export function modelUse(rows: TraceRow[]): Array<{ model: string; uses: string }> {
  const counts = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const word = CALL_WORD[row.node]
    if (!row.model || !word) continue
    const roles = counts.get(row.model) ?? new Map<string, number>()
    roles.set(word, (roles.get(word) ?? 0) + 1)
    counts.set(row.model, roles)
  }
  return [...counts].map(([model, roles]) => ({
    model,
    uses: [...roles].map(([word, n]) => `${word} ${n}`).join(', '),
  }))
}

/** A cost that no call reported reads "Not reported", never zero. */
const costValue = (cost: number | null, pending = false): string => (cost === null ? (pending ? '—' : 'Not reported') : formatCost(cost))

function costHint(metrics: RunMetrics | null): string {
  if (!metrics || metrics.totalCost === null) return 'Cost not reported'
  return metrics.costSource === 'estimated' ? 'Estimated from list prices' : 'As reported by OpenRouter'
}

/** Counts up from the press of Analyze while it is on screen. */
function LiveClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [])
  return <>{formatMs(Math.round((now - since) / 100) * 100)}</>
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

/** Live figures while the run goes, the run's own totals once it is done, and the figures spent so far after a failure or a stop. */
export function ReadoutStrip({ view }: { view: RunView }) {
  const { phase, rows, result } = view
  const running = phase === 'running'
  const ended = phase === 'error' || phase === 'stopped'
  const spent = rows.length > 0 && (running || ended)
  const metrics = result?.metrics ?? (rows.length > 0 ? metricsFor(rows, 0) : null)
  const models = modelUse(rows)
  const sofar = running ? 'So far' : phase === 'error' ? 'Before it failed' : 'Before it stopped'
  const none = '—'
  const show = result !== null || spent
  const tone = running ? ' ds-strip--live' : show ? '' : ' ds-strip--pending'
  const wall = result ? result.metrics.totalMs : view.startedAt !== null && view.endedAt !== null ? view.endedAt - view.startedAt : null

  return (
    <section className="ds-section ds-run__readout" aria-label="Run totals">
      <dl className={`ds-strip${tone}`}>
        <Cell label="Time" hint={running ? 'Running now' : result ? 'Wall clock, whole run' : ended ? sofar : 'Shown while it runs'}>
          {running && view.startedAt !== null ? <LiveClock since={view.startedAt} /> : wall !== null ? formatMs(wall) : none}
        </Cell>
        <Cell label="Tokens" hint={result ? 'Prompt plus completion, all calls' : show ? sofar : 'All model calls'}>
          {show && metrics ? formatTokens(metrics.totalTokens) : none}
        </Cell>
        <Cell label="Cost (USD)" hint={result ? costHint(metrics) : show ? sofar : 'Reported or estimated'}>
          {show && metrics ? costValue(metrics.totalCost) : none}
        </Cell>
        <Cell
          label="Extract and check"
          hint={show && metrics ? `${formatCount(metrics.cheapCalls, 'call')}, one per chunk plus the review` : 'One per chunk plus the review'}
        >
          {show && metrics ? costValue(metrics.cheapCost) : none}
        </Cell>
        <Cell label="Synthesis" hint="One call per pass, writes the cited summary">
          {show && metrics ? costValue(metrics.synthesisCost, !result) : none}
        </Cell>
        <Cell label="Models" hint={models.map((m) => m.uses).join('; ') || 'Named in the provider replies'}>
          {models.length > 0 ? (
            <span className="ds-chips">
              {models.map((m) => (
                <span key={m.model} className="ds-chip" title={m.model.replace(/^~/, '')}>
                  {m.model.replace(/^~?anthropic\//, '')}
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
