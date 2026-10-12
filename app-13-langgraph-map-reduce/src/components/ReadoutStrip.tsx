import { useEffect, useState } from 'react'
import { formatCost, formatCount, formatMs, formatRate, formatTokens } from '../lib/format'
import { metricsFor, worstModelCheck } from '../lib/metrics'
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

/** The marker after the served ids: the worst model check across the run's calls. Null when no extra text is shown. */
export function checkMarker(rows: TraceRow[]): { text: string; className: string } | null {
  const worst = worstModelCheck(rows)
  if (worst === 'match') return { text: '· newest', className: 'ds-chip--muted' }
  if (worst === 'unchecked') return { text: '· unchecked', className: 'ds-chip--muted' }
  if (worst === 'mismatch') return { text: '· not newest', className: 'ds-badge ds-badge--warning' }
  return null
}

/** The served id's title. On a mismatch it also names the newest model the list gave. */
function servedTitle(served: string, rows: TraceRow[]): string {
  const mismatch = rows.find((row) => row.modelCheck === 'mismatch' && row.servedModel === served)
  return mismatch ? `served by ${served}, newest: ${mismatch.newestModel}` : `served by ${served}`
}

/** A cost with no price reads as what is missing, never as zero. */
const costValue = (cost: number | null, pending = false): string => (cost === null ? (pending ? '—' : 'n/a') : formatCost(cost))

/** "1 call not reported", "3 calls not reported": calls that were made but never answered, so the totals leave them out. */
const unreportedText = (metrics: RunMetrics | null): string | null =>
  metrics && metrics.unreportedCalls > 0 ? `${formatCount(metrics.unreportedCalls, 'call')} not reported` : null

function totalValue(metrics: RunMetrics | null): string {
  if (metrics?.totalCost != null) return metrics.unreportedCalls > 0 ? `at least ${formatCost(metrics.totalCost)}` : formatCost(metrics.totalCost)
  if (metrics && metrics.unreportedCalls > 0 && metrics.priceNote === null) return 'Not reported'
  if (metrics?.priceNote === 'unavailable') return 'Price unavailable'
  return metrics?.priceNote === 'no-served-model' ? 'No price' : 'n/a'
}

/** Where the total comes from: OpenRouter's price for each served model, or why there is none. */
function costHint(metrics: RunMetrics | null, rows: TraceRow[], otherwise: string): string {
  const partial = unreportedText(metrics)
  if (partial && metrics?.priceNote === null) return `(${partial}) ${costSource(metrics, rows, otherwise)}`
  return costSource(metrics, rows, otherwise)
}

function costSource(metrics: RunMetrics | null, rows: TraceRow[], otherwise: string): string {
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
  const marker = checkMarker(rows)
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
        <Cell label="Tokens" hint={unreportedText(metrics) ?? (result ? 'Prompt plus completion, all calls' : show ? sofar : 'All model calls')}>
          {show && metrics ? (metrics.unreportedCalls > 0 ? `at least ${formatTokens(metrics.totalTokens)}` : formatTokens(metrics.totalTokens)) : none}
        </Cell>
        <Cell label="Cost (USD)" hint={show ? costHint(metrics, rows, result ? 'No price for this run' : sofar) : "Tokens times OpenRouter's price"}>
          {show && metrics ? totalValue(metrics) : none}
        </Cell>
        <Cell
          label="Extract and check"
          hint={show && metrics ? `${formatCount(metrics.cheapCalls, 'call')}, an extract and a key point check per chunk, plus the review` : 'An extract and a key point check per chunk, plus the review'}
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
                <span key={m.model} className="ds-chip ds-chip--wrap" title={servedTitle(m.model, rows)}>
                  {m.model.replace(/^anthropic\//, '')}
                </span>
              ))}
              {marker && <span className={marker.className}>{marker.text}</span>}
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
