import { formatCost, formatCount, formatMs, formatTokens } from '../lib/format'
import type { Phase } from '../lib/view'
import type { NodeName, RunMetrics, TraceRow } from '../types/frames'

const CALL_WORD: Partial<Record<NodeName, string>> = { extract: 'Extract', check: 'Check', synthesize: 'Synthesize' }

/** Each distinct model that served a call, with how many calls each role made to it. Derived here, from the rows. */
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
    uses: [...roles].map(([word, n]) => `${word}, ${formatCount(n, 'call')}`).join(' and '),
  }))
}

/** A cost that no call reported reads "Not reported", never zero. */
function costValue(cost: number | null): string {
  return cost === null ? 'Not reported' : formatCost(cost)
}

function costHint(metrics: RunMetrics | null): string {
  if (!metrics || metrics.totalCost === null) return 'Cost not reported'
  return metrics.costSource === 'estimated' ? 'Estimated from list prices' : 'As reported by OpenRouter'
}

/** A figure the run has not produced: still to come, or never shown because the run did not finish. */
function pendingWord(phase: Phase): string {
  return phase === 'stopped' || phase === 'error' ? 'Not shown' : 'Not yet'
}

function timeHint(phase: Phase): string {
  if (phase === 'done') return 'Wall clock for the whole run'
  if (phase === 'stopped') return 'Not shown, because the run stopped'
  if (phase === 'error') return 'Not shown, because the run failed'
  return 'Shown when the run finishes'
}

function Readout({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="ds-strip__item">
      <dt className="ds-strip__label">{label}</dt>
      <dd className="ds-strip__value ds-num">{value}</dd>
      <dd className="readout-hint">{hint}</dd>
    </div>
  )
}

export function MetricsRow({ metrics, phase, rows }: { metrics: RunMetrics | null; phase: Phase; rows: TraceRow[] }) {
  const complete = phase === 'done'
  const models = modelUse(rows)
  const pending = pendingWord(phase)
  const modelsValue = models.length > 0 ? formatCount(models.length, 'model') : metrics ? 'Not reported' : pending
  return (
    <section className="ds-section" aria-labelledby="totals-title">
      <div className="ds-section__head">
        <h2 id="totals-title" className="ds-section__title">
          Run totals
        </h2>
        <p className="ds-section__sub">Figures for the whole run. Tokens and cost add up as each call finishes.</p>
      </div>
      <dl className="ds-strip readout">
        <Readout
          label="Total time"
          value={metrics && complete ? formatMs(metrics.totalMs) : pending}
          hint={timeHint(phase)}
        />
        <Readout
          label="Total tokens"
          value={metrics ? formatTokens(metrics.totalTokens) : pending}
          hint="Prompt plus completion, all calls"
        />
        <Readout label="Total cost" value={metrics ? costValue(metrics.totalCost) : pending} hint={costHint(metrics)} />
        <Readout
          label="Extract and check calls"
          value={metrics ? costValue(metrics.cheapCost) : pending}
          hint={metrics ? `${formatCount(metrics.cheapCalls, 'call')}, one per chunk plus the review` : 'One per chunk plus the review'}
        />
        <Readout
          label="Synthesis call"
          value={metrics ? costValue(metrics.synthesisCost) : pending}
          hint="One call per pass, writes the cited summary"
        />
        <div className="ds-strip__item">
          <dt className="ds-strip__label">Models used</dt>
          <dd className="ds-strip__value ds-num">{modelsValue}</dd>
          {models.map((m) => (
            <dd key={m.model} className="readout-hint">
              <span className="model-id" title={m.model}>
                {m.model}
              </span>
              {m.uses}
            </dd>
          ))}
        </div>
      </dl>
    </section>
  )
}
