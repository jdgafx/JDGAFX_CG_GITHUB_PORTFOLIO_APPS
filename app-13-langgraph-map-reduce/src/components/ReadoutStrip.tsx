import { useEffect, useState } from 'react'
import { formatCost, formatCount, formatMs, formatRate, formatTokens } from '../lib/format'
import { metricsFor } from '../lib/metrics'
import type { RunView } from '../lib/view'
import type { NodeName, PriceRate, RunMetrics, TraceRow } from '../types/frames'

const CALL_WORD: Partial<Record<NodeName, string>> = { extract: 'Extract', check: 'Check', synthesize: 'Synthesize' }

/** Each distinct model that answered a call, with how many calls each role made to it. Derived from the rows; a call whose reply named no model is left out. */
export function modelUse(rows: TraceRow[]): Array<{ model: string; uses: string }> {
  const counts = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const word = CALL_WORD[row.node]
    if (!row.servedModel || !word) continue
    const roles = counts.get(row.servedModel) ?? new Map<string, number>()
    roles.set(word, (roles.get(word) ?? 0) + 1)
    counts.set(row.servedModel, roles)
  }
  return [...counts].map(([model, roles]) => ({
    model,
    uses: [...roles].map(([word, n]) => `${word} ${n}`).join(', '),
  }))
}

/** Each served model whose OpenRouter price priced a call, with that price. Derived from the rows. */
export function priceUse(rows: TraceRow[]): Array<{ model: string; rate: PriceRate }> {
  const rates = new Map<string, PriceRate>()
  for (const row of rows) if (row.servedModel && row.rate && !rates.has(row.servedModel)) rates.set(row.servedModel, row.rate)
  return [...rates].map(([model, rate]) => ({ model, rate }))
}

/** A cost with no price reads as what is missing, never as zero. */
const costValue = (cost: number | null, pending = false): string => (cost === null ? (pending ? '—' : 'n/a') : formatCost(cost))

function totalValue(metrics: RunMetrics | null): string {
  if (metrics?.totalCost != null) return formatCost(metrics.totalCost)
  if (metrics?.priceNote === 'unavailable') return 'Price unavailable'
  return metrics?.priceNote === 'no-served-model' ? 'No price' : 'n/a'
}

/** Where the total comes from: OpenRouter's price for each served model, or why there is none. */
function costHint(metrics: RunMetrics | null, rows: TraceRow[], otherwise: string): string {
  if (metrics?.priceNote === 'unavailable') return "OpenRouter's price list could not be read"
  if (metrics?.priceNote === 'no-served-model') return 'Served model not reported, so no price'
  const used = priceUse(rows)
  if (metrics?.totalCost == null || used.length === 0) return otherwise
  return `Price from OpenRouter for ${used.map((u) => `${u.model}: ${formatRate(u.rate)}`).join('; ')}`
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
        <Cell label="Cost (USD)" hint={show ? costHint(metrics, rows, result ? 'No price for this run' : sofar) : "Tokens times OpenRouter's price"}>
          {show && metrics ? totalValue(metrics) : none}
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
                <span key={m.model} className="ds-chip" title={`served by ${m.model}`}>
                  {m.model.replace(/^anthropic\//, '')}
                </span>
              ))}
            </span>
          ) : rows.some((row) => row.model) ? (
            'served model not reported'
          ) : (
            none
          )}
        </Cell>
      </dl>
    </section>
  )
}
